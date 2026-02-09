/**
 * Brain 自动同步服务
 *
 * 1. 主 Session 每轮对话结束后，自动触发同步到 Brain Session
 * 2. Brain Session AI 回复结束后，自动保存汇总结果
 * 3. 实时通知前端同步状态
 */

import type { SyncEngine, SyncEvent } from '../sync/syncEngine'
import type { SSEManager } from '../sse/sseManager'
import type { BrainStore } from './store'
import type { StoredBrainSession } from './types'
import { refiningSessions } from '../web/routes/messages'
import { sendSignal, needsImmediateAction, acceptsAiReplyDone, shouldReviewBrainTriggeredRounds } from './stateMachine'
import { buildStateReviewPrompt, parseSignalFromResponse } from './statePrompts'

/**
 * 从消息内容中提取用户文本
 */
function extractUserText(content: unknown): { text: string; fromBrainReview: boolean } | null {
    if (!content || typeof content !== 'object') {
        return null
    }
    const record = content as Record<string, unknown>
    if (record.role !== 'user') {
        return null
    }
    const meta = record.meta as Record<string, unknown> | undefined
    const fromBrainReview = meta?.sentFrom === 'brain-review' || meta?.sentFrom === 'brain-sdk-review'
    const body = record.content as Record<string, unknown> | string | undefined
    if (!body) {
        return null
    }
    let text: string | null = null
    if (typeof body === 'string') {
        text = body.trim() || null
    } else if (typeof body === 'object' && body.type === 'text' && typeof body.text === 'string') {
        text = (body.text as string).trim() || null
    }
    if (!text) return null
    return { text, fromBrainReview }
}

/**
 * 按轮次分组消息
 */
interface DialogueRound {
    roundNumber: number
    userInput: string
    aiMessages: string[]
    messageIds: string[]
    startedAt: number
    endedAt: number
    /** 该 round 的用户输入是否来自 brain-review（不需要再触发 SDK review） */
    fromBrainReview?: boolean
    /** 该 round 中 AI 是否使用了代码修改工具（Edit/Write/Bash 等） */
    hasCodeChanges?: boolean
}

function extractAIText(content: unknown): string | null {
    if (!content || typeof content !== 'object') {
        return null
    }
    const record = content as Record<string, unknown>
    if (record.role !== 'agent') {
        return null
    }
    let payload: Record<string, unknown> | null = null
    const rawContent = record.content
    if (typeof rawContent === 'string') {
        try {
            payload = JSON.parse(rawContent)
        } catch {
            return null
        }
    } else if (typeof rawContent === 'object' && rawContent) {
        payload = rawContent as Record<string, unknown>
    }
    if (!payload) return null

    const data = payload.data as Record<string, unknown>
    if (!data) return null

    if (data.type === 'assistant') {
        const message = data.message as Record<string, unknown>
        if (!message?.content) return null

        const contentArr = message.content as Array<{ type?: string; text?: string }>
        const texts: string[] = []
        for (const item of contentArr) {
            if (item.type === 'text' && item.text) {
                texts.push(item.text)
            }
        }
        return texts.length > 0 ? texts.join('\n\n') : null
    }

    if (data.type === 'message' && typeof data.message === 'string') {
        return data.message.trim() || null
    }

    if (data.type === 'text' && typeof data.text === 'string') {
        return data.text.trim() || null
    }

    return null
}

/** 代码修改类工具名称 */
const CODE_CHANGE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'Bash'])

/** 检查 agent 消息是否包含代码修改工具调用 */
function hasCodeChangeToolUse(content: unknown): boolean {
    if (!content || typeof content !== 'object') return false
    const record = content as Record<string, unknown>
    if (record.role !== 'agent') return false

    let payload: Record<string, unknown> | null = null
    const rawContent = record.content
    if (typeof rawContent === 'string') {
        try { payload = JSON.parse(rawContent) } catch { return false }
    } else if (typeof rawContent === 'object' && rawContent) {
        payload = rawContent as Record<string, unknown>
    }
    if (!payload) return false

    const data = payload.data as Record<string, unknown>
    if (!data || data.type !== 'assistant') return false

    const message = data.message as Record<string, unknown>
    if (!message?.content || !Array.isArray(message.content)) return false

    for (const block of message.content) {
        if (block && typeof block === 'object' && block.type === 'tool_use' && CODE_CHANGE_TOOLS.has(block.name)) {
            console.log('[BrainSync] Code change tool detected:', block.name)
            return true
        }
    }
    return false
}

