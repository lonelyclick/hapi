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
import { generateSummariesWithGlm, parseBrainResultWithGlm, type BrainResult } from './glmSync'
import { buildBrainSystemPrompt, buildReviewPrompt } from './brainSdkService'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'

// 同步配置
const MAX_BATCH_CHARS = 50000  // 每批最大字符数
const MAX_ROUNDS_PER_BATCH = 10  // 每批最大轮数
const MIN_ROUNDS_PER_BATCH = 1   // 每批最小轮数

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
        this.engine.subscribe(this.handleEvent.bind(this))
        console.log('[BrainSync] Service started - auto sync enabled')
    }

    private async handleEvent(event: SyncEvent): Promise<void> {
        if (event.type !== 'session-updated') return
        if (!event.sessionId) return

        const data = event.data as { wasThinking?: boolean } | undefined
        if (!data?.wasThinking) return

        const sessionId = event.sessionId
        const session = this.engine.getSession(sessionId)

        console.log('[BrainSync] AI response ended:', sessionId, 'source:', session?.metadata?.source)

        if (session?.metadata?.source === 'brain') {
            console.log('[BrainSync] Brain AI response, triggering save')
            await this.handleBrainAIResponse(sessionId)
            return
        }

        if (session?.metadata?.source === 'brain-sdk') {
            // review session 本身的 AI response，不触发主 session sync
            return
        }

        // brain-review 消息也会被汇总到 round 中（标记 fromBrainReview），
        // 但不会触发新的 SDK review（防止无限循环）
        await this.handleMainSessionComplete(sessionId)
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

            console.log('[BrainSync] Waiting for message to sync to DB...')
            await new Promise(resolve => setTimeout(resolve, 2000))

            const brainText = await this.extractBrainAIText(brainSessionId)
            if (!brainText) {
                console.log('[BrainSync] No brain text found')
                return
            }
            console.log('[BrainSync] Got brain text, length:', brainText.length)

            const apiKey = process.env.LITELLM_API_KEY || 'sk-litellm-41e2a2d4d101255ea6e76fd59f96548a'

            console.log('[BrainSync] Parsing brain result with GLM...')
            const result = await parseBrainResultWithGlm(apiKey, brainText)
            if (!result) {
                console.log('[BrainSync] Failed to parse brain result')
                return
            }

            console.log('[BrainSync] Parsed brain result:', result.suggestions.length, 'suggestions')

            await this.injectParsedResultToSession(brainSessionId, result)
        } catch (err) {
            console.error('[BrainSync] Failed to handle brain AI response:', err)
        }
    }

    private async injectParsedResultToSession(brainSessionId: string, result: BrainResult): Promise<void> {
        try {
            const stats = {
                total: result.suggestions.length,
                byType: {
                    bug: result.suggestions.filter(s => s.type === 'bug').length,
                    security: result.suggestions.filter(s => s.type === 'security').length,
                    performance: result.suggestions.filter(s => s.type === 'performance').length,
                    improvement: result.suggestions.filter(s => s.type === 'improvement').length
                },
                bySeverity: {
                    high: result.suggestions.filter(s => s.severity === 'high').length,
                    medium: result.suggestions.filter(s => s.severity === 'medium').length,
                    low: result.suggestions.filter(s => s.severity === 'low').length
                }
            }

            const jsonContent = JSON.stringify({
                suggestions: result.suggestions,
                summary: result.summary,
                stats
            }, null, 2)

            const messageText = `## 结构化审查结果\n\n\`\`\`json\n${jsonContent}\n\`\`\``

            const agentMessage = {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        message: {
                            content: [
                                {
                                    type: 'text',
                                    text: messageText
                                }
                            ]
                        }
                    }
                }
            }

            await this.engine.addMessage(brainSessionId, agentMessage)
            console.log('[BrainSync] Injected parsed result to Brain Session, stats:', stats)
        } catch (err) {
            console.error('[BrainSync] Failed to inject parsed result:', err)
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

            const glmApiKey = process.env.LITELLM_API_KEY || 'sk-litellm-41e2a2d4d101255ea6e76fd59f96548a'

            let continueSync = true
            while (continueSync) {
                this.keepBrainDisplaySessionAlive(brainSession)
                console.log('[BrainSync] Getting all messages for main session...')

                const allMessages = await this.engine.getAllMessages(mainSessionId)
                console.log('[BrainSync] Got', allMessages.length, 'messages')
                const allRounds = groupMessagesIntoRounds(allMessages)
                console.log('[BrainSync] Grouped into', allRounds.length, 'rounds')

                const existingRounds = await this.brainStore.getBrainRounds(brainId)
                const summarizedRoundNumbers = new Set(existingRounds.map(r => r.roundNumber))

                // brain-review 开头的 round 也需要汇总，但不触发 SDK review
                const brainReviewRoundNumbers = new Set(allRounds.filter(r => r.fromBrainReview).map(r => r.roundNumber))
                // InitPrompt 开头的 round（通常是 round 1）跳过汇总
                const initPromptRoundNumbers = new Set(allRounds.filter(r => r.userInput.trimStart().startsWith('#InitPrompt-')).map(r => r.roundNumber))
                const pendingRounds = allRounds.filter(r =>
                    !summarizedRoundNumbers.has(r.roundNumber) &&
                    r.aiMessages.length > 0 &&
                    !initPromptRoundNumbers.has(r.roundNumber)
                )
                console.log('[BrainSync] Pending rounds:', pendingRounds.length, 'summarized:', summarizedRoundNumbers.size, 'brainReviewRounds:', brainReviewRoundNumbers.size, 'initPromptRounds:', initPromptRoundNumbers.size)

                this.broadcastSyncStatus(brainSession, {
                    status: 'checking',
                    totalRounds: allRounds.length,
                    summarizedRounds: existingRounds.length,
                    pendingRounds: pendingRounds.length
                })

                if (pendingRounds.length === 0) {
                    const brainedRoundNumbers = await this.brainStore.getBrainedRoundNumbers(brainId)
                    // 排除 brain-review 开头的 round（这些只需汇总，不需要 review，否则会形成无限循环）
                    const unbrainedRounds = existingRounds.filter(r =>
                        !brainedRoundNumbers.has(r.roundNumber) && !brainReviewRoundNumbers.has(r.roundNumber)
                    )

                    // 如果有已同步但未 brain 的 rounds，补触发 SDK review
                    if (unbrainedRounds.length > 0 && this.isSdkMode(brainSession)) {
                        const mainSessionObj = this.engine.getSession(mainSessionId)
                        const projectPath = mainSessionObj?.metadata?.path
                        if (projectPath) {
                            console.log('[BrainSync] Found', unbrainedRounds.length, 'unbrained rounds (excluding brain-review rounds), triggering SDK review')
                            const summaries = unbrainedRounds.map(r => ({ round: r.roundNumber, summary: r.aiSummary }))
                            await this.triggerSdkReview(brainSession, summaries, projectPath)
                        }
                    }

                    this.broadcastSyncStatus(brainSession, {
                        status: 'complete',
                        totalRounds: allRounds.length,
                        summarizedRounds: existingRounds.length,
                        pendingRounds: 0,
                        unbrainedRounds: unbrainedRounds.length
                    })
                    continueSync = false
                    break
                }

                const batchRounds: typeof pendingRounds = []
                let currentBatchSize = 0

                for (const round of pendingRounds) {
                    const roundSize = round.userInput.length + round.aiMessages.join('').length + 200
                    if (currentBatchSize + roundSize > MAX_BATCH_CHARS && batchRounds.length >= MIN_ROUNDS_PER_BATCH) {
                        break
                    }
                    batchRounds.push(round)
                    currentBatchSize += roundSize
                    if (batchRounds.length >= MAX_ROUNDS_PER_BATCH) {
                        break
                    }
                }

                this.broadcastSyncStatus(brainSession, {
                    status: 'syncing',
                    totalRounds: allRounds.length,
                    summarizedRounds: existingRounds.length,
                    pendingRounds: pendingRounds.length,
                    syncingRounds: batchRounds.map(r => r.roundNumber)
                })

                console.log('[BrainSync] Calling GLM API for', batchRounds.length, 'rounds')

                const summaries = await generateSummariesWithGlm(glmApiKey, batchRounds)
                console.log('[BrainSync] GLM returned', summaries.length, 'summaries')

                const savedRounds: number[] = []
                const savedSummaries: Array<{ round: number; summary: string }> = []
                for (const summary of summaries) {
                    if (summarizedRoundNumbers.has(summary.round)) {
                        console.log('[BrainSync] Round', summary.round, 'already exists, skipping')
                        continue
                    }
                    const targetRound = allRounds.find(r => r.roundNumber === summary.round)
                    if (!targetRound) {
                        console.log('[BrainSync] Round', summary.round, 'not found in main session')
                        continue
                    }
                    try {
                        await this.brainStore.createBrainRound({
                            brainSessionId: brainId,
                            roundNumber: summary.round,
                            userInput: targetRound.userInput,
                            aiSummary: summary.summary,
                            originalMessageIds: targetRound.messageIds,
                            startedAt: targetRound.startedAt,
                            endedAt: targetRound.endedAt
                        })
                        savedRounds.push(summary.round)
                        savedSummaries.push({ round: summary.round, summary: summary.summary })
                        summarizedRoundNumbers.add(summary.round)
                        console.log('[BrainSync] Saved round', summary.round)
                    } catch (e) {
                        console.error('[BrainSync] Failed to save round', summary.round, e)
                    }
                }

                // 将汇总内容发送到 Brain session（CLI 模式）或使用 SDK 处理（SDK 模式）
                if (savedSummaries.length > 0) {
                    try {
                        const mainSessionObj = this.engine.getSession(mainSessionId)
                        const projectPath = mainSessionObj?.metadata?.path || '(未知)'

                        const messageLines: string[] = [
                            '## 对话汇总同步\n',
                            `**项目路径：** \`${projectPath}\``,
                            `**记忆目录：** \`${projectPath}/.yoho-brain/\``,
                            ''
                        ]
                        for (const s of savedSummaries) {
                            messageLines.push(`### 第 ${s.round} 轮`)
                            messageLines.push(s.summary)
                            messageLines.push('')
                        }
                        messageLines.push('---')
                        messageLines.push('review 代码改动，有问题就指出，没问题回复"知道了"。不要给修复方案。')
                        messageLines.push('')
                        messageLines.push('读取 `.yoho-brain/MEMORY.md` 了解上下文，重要发现更新到 `.yoho-brain/`。')

                        if (brainSession.brainSessionId && brainSession.brainSessionId !== 'sdk-mode') {
                            await this.engine.sendMessage(brainSession.brainSessionId, {
                                text: messageLines.join('\n'),
                                sentFrom: 'webapp'
                            })
                            console.log('[BrainSync] Sent', savedSummaries.length, 'round summaries to brain session', brainSession.brainSessionId)
                        } else {
                            console.warn('[BrainSync] Brain session id missing, skipping summary send')
                        }

                        if (this.isSdkMode(brainSession)) {
                            // SDK 模式：spawn detached worker 进行代码审查
                            // 排除 brain-review 开头的 round（防止 review 自己的审查结果）
                            const reviewableSummaries = savedSummaries.filter(s => !brainReviewRoundNumbers.has(s.round))
                            if (reviewableSummaries.length > 0) {
                                console.log('[BrainSync] Using SDK mode for brain analysis (detached worker), reviewable:', reviewableSummaries.length, 'of', savedSummaries.length)
                                await this.triggerSdkReview(brainSession, reviewableSummaries, projectPath)
                            } else {
                                console.log('[BrainSync] All saved rounds are brain-review rounds, skipping SDK review')
                            }
                        } else {
                            // CLI 模式：此处不额外处理，Brain session 会自行根据消息做分析
                        }
                    } catch (sendErr) {
                        console.error('[BrainSync] Failed to send summaries to brain session:', sendErr)
                    }
                }

                const newSummarizedCount = existingRounds.length + savedRounds.length
                const newPendingCount = allRounds.length - newSummarizedCount - initPromptRoundNumbers.size

                const brainedRoundNumbersForStatus = await this.brainStore.getBrainedRoundNumbers(brainId)
                const newExistingRounds = await this.brainStore.getBrainRounds(brainId)
                const unbrainedCount = newExistingRounds.filter(r =>
                    !brainedRoundNumbersForStatus.has(r.roundNumber) && !brainReviewRoundNumbers.has(r.roundNumber)
                ).length

                this.broadcastSyncStatus(brainSession, {
                    status: newPendingCount > 0 ? 'syncing' : 'complete',
                    totalRounds: allRounds.length,
                    summarizedRounds: newSummarizedCount,
                    pendingRounds: newPendingCount,
                    savedRounds,
                    savedSummaries,
                    unbrainedRounds: unbrainedCount
                })

                if (brainSession.status === 'pending') {
                    await this.brainStore.updateBrainSessionStatus(brainId, 'active')
                    brainSession.status = 'active'
                }

                if (newPendingCount > 0 && savedRounds.length > 0) {
                    console.log('[BrainSync] More rounds pending, continuing sync...')
                    await new Promise(resolve => setTimeout(resolve, 1000))
                } else {
                    continueSync = false
                }
            }
        } catch (err) {
            console.error('[BrainSync] syncRounds error:', err)
            const allMessages = await this.engine.getAllMessages(mainSessionId).catch(() => [])
            const allRounds = groupMessagesIntoRounds(allMessages)
            const brainReviewRoundNums = new Set(allRounds.filter(r => r.fromBrainReview).map(r => r.roundNumber))
            const initPromptRoundNums = new Set(allRounds.filter(r => r.userInput.trimStart().startsWith('#InitPrompt-')).map(r => r.roundNumber))
            const skippedCount = initPromptRoundNums.size
            const existingRounds = await this.brainStore.getBrainRounds(brainId).catch(() => [])
            const brainedRoundNumbers = await this.brainStore.getBrainedRoundNumbers(brainId).catch(() => new Set<number>())
            const unbrainedCount = existingRounds.filter(r =>
                !brainedRoundNumbers.has(r.roundNumber) && !brainReviewRoundNums.has(r.roundNumber)
            ).length

            this.broadcastSyncStatus(brainSession, {
                status: 'complete',
                totalRounds: allRounds.length,
                summarizedRounds: existingRounds.length,
                pendingRounds: allRounds.length - existingRounds.length - skippedCount,
                unbrainedRounds: unbrainedCount
            })
        } finally {
            this.syncingBrainIds.delete(brainId)
        }
    }

    private async saveSummary(brainSession: StoredBrainSession): Promise<number> {
        const brainId = brainSession.id
        const mainSessionId = brainSession.mainSessionId

        try {
            const messagesResult = await this.engine.getMessagesPage(brainSession.brainSessionId, { limit: 10, beforeSeq: null })

            let summaries: Array<{ round: number; summary: string }> = []

            console.log('[BrainSync] Messages count:', messagesResult.messages.length)
            for (let i = messagesResult.messages.length - 1; i >= 0; i--) {
                const m = messagesResult.messages[i]
                const content = m.content as Record<string, unknown>
                console.log('[BrainSync] Message', i, 'role:', content?.role)
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
                            console.log('[BrainSync] Found text content, length:', item.text.length, 'preview:', item.text.substring(0, 200))
                            const jsonBlocks = [...item.text.matchAll(/```json\s*([\s\S]*?)\s*```/g)]
                            const jsonMatch = jsonBlocks.length > 0 ? jsonBlocks[jsonBlocks.length - 1] : null
                            if (jsonMatch) {
                                let jsonContent = jsonMatch[1].trim()
                                const lines = jsonContent.split('\n')
                                const fixedLines = lines.map(line => {
                                    const summaryMatch = line.match(/^(\s*"summary":\s*")(.*)("(?:,)?)\s*$/)
                                    if (summaryMatch) {
                                        let content = summaryMatch[2]
                                        content = content.replace(/(?<!\\)"/g, '\\"')
                                        return summaryMatch[1] + content + summaryMatch[3]
                                    }
                                    return line
                                })
                                jsonContent = fixedLines.join('\n')

                                try {
                                    const parsed = JSON.parse(jsonContent)
                                    if (Array.isArray(parsed)) {
                                        summaries = parsed.filter(p => p.round && p.summary)
                                    } else if (parsed.round && parsed.summary) {
                                        summaries = [parsed]
                                    }
                                    if (summaries.length > 0) break
                                } catch {
                                    // continue
                                }
                            }
                            try {
                                const parsed = JSON.parse(item.text)
                                if (Array.isArray(parsed)) {
                                    summaries = parsed.filter(p => p.round && p.summary)
                                } else if (parsed.round && parsed.summary) {
                                    summaries = [parsed]
                                }
                                if (summaries.length > 0) break
                            } catch {
                                // continue
                            }
                        }
                    }
                }
                if (summaries.length > 0) break
            }

            console.log('[BrainSync] Parsed summaries:', summaries.length, summaries.map(s => s.round))
            if (summaries.length === 0) {
                console.log('[BrainSync] No summaries parsed from AI response')
                return 0
            }

            const allMessages = await this.engine.getAllMessages(mainSessionId)
            const allRounds = groupMessagesIntoRounds(allMessages)

            const existingRounds = await this.brainStore.getBrainRounds(brainId)
            const existingRoundNumbers = new Set(existingRounds.map(r => r.roundNumber))

            const savedRounds: number[] = []
            const savedSummaries: Array<{ round: number; summary: string }> = []
            console.log('[BrainSync] Existing rounds:', [...existingRoundNumbers])
            for (const summary of summaries) {
                if (existingRoundNumbers.has(summary.round)) {
                    console.log('[BrainSync] Round', summary.round, 'already exists, skipping')
                    continue
                }
                const targetRound = allRounds.find(r => r.roundNumber === summary.round)
                if (!targetRound) {
                    console.log('[BrainSync] Round', summary.round, 'not found in main session')
                    continue
                }
                try {
                    await this.brainStore.createBrainRound({
                        brainSessionId: brainId,
                        roundNumber: summary.round,
                        userInput: targetRound.userInput,
                        aiSummary: summary.summary,
                        originalMessageIds: targetRound.messageIds,
                        startedAt: targetRound.startedAt,
                        endedAt: targetRound.endedAt
                    })
                    savedRounds.push(summary.round)
                    savedSummaries.push({ round: summary.round, summary: summary.summary })
                    console.log('[BrainSync] Saved round', summary.round)
                } catch (e) {
                    console.error('[BrainSync] Failed to save round', summary.round, e)
                }
            }

            const newExistingRounds = await this.brainStore.getBrainRounds(brainId)
            const initPromptSkipped = allRounds.filter(r => r.userInput.trimStart().startsWith('#InitPrompt-')).length
            const pendingCount = allRounds.length - newExistingRounds.length - initPromptSkipped

            const brainedRoundNumbers = await this.brainStore.getBrainedRoundNumbers(brainId)
            const brainReviewRoundNums = new Set(allRounds.filter(r => r.fromBrainReview).map(r => r.roundNumber))
            const unbrainedCount = newExistingRounds.filter(r =>
                !brainedRoundNumbers.has(r.roundNumber) && !brainReviewRoundNums.has(r.roundNumber)
            ).length

            this.broadcastSyncStatus(brainSession, {
                status: pendingCount > 0 ? 'syncing' : 'complete',
                totalRounds: allRounds.length,
                summarizedRounds: newExistingRounds.length,
                pendingRounds: pendingCount,
                savedRounds,
                savedSummaries,
                unbrainedRounds: unbrainedCount
            })

            return savedRounds.length
        } catch (err) {
            console.error('[BrainSync] Failed to save summary:', err)
            return 0
        }
    }

    private broadcastSyncStatus(brainSession: StoredBrainSession, data: {
        status: 'checking' | 'syncing' | 'complete' | 'analyzing'
        totalRounds: number
        summarizedRounds: number
        pendingRounds: number
        syncingRounds?: number[]
        savedRounds?: number[]
        savedSummaries?: Array<{ round: number; summary: string }>
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
     * 使用 SDK 触发代码审查（spawn detached worker 进程）
     */
    private async triggerSdkReview(
        brainSession: StoredBrainSession,
        summaries: Array<{ round: number; summary: string }>,
        projectPath: string
    ): Promise<void> {
        const brainId = brainSession.id
        const mainSessionId = brainSession.mainSessionId

        console.log('[BrainSync] Triggering SDK review for', summaries.length, 'rounds (detached worker)')

        // 构建审查提示词
        const roundsSummary = summaries.map(s => `### 第 ${s.round} 轮\n${s.summary}`).join('\n\n')
        const contextSummary = brainSession.contextSummary || '(无上下文)'
        const reviewPrompt = buildReviewPrompt(contextSummary, roundsSummary)
        const systemPrompt = await buildBrainSystemPrompt()

        // 使用 glm-4.7（LiteLLM 代理支持，claude-sonnet-4-5 映射的 API 返回 401）
        const model = 'glm-4.7'

        // 创建执行记录（status=running）
        const execution = await this.brainStore.createBrainExecution({
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

        // spawn detached worker
        try {
            const workerPath = this.resolveWorkerPath()
            const config = JSON.stringify({
                executionId: execution.id,
                brainSessionId: brainId,
                mainSessionId,
                prompt: reviewPrompt,
                projectPath,
                model,
                systemPrompt,
                serverCallbackUrl: `http://127.0.0.1:${process.env.WEBAPP_PORT || '3006'}`,
                serverToken: process.env.CLI_API_TOKEN || '',
            })

            const child = spawn(workerPath, [config], {
                detached: true,
                stdio: 'ignore',
                env: process.env as NodeJS.ProcessEnv
            })
            child.unref()

            console.log('[BrainSync] Spawned detached worker PID:', child.pid, 'for execution:', execution.id)
        } catch (err) {
            console.error('[BrainSync] Failed to spawn worker:', err)
            await this.brainStore.failBrainExecution(execution.id, `Failed to spawn worker: ${(err as Error).message}`)
        }
    }

    /**
     * 查找 brain-worker 可执行文件路径
     */
    private resolveWorkerPath(): string {
        // 方案1: 与当前可执行文件同目录
        const serverDir = path.dirname(process.execPath)
        const candidate1 = path.join(serverDir, 'hapi-brain-worker')
        if (existsSync(candidate1)) return candidate1

        // 方案2: 项目构建目录
        const candidate2 = '/home/guang/softwares/hapi/cli/dist-exe/bun-linux-x64/hapi-brain-worker'
        if (existsSync(candidate2)) return candidate2

        throw new Error('hapi-brain-worker executable not found')
    }
}
