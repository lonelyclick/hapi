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

// 同步配置
const MAX_BATCH_CHARS = 50000  // 每批最大字符数
const MAX_ROUNDS_PER_BATCH = 10  // 每批最大轮数
const MIN_ROUNDS_PER_BATCH = 1   // 每批最小轮数

/**
 * 从消息内容中提取用户文本
 */
function extractUserText(content: unknown): string | null {
    if (!content || typeof content !== 'object') {
        return null
    }
    const record = content as Record<string, unknown>
    if (record.role !== 'user') {
        return null
    }
    const body = record.content as Record<string, unknown> | string | undefined
    if (!body) {
        return null
    }
    if (typeof body === 'string') {
        return body.trim() || null
    }
    if (typeof body === 'object' && body.type === 'text' && typeof body.text === 'string') {
        return body.text.trim() || null
    }
    return null
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

        const userText = extractUserText(message.content)
        const aiText = extractAIText(message.content)

        if (userText) {
            if (currentRound) {
                rounds.push(currentRound)
            }
            roundNumber++
            currentRound = {
                roundNumber,
                userInput: userText,
                aiMessages: [],
                messageIds: [message.id],
                startedAt: message.createdAt,
                endedAt: message.createdAt
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

        await this.handleMainSessionComplete(sessionId)
    }

    private async handleMainSessionComplete(mainSessionId: string): Promise<void> {
        try {
            const brainSession = await this.brainStore.getActiveBrainSession(mainSessionId)
            if (!brainSession) {
                return
            }

            this.brainToMainMap.set(brainSession.brainSessionId, mainSessionId)

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
                console.log('[BrainSync] Getting all messages for main session...')

                const allMessages = await this.engine.getAllMessages(mainSessionId)
                console.log('[BrainSync] Got', allMessages.length, 'messages')
                const allRounds = groupMessagesIntoRounds(allMessages)
                console.log('[BrainSync] Grouped into', allRounds.length, 'rounds')

                const existingRounds = await this.brainStore.getBrainRounds(brainId)
                const summarizedRoundNumbers = new Set(existingRounds.map(r => r.roundNumber))

                const pendingRounds = allRounds.filter(r => !summarizedRoundNumbers.has(r.roundNumber) && r.aiMessages.length > 0)
                console.log('[BrainSync] Pending rounds:', pendingRounds.length, 'summarized:', summarizedRoundNumbers.size, '(excluded incomplete rounds without AI reply)')

                this.broadcastSyncStatus(brainSession, {
                    status: 'checking',
                    totalRounds: allRounds.length,
                    summarizedRounds: existingRounds.length,
                    pendingRounds: pendingRounds.length
                })

                if (pendingRounds.length === 0) {
                    const brainedRoundNumbers = await this.brainStore.getBrainedRoundNumbers(brainId)
                    const unbrainedCount = existingRounds.filter(r => !brainedRoundNumbers.has(r.roundNumber)).length

                    this.broadcastSyncStatus(brainSession, {
                        status: 'complete',
                        totalRounds: allRounds.length,
                        summarizedRounds: existingRounds.length,
                        pendingRounds: 0,
                        unbrainedRounds: unbrainedCount
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

                const newSummarizedCount = existingRounds.length + savedRounds.length
                const newPendingCount = allRounds.length - newSummarizedCount

                const brainedRoundNumbers = await this.brainStore.getBrainedRoundNumbers(brainId)
                const newExistingRounds = await this.brainStore.getBrainRounds(brainId)
                const unbrainedCount = newExistingRounds.filter(r => !brainedRoundNumbers.has(r.roundNumber)).length

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
            const existingRounds = await this.brainStore.getBrainRounds(brainId).catch(() => [])
            const brainedRoundNumbers = await this.brainStore.getBrainedRoundNumbers(brainId).catch(() => new Set<number>())
            const unbrainedCount = existingRounds.filter(r => !brainedRoundNumbers.has(r.roundNumber)).length

            this.broadcastSyncStatus(brainSession, {
                status: 'complete',
                totalRounds: allRounds.length,
                summarizedRounds: existingRounds.length,
                pendingRounds: allRounds.length - existingRounds.length,
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
            const pendingCount = allRounds.length - newExistingRounds.length

            const brainedRoundNumbers = await this.brainStore.getBrainedRoundNumbers(brainId)
            const unbrainedCount = newExistingRounds.filter(r => !brainedRoundNumbers.has(r.roundNumber)).length

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
        status: 'checking' | 'syncing' | 'complete'
        totalRounds: number
        summarizedRounds: number
        pendingRounds: number
        syncingRounds?: number[]
        savedRounds?: number[]
        savedSummaries?: Array<{ round: number; summary: string }>
        unbrainedRounds?: number
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
        } as SyncEvent)
    }

    async triggerSync(mainSessionId: string): Promise<void> {
        console.log('[BrainSync] triggerSync called:', mainSessionId)
        const brainSession = await this.brainStore.getActiveBrainSession(mainSessionId)
        console.log('[BrainSync] triggerSync brainSession:', brainSession?.id ?? 'null')
        if (brainSession) {
            this.brainToMainMap.set(brainSession.brainSessionId, mainSessionId)
            await this.syncRounds(brainSession)
        }
    }
}