function groupMessagesIntoRounds(messages: Array<{ id: string; content: unknown; createdAt: number }>): DialogueRound[] {
    const rounds: DialogueRound[] = []
    let currentRound: DialogueRound | null = null
    let roundNumber = 0

    let userCount = 0
    let agentCount = 0
    let agentWithTextCount = 0
    let sampleAgentLogged = false

    for (const message of messages) {
        const content = message.content as Record<string, unknown>
        if (content?.role === 'user') userCount++
        if (content?.role === 'agent') {
            agentCount++
            const aiText = extractAIText(message.content)
            if (aiText) agentWithTextCount++
            if (!sampleAgentLogged && agentCount <= 10) {
                const rawContent = content?.content
                let payload: Record<string, unknown> | null = null
                if (typeof rawContent === 'string') {
                    try { payload = JSON.parse(rawContent) } catch { /* ignore */ }
                } else if (typeof rawContent === 'object' && rawContent) {
                    payload = rawContent as Record<string, unknown>
                }
                const data = payload?.data as Record<string, unknown> | undefined
                console.log('[BrainSync] Agent msg #' + agentCount + ':', JSON.stringify({
                    contentType: typeof rawContent,
                    payloadType: payload?.type,
                    dataType: data?.type,
                    dataKeys: data ? Object.keys(data) : null,
                    sample: JSON.stringify(payload || rawContent).substring(0, 300)
                }))
                if (agentCount === 10) sampleAgentLogged = true
            }
        }

        const userResult = extractUserText(message.content)
        const aiText = extractAIText(message.content)

        if (userResult) {
            if (currentRound) {
                rounds.push(currentRound)
            }
            roundNumber++
            currentRound = {
                roundNumber,
                userInput: userResult.text,
                aiMessages: [],
                messageIds: [message.id],
                startedAt: message.createdAt,
                endedAt: message.createdAt,
                fromBrainReview: userResult.fromBrainReview
            }
        } else if (aiText && currentRound) {
            currentRound.aiMessages.push(aiText)
            currentRound.messageIds.push(message.id)
            currentRound.endedAt = message.createdAt
        }

        // 检测代码修改工具调用
        if (currentRound && !currentRound.hasCodeChanges && hasCodeChangeToolUse(message.content)) {
            currentRound.hasCodeChanges = true
        }
    }

    if (currentRound) {
        rounds.push(currentRound)
    }

    console.log('[BrainSync] Message stats: user=', userCount, 'agent=', agentCount, 'agentWithText=', agentWithTextCount)

    return rounds
}

export class AutoBrainService {
    private engine: SyncEngine
    private brainStore: BrainStore
    private sseManager: SSEManager | null = null
    private syncingBrainIds: Set<string> = new Set()
    private brainToMainMap: Map<string, string> = new Map()
    private unsubscribe: (() => void) | null = null
    constructor(engine: SyncEngine, brainStore: BrainStore) {
        this.engine = engine
        this.brainStore = brainStore
    }

    setSseManager(sseManager: SSEManager): void {
        this.sseManager = sseManager
    }

    /**
     * 给 brain display session 发心跳，防止被判定为 inactive
     */
    private keepBrainDisplaySessionAlive(brainSession: StoredBrainSession): void {
        if (!brainSession.brainSessionId) return
        this.engine.handleSessionAlive({
            sid: brainSession.brainSessionId,
            time: Date.now()
        }).catch(() => {})
    }

    start(): void {
        this.unsubscribe = this.engine.subscribe(this.handleEvent.bind(this))
        console.log('[BrainSync] Service started - auto sync enabled')
    }

    stop(): void {
        if (this.unsubscribe) {
            this.unsubscribe()
            this.unsubscribe = null
        }
        this.brainToMainMap.clear()
        this.syncingBrainIds.clear()
        console.log('[BrainSync] Service stopped')
    }

    private async handleEvent(event: SyncEvent): Promise<void> {
        if (!event.sessionId) return

        // 清理已删除 session 的映射，防止内存泄漏
        if (event.type === 'session-removed') {
            const sessionId = event.sessionId
            this.brainToMainMap.delete(sessionId)
            for (const [brainId, mainId] of this.brainToMainMap.entries()) {
                if (mainId === sessionId) {
                    this.brainToMainMap.delete(brainId)
                }
            }
            return
        }

        if (event.type !== 'session-updated') return

        const data = event.data as { wasThinking?: boolean } | undefined
        if (!data?.wasThinking) return

        const sessionId = event.sessionId
        const session = this.engine.getSession(sessionId)

        console.log('[BrainSync] AI response ended:', sessionId, 'source:', session?.metadata?.source)

        if (session?.metadata?.source === 'brain-sdk') {
            console.log('[BrainSync] Brain AI response, triggering save, source:', session?.metadata?.source)
            await this.handleBrainAIResponse(sessionId)
            return
        }

        // wasThinking=true 只在 CLI 收到 result 时触发（一轮对话真正结束）
        // 中间的工具调用不会触发，所以这个信号是可靠的
        await this.handleMainSessionComplete(sessionId)
    }

