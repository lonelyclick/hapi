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
    const fromBrainReview = meta?.sentFrom === 'brain-review'
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
    /** 防抖定时器：等 AI 真正完成一轮后再触发 brain sync */
    private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
    private static readonly DEBOUNCE_MS = 5000
    constructor(engine: SyncEngine, brainStore: BrainStore) {
        this.engine = engine
        this.brainStore = brainStore
    }

    setSseManager(sseManager: SSEManager): void {
        this.sseManager = sseManager
    }

    /**
     * 给 brain-sdk display session 发心跳，防止被判定为 inactive
     */
    private keepBrainDisplaySessionAlive(brainSession: StoredBrainSession): void {
        if (!brainSession.brainSessionId || brainSession.brainSessionId === 'sdk-mode') return
        this.engine.handleSessionAlive({
            sid: brainSession.brainSessionId,
            time: Date.now()
        }).catch(() => {})
    }

    /**
     * 检查 Brain session 是否使用 SDK 模式
     */
    private isSdkMode(brainSession: StoredBrainSession): boolean {
        if (!brainSession.brainSessionId || brainSession.brainSessionId === 'sdk-mode') {
            console.log('[BrainSync] isSdkMode: brainSessionId is', brainSession.brainSessionId, '→ true')
            return true
        }
        // 通过 review session 的 metadata.source 判断
        const reviewSession = this.engine.getSession(brainSession.brainSessionId)
        const source = reviewSession?.metadata?.source
        const result = source === 'brain-sdk'
        console.log('[BrainSync] isSdkMode: brainSessionId=', brainSession.brainSessionId, 'reviewSession found=', !!reviewSession, 'source=', source, '→', result)
        return result
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
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer)
        }
        this.debounceTimers.clear()
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

        if (session?.metadata?.source === 'brain' || session?.metadata?.source === 'brain-sdk') {
            console.log('[BrainSync] Brain AI response, triggering save, source:', session?.metadata?.source)
            await this.handleBrainAIResponse(sessionId)
            return
        }

        // 主 session：防抖处理，AI 在一轮对话中工具调用会多次触发 wasThinking
        // 每次收到都重置计时器，等稳定后再触发 brain sync
        const existing = this.debounceTimers.get(sessionId)
        if (existing) {
            clearTimeout(existing)
            console.log('[BrainSync] Debounce reset for', sessionId)
        }
        const timer = setTimeout(async () => {
            this.debounceTimers.delete(sessionId)
            // 再次检查 session 是否仍然不在 thinking
            const currentSession = this.engine.getSession(sessionId)
            if (currentSession?.thinking) {
                console.log('[BrainSync] Session still thinking after debounce, skip:', sessionId)
                return
            }
            console.log('[BrainSync] Debounce fired, session idle. Triggering brain sync:', sessionId)
            await this.handleMainSessionComplete(sessionId)
        }, AutoBrainService.DEBOUNCE_MS)
        this.debounceTimers.set(sessionId, timer)
    }

    private async handleMainSessionComplete(mainSessionId: string): Promise<void> {
        try {
            const brainSession = await this.brainStore.getActiveBrainSession(mainSessionId)
            if (!brainSession) {
                return
            }

            // SDK 模式下不需要设置映射（brainSessionId 为 'sdk-mode'）
            if (brainSession.brainSessionId && brainSession.brainSessionId !== 'sdk-mode') {
                this.brainToMainMap.set(brainSession.brainSessionId, mainSessionId)
            }

            await this.syncRounds(brainSession)
        } catch (err) {
            console.error('[BrainSync] Failed to handle main session complete:', err)
        }
    }

    private async handleBrainAIResponse(brainSessionId: string): Promise<void> {
        const mainSessionId = this.brainToMainMap.get(brainSessionId)
        console.log('[BrainSync] handleBrainAIResponse:', brainSessionId, 'mainSessionId:', mainSessionId)
        if (!mainSessionId) {
            console.log('[BrainSync] No main session mapping found')
            return
        }

        try {
            const brainSession = await this.brainStore.getActiveBrainSession(mainSessionId)
            console.log('[BrainSync] Active brain session:', brainSession?.id)
            if (!brainSession || brainSession.brainSessionId !== brainSessionId) {
                console.log('[BrainSync] Brain session mismatch or not found')
                return
            }

            // 只处理有 running execution 的回复（即 review 回复），忽略 init prompt 等其他回复
            const latestExecution = await this.brainStore.getLatestExecutionWithProgress(brainSession.id)
            if (!latestExecution || latestExecution.status !== 'running') {
                console.log('[BrainSync] No running execution found, skipping (likely init prompt response)')
                return
            }

            console.log('[BrainSync] Waiting for message to sync to DB...')
            await new Promise(resolve => setTimeout(resolve, 2000))

            const brainText = await this.extractBrainAIText(brainSessionId)
            if (!brainText) {
                console.log('[BrainSync] No brain text found')
                return
            }
            console.log('[BrainSync] Got brain text, length:', brainText.length)

            // Brain 通过 MCP tool (brain_send_message) 主动发消息给主 session
            // 这里只做状态记录，不再重复发消息
            const noIssues = brainText.includes('[NO_MESSAGE]')
            if (noIssues) {
                console.log('[BrainSync] Brain review: no issues found')
                await this.brainStore.completeBrainSession(brainSession.id, '[NO_MESSAGE]')
            } else {
                console.log('[BrainSync] Brain review completed with findings (message sent via MCP tool)')
                await this.brainStore.updateBrainResult(brainSession.id, brainText)
            }

            // SSE 广播 done 事件
            if (this.sseManager) {
                const mainSession = this.engine.getSession(mainSessionId)
                const noMessage = noIssues
                this.sseManager.broadcast({
                    type: 'brain-sdk-progress',
                    namespace: mainSession?.namespace,
                    sessionId: mainSessionId,
                    data: {
                        brainSessionId: brainSession.id,
                        progressType: 'done',
                        data: { status: 'completed', noMessage }
                    }
                } as unknown as SyncEvent)
            }

            // 完成 execution 记录（标记 reviewed rounds 为已 brain）
            await this.brainStore.completeBrainExecution(latestExecution.id, brainText.slice(0, 500))
        } catch (err) {
            console.error('[BrainSync] Failed to handle brain AI response:', err)
        }
    }

    private async extractBrainAIText(brainSessionId: string): Promise<string | null> {
        const messagesResult = await this.engine.getMessagesPage(brainSessionId, { limit: 10, beforeSeq: null })

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
                for (const item of contentArr) {
                    if (item.type === 'text' && item.text) {
                        return item.text
                    }
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

            // 找出需要处理的新 round（跳过 initPrompt、已处理的、没有 AI 回应的）
            const pendingRounds = allRounds.filter(r =>
                !existingRoundNumbers.has(r.roundNumber) &&
                r.aiMessages.length > 0 &&
                !initPromptRoundNumbers.has(r.roundNumber)
            )
            console.log('[BrainSync] Pending rounds:', pendingRounds.length)

            if (pendingRounds.length === 0) {
                console.log('[BrainSync] No pending rounds, nothing to do')
                return
            }

            // 广播 syncing 事件
            this.broadcastBrainSyncing(brainId, mainSessionId)

            // 直接保存 round（不经过 GLM，用 AI 原始回应文本）
            const savedRounds: Array<{ round: number; userInput: string; aiText: string }> = []
            for (const round of pendingRounds) {
                // 跳过 brain-review 触发的 round（防止循环）
                if (brainReviewRoundNumbers.has(round.roundNumber)) {
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
            if (savedRounds.length > 0 && this.isSdkMode(brainSession)) {
                const mainSessionObj = this.engine.getSession(mainSessionId)
                const projectPath = mainSessionObj?.metadata?.path
                if (projectPath) {
                    const summaries = savedRounds.map(r => ({ round: r.round, summary: r.aiText, userInput: r.userInput }))
                    await this.triggerSdkReview(brainSession, summaries, projectPath)
                }
            }

            if (brainSession.status === 'pending') {
                await this.brainStore.updateBrainSessionStatus(brainId, 'active')
            }
        } catch (err) {
            console.error('[BrainSync] syncRounds error:', err)
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
            // SDK 模式下 brainSessionId 为 'sdk-mode'，不需要设置映射
            if (brainSession.brainSessionId && brainSession.brainSessionId !== 'sdk-mode') {
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

        console.log('[BrainSync] Triggering review for', summaries.length, 'rounds (persistent brain session)')

        // 只发轮次标识，不发完整内容（节省 token）
        // Brain Claude 收到后调用 brain_summarize MCP tool 自行获取对话内容
        const roundNumbers = summaries.map(s => s.round).join(', ')
        const reviewPrompt = `对话汇总同步：主 session 完成了第 ${roundNumbers} 轮对话。请调用 brain_summarize 获取对话汇总，然后审查代码改动。`

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
            if (!brainDisplaySessionId || brainDisplaySessionId === 'sdk-mode') {
                console.error('[BrainSync] No valid brain display session ID (got:', brainDisplaySessionId, '), cannot send review')
                return
            }

            // 确保 brain → main 映射存在（用于回复时识别）
            this.brainToMainMap.set(brainDisplaySessionId, mainSessionId)

            await this.engine.sendMessage(brainDisplaySessionId, {
                text: reviewPrompt,
                sentFrom: 'webapp'
            })
            console.log('[BrainSync] Sent review prompt to persistent brain session:', brainDisplaySessionId)
        } catch (err) {
            console.error('[BrainSync] Failed to send review to brain session:', err)
        }
    }

}