    private async handleMainSessionComplete(mainSessionId: string): Promise<void> {
        try {
            const brainSession = await this.brainStore.getActiveBrainSession(mainSessionId)
            if (!brainSession) {
                console.log('[BrainSync] handleMainSessionComplete: no active brain session for', mainSessionId)
                return
            }

            console.log('[BrainSync] handleMainSessionComplete: brainId=', brainSession.id, 'state=', brainSession.currentState, 'mainSessionId=', mainSessionId)

            if (brainSession.brainSessionId) {
                this.brainToMainMap.set(brainSession.brainSessionId, mainSessionId)
            }

            // 先等消息稳定，再做判断
            await this.waitForMessagesStable(mainSessionId)

            // 状态机：主 session AI 回复结束 → 发送 ai_reply_done 信号
            // 但仅当最新 round 有代码修改时才触发（纯问答不进 developing）
            const canAccept = acceptsAiReplyDone(brainSession.currentState)
            console.log('[BrainSync] handleMainSessionComplete: acceptsAiReplyDone=', canAccept, 'state=', brainSession.currentState)
            if (canAccept) {
                const allMessages = await this.engine.getAllMessages(mainSessionId)
                const rounds = groupMessagesIntoRounds(allMessages)
                const latest = rounds.length > 0 ? rounds[rounds.length - 1] : null
                console.log('[BrainSync] handleMainSessionComplete: totalRounds=', rounds.length, 'latestRound=', latest?.roundNumber, 'hasCodeChanges=', latest?.hasCodeChanges, 'fromBrainReview=', latest?.fromBrainReview)
                if (latest?.hasCodeChanges) {
                    const result = sendSignal(brainSession.currentState, brainSession.stateContext, 'ai_reply_done')
                    if (result.changed) {
                        console.log('[BrainSync] State auto-transition:', brainSession.currentState, '→', result.newState)
                        await this.brainStore.updateBrainState(brainSession.id, result.newState, result.newContext)
                        brainSession.currentState = result.newState
                        brainSession.stateContext = result.newContext
                    } else {
                        console.log('[BrainSync] ai_reply_done self-loop, state stays:', result.newState)
                    }
                } else {
                    console.log('[BrainSync] No code changes in latest round, skipping ai_reply_done (state stays:', brainSession.currentState, ')')
                    return
                }
            } else {
                console.log('[BrainSync] State', brainSession.currentState, 'does not accept ai_reply_done, proceeding to syncRounds directly')
            }

            await this.syncRounds(brainSession)
        } catch (err) {
            console.error('[BrainSync] Failed to handle main session complete:', err)
        }
    }

    /**
     * 等待消息稳定：轮询 message count，直到连续 stableMs 不再变化
     */
    private async waitForMessagesStable(sessionId: string, stableMs = 1000, maxWaitMs = 10000): Promise<void> {
        const start = Date.now()
        let lastCount = await this.engine.getMessageCount(sessionId)
        let lastChangeTime = Date.now()

        while (Date.now() - start < maxWaitMs) {
            await new Promise(r => setTimeout(r, 300))
            const currentCount = await this.engine.getMessageCount(sessionId)
            if (currentCount !== lastCount) {
                lastCount = currentCount
                lastChangeTime = Date.now()
            } else if (Date.now() - lastChangeTime >= stableMs) {
                console.log(`[BrainSync] Messages stable: count=${currentCount}, waited ${Date.now() - start}ms`)
                return
            }
        }
        console.log(`[BrainSync] waitForMessagesStable timeout after ${maxWaitMs}ms, proceeding with count=${lastCount}`)
    }

    private async handleBrainAIResponse(brainSessionId: string): Promise<void> {
        let mainSessionId = this.brainToMainMap.get(brainSessionId)
        console.log('[BrainSync] handleBrainAIResponse:', brainSessionId, 'mainSessionId:', mainSessionId)

        // 内存映射丢失时（如服务器重启），从 DB 查找
        let brainSession: StoredBrainSession | null = null
        if (!mainSessionId) {
            console.log('[BrainSync] No memory mapping, querying DB by review_session_id')
            brainSession = await this.brainStore.getActiveBrainSessionByReviewSessionId(brainSessionId)
            if (brainSession) {
                mainSessionId = brainSession.mainSessionId
                this.brainToMainMap.set(brainSessionId, mainSessionId)
                console.log('[BrainSync] Recovered mapping from DB:', brainSessionId, '→', mainSessionId)
            } else {
                console.log('[BrainSync] No brain session found in DB either')
                return
            }
        }

        try {
            if (!brainSession) {
                brainSession = await this.brainStore.getActiveBrainSession(mainSessionId)
            }
            console.log('[BrainSync] Active brain session:', brainSession?.id)
            if (!brainSession || brainSession.brainSessionId !== brainSessionId) {
                console.log('[BrainSync] Brain session mismatch or not found')
                return
            }

            // 检查是否正在 refine（用户消息拦截）
            const wasRefining = refiningSessions.has(mainSessionId)
            // 如果有 running execution，说明这是 review 回复而非 refine 回复
            // （避免 review 和 refine 同时进行时误判）
            const latestExecForCheck = wasRefining ? await this.brainStore.getLatestExecutionWithProgress(brainSession.id) : null
            const isActuallyReview = wasRefining && latestExecForCheck?.status === 'running'
            console.log('[BrainSync] handleBrainAIResponse: decision context:', {
                wasRefining,
                latestExecStatus: latestExecForCheck?.status ?? 'N/A',
                isActuallyReview,
                currentState: brainSession.currentState,
                brainId: brainSession.id,
            })
            if (isActuallyReview) {
                console.log('[BrainSync] handleBrainAIResponse: refiningSessions is set BUT latestExecution is running — this is a review response, not refine. Keeping refiningSessions for next response.')
            }
            if (wasRefining && !isActuallyReview) {
                console.log('[BrainSync] handleBrainAIResponse: refine response detected for', mainSessionId)
                refiningSessions.delete(mainSessionId)

                // 先解析 refine 回复文本和 signal，再决定 noMessage
                await this.waitForMessagesStable(brainSessionId)
                const refineText = await this.extractBrainAIText(brainSessionId)
                console.log('[BrainSync] Refine text:', refineText ? `length=${refineText.length}, preview=${refineText.slice(-200)}` : 'null')

                let refineNoMessage = !refineText  // 没文本 → noMessage
                let refineNewState = brainSession.currentState  // 默认保持当前状态
                if (refineText) {
                    const refineSignal = parseSignalFromResponse(refineText)
                    console.log('[BrainSync] Refine signal:', refineSignal, 'currentState:', brainSession.currentState)
                    if (refineSignal) {
                        // skip/waiting 等信号不需要显示消息
                        refineNoMessage = refineSignal === 'skip' || refineSignal === 'waiting'
                        const result = sendSignal(brainSession.currentState, brainSession.stateContext, refineSignal)
                        console.log('[BrainSync] Refine state transition:', brainSession.currentState, '→', result.newState, 'changed:', result.changed)
                        refineNewState = result.newState
                        // 始终持久化 context（即使 self-loop 也会更新 lastSignal 等）
                        await this.brainStore.updateBrainState(brainSession.id, result.newState, result.newContext)

                        if (result.changed) {
                            // 到达 done 时通知主 session
                            if (result.newState === 'done') {
                                console.log('[BrainSync] Refine: reached done state, notifying main session')
                                try {
                                    await this.engine.sendMessage(mainSessionId, {
                                        text: '[发送者: Brain 流程管理]\n\n流程已完成，任务结束。',
                                        sentFrom: 'brain-sdk-info'
                                    })
                                } catch (err) {
                                    console.error('[BrainSync] Refine: failed to send done notification:', err)
                                }
                            }
                            // skip 后如果新状态需要立即行动，主动触发
                            if (needsImmediateAction(result.newState)) {
                                console.log('[BrainSync] Refine: new state needs immediate action:', result.newState)
                                const refreshed = await this.brainStore.getActiveBrainSession(mainSessionId)
                                if (refreshed) {
                                    const mainSessionObj = this.engine.getSession(mainSessionId)
                                    const projectPath = mainSessionObj?.metadata?.path
                                    console.log('[BrainSync] Refine immediate action: projectPath=', projectPath ? 'present' : 'MISSING')
                                    if (projectPath) {
                                        await new Promise(r => setTimeout(r, 500))
                                        await this.triggerSdkReview(refreshed, [{ round: 0, summary: '', userInput: '' }], projectPath)
                                    }
                                }
                            }
                        }
                    }
                }

                // 广播 done（在解析完 signal 后，用正确的 noMessage 和 currentState）
                console.log('[BrainSync] Refine done broadcast: noMessage=', refineNoMessage, 'currentState=', refineNewState, 'brainId=', brainSession.id)
                if (this.sseManager) {
                    const mainSession = this.engine.getSession(mainSessionId)
                    this.sseManager.broadcast({
                        type: 'brain-sdk-progress',
                        namespace: mainSession?.namespace,
                        sessionId: mainSessionId,
                        data: {
                            brainSessionId: brainSession.id,
                            progressType: 'done',
                            data: { status: 'completed', noMessage: refineNoMessage, currentState: refineNewState }
                        }
                    } as unknown as SyncEvent)
                }
                return
            }

            // 只处理有 running execution 的回复（即 review 回复），忽略 init prompt 等其他回复
            // 复用 refine 检查中已查询的结果（如果有的话）
            const latestExecution = latestExecForCheck ?? await this.brainStore.getLatestExecutionWithProgress(brainSession.id)
            console.log('[BrainSync] handleBrainAIResponse: latestExecution=', latestExecution ? `id=${latestExecution.id} status=${latestExecution.status}` : 'none')
            if (!latestExecution || latestExecution.status !== 'running') {
                console.log('[BrainSync] No running execution found, skipping (likely init prompt or already completed)')
                return
            }

            await this.waitForMessagesStable(brainSessionId)

            const brainText = await this.extractBrainAIText(brainSessionId)
            if (!brainText) {
                console.log('[BrainSync] No brain text found, completing execution and broadcasting done')
                // 即使没有提取到文本，也要完成 execution 并广播 done，防止前端卡住
                await this.brainStore.completeBrainExecution(latestExecution.id, '[NO_TEXT]')
                if (this.sseManager) {
                    const mainSession = this.engine.getSession(mainSessionId)
                    this.sseManager.broadcast({
                        type: 'brain-sdk-progress',
                        namespace: mainSession?.namespace,
                        sessionId: mainSessionId,
                        data: {
                            brainSessionId: brainSession.id,
                            progressType: 'done',
                            data: { status: 'completed', noMessage: true }
                        }
                    } as unknown as SyncEvent)
                }
                return
            }
            console.log('[BrainSync] Got brain text, length:', brainText.length, 'preview:', brainText.slice(-200))

            // 从 Brain 回复中解析 signal，驱动状态机转换
            const signal = parseSignalFromResponse(brainText)
            console.log('[BrainSync] Parsed signal from brain response:', signal, 'currentState:', brainSession.currentState)

            if (signal) {
                const result = sendSignal(brainSession.currentState, brainSession.stateContext, signal)
                console.log('[BrainSync] State transition:', brainSession.currentState, '→', result.newState, 'changed:', result.changed)

                // 持久化新状态
                await this.brainStore.updateBrainState(brainSession.id, result.newState, result.newContext)
                console.log('[BrainSync] State persisted to DB:', result.newState)

                // 更新 brain result（done 不是终态，brain session 保持 active 可随时恢复）
                await this.brainStore.updateBrainResult(brainSession.id, brainText.slice(0, 500))

                // 完成当前 execution
                await this.brainStore.completeBrainExecution(latestExecution.id, brainText.slice(0, 500))
                console.log('[BrainSync] Execution completed:', latestExecution.id)

                // SSE 广播 done 事件
                const noIssues = signal === 'no_issue' || signal === 'dev_complete' || signal === 'lint_pass' || signal === 'test_pass' || signal === 'commit_ok' || signal === 'deploy_ok' || signal === 'waiting' || signal === 'skip'
                console.log('[BrainSync] Review done broadcast: signal=', signal, 'noMessage=', noIssues, 'newState=', result.newState, 'changed=', result.changed, 'brainId=', brainSession.id)
                if (this.sseManager) {
                    const mainSession = this.engine.getSession(mainSessionId)
                    this.sseManager.broadcast({
                        type: 'brain-sdk-progress',
                        namespace: mainSession?.namespace,
                        sessionId: mainSessionId,
                        data: {
                            brainSessionId: brainSession.id,
                            progressType: 'done',
                            data: { status: 'completed', noMessage: noIssues, currentState: result.newState }
                        }
                    } as unknown as SyncEvent)
                }

                // 如果新状态是 done，给主 session 发完成通知（防止主 session 卡在等待）
                if (result.changed && result.newState === 'done') {
                    console.log('[BrainSync] Reached done state, notifying main session. signal:', signal)
                    try {
                        const brainDisplaySessionId = brainSession.brainSessionId
                        if (brainDisplaySessionId) {
                            const doneMessage = signal === 'deploy_ok'
                                ? '[发送者: Brain 流程管理]\n\n全部流程已完成（开发 → 审查 → 检查 → 测试 → 提交 → 部署），任务结束。'
                                : signal === 'deploy_fail'
                                    ? '[发送者: Brain 流程管理]\n\n部署失败，已达到重试上限，流程结束。请手动检查部署问题。'
                                    : signal === 'test_fail'
                                        ? '[发送者: Brain 流程管理]\n\n测试失败，已达到重试上限，流程结束。请手动检查测试问题。'
                                        : '[发送者: Brain 流程管理]\n\n流程已完成，任务结束。'
                            await this.engine.sendMessage(mainSessionId!, {
                                text: doneMessage,
                                sentFrom: 'brain-sdk-info'
                            })
                            console.log('[BrainSync] Sent done notification to main session')
                        }
                    } catch (err) {
                        console.error('[BrainSync] Failed to send done notification:', err)
                    }
                }

                // 如果新状态需要立即行动（linting/testing/committing/deploying），
                // 主动再触发一轮，用新状态的 prompt push 主 session
                if (result.changed && needsImmediateAction(result.newState)) {
                    console.log('[BrainSync] New state needs immediate action, triggering another review cycle for:', result.newState, 'from signal:', signal)
                    // 刷新 brainSession 数据
                    const refreshed = await this.brainStore.getActiveBrainSession(mainSessionId)
                    if (refreshed) {
                        const mainSessionObj = this.engine.getSession(mainSessionId)
                        const projectPath = mainSessionObj?.metadata?.path
                        console.log('[BrainSync] Immediate action: refreshed brainId=', refreshed.id, 'state=', refreshed.currentState, 'projectPath=', projectPath ? 'present' : 'MISSING')
                        if (projectPath) {
                            // 短暂延迟，让前端 UI 有时间更新
                            await new Promise(r => setTimeout(r, 500))
                            await this.triggerSdkReview(refreshed, [{ round: 0, summary: '', userInput: '' }], projectPath)
                        }
                    }
                }
            } else {
                // 没有解析到 signal，降级为旧逻辑
                console.log('[BrainSync] No signal parsed, falling back to legacy behavior')
                const noIssues = brainText.includes('[NO_MESSAGE]')
                await this.brainStore.updateBrainResult(brainSession.id, noIssues ? '[NO_MESSAGE]' : brainText)

                // SSE 广播 done 事件
                if (this.sseManager) {
                    const mainSession = this.engine.getSession(mainSessionId)
                    this.sseManager.broadcast({
                        type: 'brain-sdk-progress',
                        namespace: mainSession?.namespace,
                        sessionId: mainSessionId,
                        data: {
                            brainSessionId: brainSession.id,
                            progressType: 'done',
                            data: { status: 'completed', noMessage: noIssues }
                        }
                    } as unknown as SyncEvent)
                }

                await this.brainStore.completeBrainExecution(latestExecution.id, brainText.slice(0, 500))
            }
        } catch (err) {
            console.error('[BrainSync] handleBrainAIResponse error:', err)
            // 异常时清理 running execution 并广播 done，防止前端和状态卡住
            if (mainSessionId) {
                const brainSession = await this.brainStore.getActiveBrainSession(mainSessionId).catch(() => null)
                if (brainSession) {
                    // 清理 running execution
                    const runningExec = await this.brainStore.getLatestExecutionWithProgress(brainSession.id).catch(() => null)
                    if (runningExec?.status === 'running') {
                        console.log('[BrainSync] handleBrainAIResponse: error cleanup, completing stale execution:', runningExec.id)
                        await this.brainStore.completeBrainExecution(runningExec.id, `[ERROR] ${err}`).catch(() => {})
                    }
                    // 广播 done
                    if (this.sseManager) {
                        console.log('[BrainSync] handleBrainAIResponse: error fallback, broadcasting done')
                        const mainSession = this.engine.getSession(mainSessionId)
                        this.sseManager.broadcast({
                            type: 'brain-sdk-progress',
                            namespace: mainSession?.namespace,
                            sessionId: mainSessionId,
                            data: {
                                brainSessionId: brainSession.id,
                                progressType: 'done',
                                data: { status: 'completed', noMessage: true }
                            }
                        } as unknown as SyncEvent)
                    }
                }
            }
        }
    }

    private async extractBrainAIText(brainSessionId: string): Promise<string | null> {
        const messagesResult = await this.engine.getMessagesPage(brainSessionId, { limit: 20, beforeSeq: null })

        for (let i = messagesResult.messages.length - 1; i >= 0; i--) {
            const m = messagesResult.messages[i]
            const content = m.content as Record<string, unknown>
            if (content?.role !== 'agent') continue

            let payload: Record<string, unknown> | null = null
            const rawContent = content?.content
            if (typeof rawContent === 'string') {
                try {
                    payload = JSON.parse(rawContent)
                } catch {
                    payload = null
                }
            } else if (typeof rawContent === 'object' && rawContent) {
                payload = rawContent as Record<string, unknown>
            }

            if (!payload) continue

            const data = payload.data as Record<string, unknown>
            if (!data || data.type !== 'assistant') continue

            const message = data.message as Record<string, unknown>
            if (message?.content) {
                const contentArr = message.content as Array<{ type?: string; text?: string }>
                // 拼接所有 text block（SIGNAL 可能在最后一个 text block 中，中间可能有 tool_use）
                const texts: string[] = []
                for (const item of contentArr) {
                    if (item.type === 'text' && item.text) {
                        texts.push(item.text)
                    }
                }
                if (texts.length > 0) {
                    console.log('[BrainSync] extractBrainAIText: found', texts.length, 'text blocks in message')
                    return texts.join('\n\n')
                }
            }
        }

        return null
    }

    private async syncRounds(brainSession: StoredBrainSession): Promise<void> {
        const brainId = brainSession.id
        const mainSessionId = brainSession.mainSessionId
        console.log('[BrainSync] syncRounds called:', brainId, mainSessionId)

        if (this.syncingBrainIds.has(brainId)) {
            console.log('[BrainSync] syncRounds - already syncing, skip')
            return
        }

        try {
            this.syncingBrainIds.add(brainId)

            this.keepBrainDisplaySessionAlive(brainSession)

            const allMessages = await this.engine.getAllMessages(mainSessionId)
            const allRounds = groupMessagesIntoRounds(allMessages)
            console.log('[BrainSync] Got', allMessages.length, 'messages,', allRounds.length, 'rounds')

            const existingRounds = await this.brainStore.getBrainRounds(brainId)
            const existingRoundNumbers = new Set(existingRounds.map(r => r.roundNumber))

            const brainReviewRoundNumbers = new Set(allRounds.filter(r => r.fromBrainReview).map(r => r.roundNumber))
            const initPromptRoundNumbers = new Set(allRounds.filter(r => r.userInput.trimStart().startsWith('#InitPrompt-')).map(r => r.roundNumber))
            if (brainReviewRoundNumbers.size > 0) {
                console.log('[BrainSync] Brain-review rounds:', [...brainReviewRoundNumbers].join(', '))
            }

            // 找出需要处理的新 round（跳过 initPrompt、已处理的、没有 AI 回应的）
            const pendingRounds = allRounds.filter(r =>
                !existingRoundNumbers.has(r.roundNumber) &&
                r.aiMessages.length > 0 &&
                !initPromptRoundNumbers.has(r.roundNumber)
            )
            console.log('[BrainSync] Pending rounds:', pendingRounds.length, pendingRounds.map(r => `R${r.roundNumber}(brainReview=${!!r.fromBrainReview},codeChange=${!!r.hasCodeChanges},userLen=${r.userInput.length})`).join(', '))

            if (pendingRounds.length === 0) {
                console.log('[BrainSync] No pending rounds, nothing to do')
                return
            }

            // 先过滤掉 brain-review 触发的 round，确认是否有真正需要审查的 round
            // 但如果当前状态需要审查 brain 触发的 round（如 reviewing 状态），则不过滤
            const shouldReviewBrainRounds = shouldReviewBrainTriggeredRounds(brainSession.currentState)
            const reviewableRounds = shouldReviewBrainRounds
                ? pendingRounds
                : pendingRounds.filter(r => !brainReviewRoundNumbers.has(r.roundNumber))
            console.log('[BrainSync] Reviewable rounds:', reviewableRounds.length, '(filtered from', pendingRounds.length, 'pending, reviewBrainRounds:', shouldReviewBrainRounds, ')')
            if (reviewableRounds.length === 0) {
                console.log('[BrainSync] All pending rounds are brain-review rounds, skipping')
                // 保存 round 记录（标记为已处理）但不触发审查
                for (const round of pendingRounds) {
                    try {
                        await this.brainStore.createBrainRound({
                            brainSessionId: brainId,
                            roundNumber: round.roundNumber,
                            userInput: round.userInput,
                            aiSummary: round.aiMessages.join('\n\n'),
                            originalMessageIds: round.messageIds,
                            startedAt: round.startedAt,
                            endedAt: round.endedAt
                        })
                    } catch { /* ignore duplicate */ }
                }
                return
            }

            // 有真正需要审查的 round，广播 syncing 事件
            this.broadcastBrainSyncing(brainId, mainSessionId)

            // 直接保存 round（不经过 GLM，用 AI 原始回应文本）
            const savedRounds: Array<{ round: number; userInput: string; aiText: string }> = []
            for (const round of pendingRounds) {
                // 跳过 brain-review 触发的 round（防止循环），除非当前状态是 reviewing（需要检查修改结果）
                if (!shouldReviewBrainRounds && brainReviewRoundNumbers.has(round.roundNumber)) {
                    console.log('[BrainSync] Skipping brain-review round', round.roundNumber)
                    continue
                }

                const aiText = round.aiMessages.join('\n\n')
                try {
                    await this.brainStore.createBrainRound({
                        brainSessionId: brainId,
                        roundNumber: round.roundNumber,
                        userInput: round.userInput,
                        aiSummary: aiText,  // 直接存原始 AI 文本
                        originalMessageIds: round.messageIds,
                        startedAt: round.startedAt,
                        endedAt: round.endedAt
                    })
                    savedRounds.push({ round: round.roundNumber, userInput: round.userInput, aiText })
                    console.log('[BrainSync] Saved round', round.roundNumber)
                } catch (e) {
                    console.error('[BrainSync] Failed to save round', round.roundNumber, e)
                }
            }

            // 将当前新增的 round 发给 brain session 做 review
            if (savedRounds.length > 0) {
                const mainSessionObj = this.engine.getSession(mainSessionId)
                const projectPath = mainSessionObj?.metadata?.path
                if (projectPath) {
                    const summaries = savedRounds.map(r => ({ round: r.round, summary: r.aiText, userInput: r.userInput }))
                    await this.triggerSdkReview(brainSession, summaries, projectPath)
                } else {
                    // projectPath 为空时无法触发 review，广播 done 防止前端卡住
                    console.log('[BrainSync] No projectPath, skipping review and broadcasting done')
                    if (this.sseManager) {
                        const mainSession = this.engine.getSession(mainSessionId)
                        this.sseManager.broadcast({
                            type: 'brain-sdk-progress',
                            namespace: mainSession?.namespace,
                            sessionId: mainSessionId,
                            data: {
                                brainSessionId: brainId,
                                progressType: 'done',
                                data: { status: 'completed', noMessage: true }
                            }
                        } as unknown as SyncEvent)
                    }
                }
            }

            if (brainSession.status === 'pending') {
                await this.brainStore.updateBrainSessionStatus(brainId, 'active')
            }
        } catch (err) {
            console.error('[BrainSync] syncRounds error:', err)
            // 异常时广播 done，防止前端卡在 "Brain 处理中"
            console.log('[BrainSync] syncRounds: error fallback, broadcasting done')
            if (this.sseManager) {
                const mainSession = this.engine.getSession(mainSessionId)
                this.sseManager.broadcast({
                    type: 'brain-sdk-progress',
                    namespace: mainSession?.namespace,
                    sessionId: mainSessionId,
                    data: {
                        brainSessionId: brainId,
                        progressType: 'done',
                        data: { status: 'completed', noMessage: true }
                    }
                } as unknown as SyncEvent)
            }
        } finally {
            this.syncingBrainIds.delete(brainId)
        }
    }

    private broadcastSyncStatus(brainSession: StoredBrainSession, data: {
        status: 'checking' | 'syncing' | 'complete' | 'analyzing'
        totalRounds: number
        summarizedRounds: number
        pendingRounds: number
        syncingRounds?: number[]
        savedRounds?: number[]
        savedSummaries?: Array<{ round: number; summary: string; userInput?: string }>
        unbrainedRounds?: number
        suggestions?: unknown[]
        summary?: string
    }): void {
        if (!this.sseManager) return

        const session = this.engine.getSession(brainSession.mainSessionId)
        if (!session) return

        this.sseManager.broadcast({
            type: 'brain-sync-status',
            namespace: session.namespace,
            sessionId: brainSession.mainSessionId,
            data: {
                brainSessionId: brainSession.id,
                ...data
            }
        } as unknown as SyncEvent)
    }

    private broadcastBrainSyncing(brainId: string, mainSessionId: string): void {
        if (!this.sseManager) return
        console.log('[BrainSync] Broadcasting SSE: syncing for', mainSessionId)
        const mainSession = this.engine.getSession(mainSessionId)
        this.sseManager.broadcast({
            type: 'brain-sdk-progress',
            namespace: mainSession?.namespace,
            sessionId: mainSessionId,
            data: {
                brainSessionId: brainId,
                progressType: 'syncing',
                data: {}
            }
        } as unknown as SyncEvent)
    }

    async triggerSync(mainSessionId: string): Promise<void> {
        console.log('[BrainSync] triggerSync called:', mainSessionId)
        const brainSession = await this.brainStore.getActiveBrainSession(mainSessionId)
        console.log('[BrainSync] triggerSync brainSession:', brainSession?.id ?? 'null')
        if (brainSession) {
            if (brainSession.brainSessionId) {
                this.brainToMainMap.set(brainSession.brainSessionId, mainSessionId)
            }
            await this.syncRounds(brainSession)
        }
    }

    /**
     * 触发代码审查（发消息给常驻 brain session）
     */
    private async triggerSdkReview(
        brainSession: StoredBrainSession,
        summaries: Array<{ round: number; summary: string; userInput: string }>,
        _projectPath: string
    ): Promise<void> {
        const brainId = brainSession.id
        const mainSessionId = brainSession.mainSessionId
        const brainDisplaySessionId = brainSession.brainSessionId

        console.log('[BrainSync] triggerSdkReview:', {
            brainId,
            mainSessionId,
            brainDisplaySessionId,
            state: brainSession.currentState,
            retries: brainSession.stateContext.retries,
            lastSignal: brainSession.stateContext.lastSignal,
            roundCount: summaries.length,
            rounds: summaries.map(s => s.round),
        })

        const roundNumbers = summaries.map(s => s.round)

        // 状态机驱动：根据当前状态生成对应的 prompt
        const reviewPrompt = buildStateReviewPrompt(
            brainSession.currentState,
            brainSession.stateContext,
            roundNumbers
        )
        console.log('[BrainSync] Review prompt preview (first 300 chars):', reviewPrompt.slice(0, 300))

        // 如果有未完成的 running execution，先标记为 completed（被新一轮取代）
        const prevExec = await this.brainStore.getLatestExecutionWithProgress(brainId)
        if (prevExec?.status === 'running') {
            console.log('[BrainSync] Found stale running execution:', prevExec.id, '- completing before new review')
            await this.brainStore.completeBrainExecution(prevExec.id, '[SUPERSEDED] New review cycle started')
        }

        // 创建执行记录（status=running）
        await this.brainStore.createBrainExecution({
            brainSessionId: brainId,
            roundsReviewed: summaries.length,
            reviewedRoundNumbers: summaries.map(s => s.round),
            timeRangeStart: Date.now(),
            timeRangeEnd: Date.now(),
            prompt: reviewPrompt,
            status: 'running'
        })

        // 广播开始状态
        this.broadcastSyncStatus(brainSession, {
            status: 'analyzing',
            totalRounds: summaries.length,
            summarizedRounds: summaries.length,
            pendingRounds: 0
        })

        // SSE 广播 started 事件
        console.log('[BrainSync] Broadcasting SSE: started for', mainSessionId)
        if (this.sseManager) {
            const mainSession = this.engine.getSession(mainSessionId)
            this.sseManager.broadcast({
                type: 'brain-sdk-progress',
                namespace: mainSession?.namespace,
                sessionId: mainSessionId,
                data: {
                    brainSessionId: brainId,
                    progressType: 'started',
                    data: {}
                }
            } as unknown as SyncEvent)
        }

        // 直接发消息给常驻 brain session（不再 spawn worker）
        try {
            if (!brainDisplaySessionId) {
                console.error('[BrainSync] No valid brain display session ID, cannot send review')
                // 标记 execution 失败，防止永远卡在 running
                const latestExec = await this.brainStore.getLatestExecutionWithProgress(brainId)
                if (latestExec?.status === 'running') {
                    await this.brainStore.completeBrainExecution(latestExec.id, '[ERROR] No brain display session ID')
                }
                return
            }

            // 确保 brain → main 映射存在（用于回复时识别）
            this.brainToMainMap.set(brainDisplaySessionId, mainSessionId)
            console.log('[BrainSync] Sending review prompt to brain session:', brainDisplaySessionId, 'promptLen:', reviewPrompt.length, 'brainToMainMapSize:', this.brainToMainMap.size)

            await this.engine.sendMessage(brainDisplaySessionId, {
                text: reviewPrompt,
                sentFrom: 'webapp'
            })
            console.log('[BrainSync] Sent review prompt to persistent brain session:', brainDisplaySessionId)
        } catch (err) {
            console.error('[BrainSync] Failed to send review to brain session:', err)
            // 发送失败时标记 execution 完成，防止卡在 running
            const latestExec = await this.brainStore.getLatestExecutionWithProgress(brainId)
            if (latestExec?.status === 'running') {
                await this.brainStore.completeBrainExecution(latestExec.id, `[ERROR] Failed to send: ${err}`)
            }
            // 广播 done，防止前端卡住
            if (this.sseManager) {
                const mainSession = this.engine.getSession(mainSessionId)
                this.sseManager.broadcast({
                    type: 'brain-sdk-progress',
                    namespace: mainSession?.namespace,
                    sessionId: mainSessionId,
                    data: {
                        brainSessionId: brainId,
                        progressType: 'done',
                        data: { status: 'completed', noMessage: true }
                    }
                } as unknown as SyncEvent)
            }
        }
    }

}
