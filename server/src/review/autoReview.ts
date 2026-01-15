/**
 * Review 自动同步服务
 *
 * 1. 主 Session 每轮对话结束后，自动触发同步到 Review Session
 * 2. Review Session AI 回复结束后，自动保存汇总结果
 * 3. 实时通知前端同步状态
 */

import type { SyncEngine, SyncEvent } from '../sync/syncEngine'
import type { SSEManager } from '../sse/sseManager'
import type { ReviewStore } from './store'
import type { StoredReviewSession } from './types'
import { generateSummariesWithMinimax, parseReviewResultWithMinimax, type ReviewResult } from './minimaxSync'

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
    startedAt: number   // 轮次开始时间（用户消息时间）
    endedAt: number     // 轮次结束时间（最后一条 AI 消息时间）
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

    // 支持多种消息类型
    // 1. Claude Code 格式: data.type === 'assistant' 且 data.message.content 是数组
    // 2. 其他 AI 格式: data.type === 'text' 且 data.text 是字符串
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

    if (data.type === 'text' && typeof data.text === 'string') {
        return data.text.trim() || null
    }

    return null
}

function groupMessagesIntoRounds(messages: Array<{ id: string; content: unknown; createdAt: number }>): DialogueRound[] {
    const rounds: DialogueRound[] = []
    let currentRound: DialogueRound | null = null
    let roundNumber = 0

    // 调试：记录消息角色分布
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
            // 调试：输出第一条 agent 消息的结构
            if (!sampleAgentLogged && agentCount <= 3) {
                const rawContent = content?.content
                let payload: Record<string, unknown> | null = null
                if (typeof rawContent === 'string') {
                    try { payload = JSON.parse(rawContent) } catch { /* ignore */ }
                } else if (typeof rawContent === 'object' && rawContent) {
                    payload = rawContent as Record<string, unknown>
                }
                if (payload) {
                    const data = payload.data as Record<string, unknown>
                    console.log('[ReviewSync] Sample agent message:', JSON.stringify({ type: payload.type, dataType: data?.type, dataKeys: data ? Object.keys(data) : null }, null, 2).substring(0, 500))
                    sampleAgentLogged = true
                }
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

    console.log('[ReviewSync] Message stats: user=', userCount, 'agent=', agentCount, 'agentWithText=', agentWithTextCount)

    return rounds
}

export class AutoReviewService {
    private engine: SyncEngine
    private reviewStore: ReviewStore
    private sseManager: SSEManager | null = null
    // 正在同步的 Review Session（防止重复触发）
    private syncingReviewIds: Set<string> = new Set()
    // Review Session ID -> Main Session ID 的映射（用于监听 Review AI 回复）
    private reviewToMainMap: Map<string, string> = new Map()

    constructor(engine: SyncEngine, reviewStore: ReviewStore) {
        this.engine = engine
        this.reviewStore = reviewStore
    }

    setSseManager(sseManager: SSEManager): void {
        this.sseManager = sseManager
    }

    start(): void {
        this.engine.subscribe(this.handleEvent.bind(this))
        console.log('[ReviewSync] Service started - auto sync enabled')
    }

    private async handleEvent(event: SyncEvent): Promise<void> {
        if (event.type !== 'session-updated') return
        if (!event.sessionId) return

        const data = event.data as { wasThinking?: boolean } | undefined
        if (!data?.wasThinking) return

        const sessionId = event.sessionId
        const session = this.engine.getSession(sessionId)

        console.log('[ReviewSync] AI response ended:', sessionId, 'source:', session?.metadata?.source)

        // 检查是否是 Review Session 的 AI 回复结束
        if (session?.metadata?.source === 'review') {
            console.log('[ReviewSync] Review AI response, triggering save')
            await this.handleReviewAIResponse(sessionId)
            return
        }

        // 主 Session AI 回复结束，检查是否需要同步
        await this.handleMainSessionComplete(sessionId)
    }

    /**
     * 主 Session AI 回复结束后，自动触发同步
     */
    private async handleMainSessionComplete(mainSessionId: string): Promise<void> {
        try {
            const reviewSession = await this.reviewStore.getActiveReviewSession(mainSessionId)
            if (!reviewSession) {
                return
            }

            // 注册映射关系
            this.reviewToMainMap.set(reviewSession.reviewSessionId, mainSessionId)

            // 触发同步
            await this.syncRounds(reviewSession)
        } catch (err) {
            console.error('[ReviewSync] Failed to handle main session complete:', err)
        }
    }

    /**
     * Review Session AI 回复结束后，用 MiniMax 解析结果并注入到 Review Session
     */
    private async handleReviewAIResponse(reviewSessionId: string): Promise<void> {
        const mainSessionId = this.reviewToMainMap.get(reviewSessionId)
        console.log('[ReviewSync] handleReviewAIResponse:', reviewSessionId, 'mainSessionId:', mainSessionId)
        if (!mainSessionId) {
            console.log('[ReviewSync] No main session mapping found')
            return
        }

        try {
            const reviewSession = await this.reviewStore.getActiveReviewSession(mainSessionId)
            console.log('[ReviewSync] Active review session:', reviewSession?.id)
            if (!reviewSession || reviewSession.reviewSessionId !== reviewSessionId) {
                console.log('[ReviewSync] Review session mismatch or not found')
                return
            }

            // 等待消息同步到数据库
            console.log('[ReviewSync] Waiting for message to sync to DB...')
            await new Promise(resolve => setTimeout(resolve, 2000))

            // 提取 Review AI 的文本内容
            const reviewText = await this.extractReviewAIText(reviewSessionId)
            if (!reviewText) {
                console.log('[ReviewSync] No review text found')
                return
            }
            console.log('[ReviewSync] Got review text, length:', reviewText.length)

            // 用 MiniMax 解析为结构化 JSON
            const apiKey = process.env.MINIMAX_API_KEY
            if (!apiKey) {
                console.error('[ReviewSync] MINIMAX_API_KEY not set')
                return
            }

            console.log('[ReviewSync] Parsing review result with MiniMax...')
            const result = await parseReviewResultWithMinimax(apiKey, reviewText)
            if (!result) {
                console.log('[ReviewSync] Failed to parse review result')
                return
            }

            console.log('[ReviewSync] Parsed review result:', result.suggestions.length, 'suggestions')

            // 将解析后的 JSON 结果注入到 Review Session 中
            await this.injectParsedResultToSession(reviewSessionId, result)
        } catch (err) {
            console.error('[ReviewSync] Failed to handle review AI response:', err)
        }
    }

    /**
     * 将解析后的 Review 结果注入到 Review Session 中
     */
    private async injectParsedResultToSession(reviewSessionId: string, result: ReviewResult): Promise<void> {
        try {
            // 计算统计信息
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

            // 构造 JSON 格式的消息内容（用于 ReviewSuggestions 解析）
            const jsonContent = JSON.stringify({
                suggestions: result.suggestions,
                summary: result.summary,
                stats  // 添加统计信息
            }, null, 2)

            const messageText = `## 结构化审查结果\n\n\`\`\`json\n${jsonContent}\n\`\`\``

            // 构造符合前端 normalize.ts 期望的消息格式
            // 格式：{ role: 'agent', content: { type: 'output', data: { type: 'assistant', message: { content: [...] } } } }
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

            // 注入消息到 Review Session
            await this.engine.addMessage(reviewSessionId, agentMessage)
            console.log('[ReviewSync] Injected parsed result to Review Session, stats:', stats)
        } catch (err) {
            console.error('[ReviewSync] Failed to inject parsed result:', err)
        }
    }

    /**
     * 提取 Review AI 的文本回复
     */
    private async extractReviewAIText(reviewSessionId: string): Promise<string | null> {
        const messagesResult = await this.engine.getMessagesPage(reviewSessionId, { limit: 10, beforeSeq: null })

        // 从最新消息开始找 AI 回复
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

    /**
     * 同步轮次 - 使用 MiniMax function calling（循环处理所有批次）
     */
    private async syncRounds(reviewSession: StoredReviewSession): Promise<void> {
        const reviewId = reviewSession.id
        const mainSessionId = reviewSession.mainSessionId
        console.log('[ReviewSync] syncRounds called:', reviewId, mainSessionId)

        // 防止重复同步
        if (this.syncingReviewIds.has(reviewId)) {
            console.log('[ReviewSync] syncRounds - already syncing, skip')
            return
        }

        try {
            this.syncingReviewIds.add(reviewId)

            // 获取 MiniMax API Key（从环境变量读取）
            const minimaxApiKey = process.env.MINIMAX_API_KEY
            if (!minimaxApiKey) {
                console.error('[ReviewSync] MiniMax API key not configured')
                return
            }

            // 循环处理所有批次
            let continueSync = true
            while (continueSync) {
                console.log('[ReviewSync] Getting all messages for main session...')

                // 获取主 Session 所有消息
                const allMessages = await this.engine.getAllMessages(mainSessionId)
                console.log('[ReviewSync] Got', allMessages.length, 'messages')
                const allRounds = groupMessagesIntoRounds(allMessages)
                console.log('[ReviewSync] Grouped into', allRounds.length, 'rounds')

                // 获取已汇总的轮次
                const existingRounds = await this.reviewStore.getReviewRounds(reviewId)
                const summarizedRoundNumbers = new Set(existingRounds.map(r => r.roundNumber))

                // 找出未汇总的轮次（必须有 AI 回复，否则算作"未完成"的轮次）
                const pendingRounds = allRounds.filter(r => !summarizedRoundNumbers.has(r.roundNumber) && r.aiMessages.length > 0)
                console.log('[ReviewSync] Pending rounds:', pendingRounds.length, 'summarized:', summarizedRoundNumbers.size, '(excluded incomplete rounds without AI reply)')

                // 通知前端当前状态
                this.broadcastSyncStatus(reviewSession, {
                    status: 'checking',
                    totalRounds: allRounds.length,
                    summarizedRounds: existingRounds.length,
                    pendingRounds: pendingRounds.length
                })

                if (pendingRounds.length === 0) {
                    // 计算未 review 的轮次数
                    const reviewedRoundNumbers = await this.reviewStore.getReviewedRoundNumbers(reviewId)
                    const unreviewedCount = existingRounds.filter(r => !reviewedRoundNumbers.has(r.roundNumber)).length

                    this.broadcastSyncStatus(reviewSession, {
                        status: 'complete',
                        totalRounds: allRounds.length,
                        summarizedRounds: existingRounds.length,
                        pendingRounds: 0,
                        unreviewedRounds: unreviewedCount
                    })
                    continueSync = false
                    break
                }

                // 计算批次
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

                // 通知前端正在同步
                this.broadcastSyncStatus(reviewSession, {
                    status: 'syncing',
                    totalRounds: allRounds.length,
                    summarizedRounds: existingRounds.length,
                    pendingRounds: pendingRounds.length,
                    syncingRounds: batchRounds.map(r => r.roundNumber)
                })

                console.log('[ReviewSync] Calling MiniMax API for', batchRounds.length, 'rounds')

                // 调用 MiniMax function calling
                const summaries = await generateSummariesWithMinimax(minimaxApiKey, batchRounds)
                console.log('[ReviewSync] MiniMax returned', summaries.length, 'summaries')

                // 保存汇总结果
                const savedRounds: number[] = []
                const savedSummaries: Array<{ round: number; summary: string }> = []
                for (const summary of summaries) {
                    if (summarizedRoundNumbers.has(summary.round)) {
                        console.log('[ReviewSync] Round', summary.round, 'already exists, skipping')
                        continue
                    }
                    const targetRound = allRounds.find(r => r.roundNumber === summary.round)
                    if (!targetRound) {
                        console.log('[ReviewSync] Round', summary.round, 'not found in main session')
                        continue
                    }
                    try {
                        await this.reviewStore.createReviewRound({
                            reviewSessionId: reviewId,
                            roundNumber: summary.round,
                            userInput: targetRound.userInput,
                            aiSummary: summary.summary,
                            originalMessageIds: targetRound.messageIds,
                            startedAt: targetRound.startedAt,
                            endedAt: targetRound.endedAt
                        })
                        savedRounds.push(summary.round)
                        savedSummaries.push({ round: summary.round, summary: summary.summary })
                        summarizedRoundNumbers.add(summary.round)  // 防止重复
                        console.log('[ReviewSync] Saved round', summary.round)
                    } catch (e) {
                        console.error('[ReviewSync] Failed to save round', summary.round, e)
                    }
                }

                // 更新状态
                const newSummarizedCount = existingRounds.length + savedRounds.length
                const newPendingCount = allRounds.length - newSummarizedCount

                // 计算未 review 的轮次数
                const reviewedRoundNumbers = await this.reviewStore.getReviewedRoundNumbers(reviewId)
                const newExistingRounds = await this.reviewStore.getReviewRounds(reviewId)
                const unreviewedCount = newExistingRounds.filter(r => !reviewedRoundNumbers.has(r.roundNumber)).length

                this.broadcastSyncStatus(reviewSession, {
                    status: newPendingCount > 0 ? 'syncing' : 'complete',
                    totalRounds: allRounds.length,
                    summarizedRounds: newSummarizedCount,
                    pendingRounds: newPendingCount,
                    savedRounds,
                    savedSummaries,
                    unreviewedRounds: unreviewedCount
                })

                // 更新状态为 active
                if (reviewSession.status === 'pending') {
                    await this.reviewStore.updateReviewSessionStatus(reviewId, 'active')
                    reviewSession.status = 'active'  // 更新本地状态
                }

                // 检查是否需要继续
                if (newPendingCount > 0 && savedRounds.length > 0) {
                    console.log('[ReviewSync] More rounds pending, continuing sync...')
                    // 短暂延迟避免过快调用 API
                    await new Promise(resolve => setTimeout(resolve, 1000))
                    // 继续下一轮循环
                } else {
                    continueSync = false
                }
            }
        } catch (err) {
            console.error('[ReviewSync] syncRounds error:', err)
            // 通知前端同步出错
            const allMessages = await this.engine.getAllMessages(mainSessionId).catch(() => [])
            const allRounds = groupMessagesIntoRounds(allMessages)
            const existingRounds = await this.reviewStore.getReviewRounds(reviewId).catch(() => [])
            const reviewedRoundNumbers = await this.reviewStore.getReviewedRoundNumbers(reviewId).catch(() => new Set<number>())
            const unreviewedCount = existingRounds.filter(r => !reviewedRoundNumbers.has(r.roundNumber)).length

            this.broadcastSyncStatus(reviewSession, {
                status: 'complete',
                totalRounds: allRounds.length,
                summarizedRounds: existingRounds.length,
                pendingRounds: allRounds.length - existingRounds.length,
                unreviewedRounds: unreviewedCount
            })
        } finally {
            this.syncingReviewIds.delete(reviewId)
        }
    }

    /**
     * 保存 Review AI 的汇总结果
     * @returns 成功保存的轮次数量
     */
    private async saveSummary(reviewSession: StoredReviewSession): Promise<number> {
        const reviewId = reviewSession.id
        const mainSessionId = reviewSession.mainSessionId

        try {
            // 获取 Review Session 的最新消息
            const messagesResult = await this.engine.getMessagesPage(reviewSession.reviewSessionId, { limit: 10, beforeSeq: null })

            // 提取汇总 - 从最新消息开始找，确保取到最新的回复
            let summaries: Array<{ round: number; summary: string }> = []

            // messagesResult.messages 是按时间正序（最旧在前），需要倒序遍历找最新的
            console.log('[ReviewSync] Messages count:', messagesResult.messages.length)
            for (let i = messagesResult.messages.length - 1; i >= 0; i--) {
                const m = messagesResult.messages[i]
                const content = m.content as Record<string, unknown>
                console.log('[ReviewSync] Message', i, 'role:', content?.role)
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
                            console.log('[ReviewSync] Found text content, length:', item.text.length, 'preview:', item.text.substring(0, 200))
                            // 提取 JSON
                            const jsonBlocks = [...item.text.matchAll(/```json\s*([\s\S]*?)\s*```/g)]
                            const jsonMatch = jsonBlocks.length > 0 ? jsonBlocks[jsonBlocks.length - 1] : null
                            if (jsonMatch) {
                                let jsonContent = jsonMatch[1].trim()
                                // 修复未转义的双引号
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
                                    // 继续尝试
                                }
                            }
                            // 直接解析
                            try {
                                const parsed = JSON.parse(item.text)
                                if (Array.isArray(parsed)) {
                                    summaries = parsed.filter(p => p.round && p.summary)
                                } else if (parsed.round && parsed.summary) {
                                    summaries = [parsed]
                                }
                                if (summaries.length > 0) break
                            } catch {
                                // 继续
                            }
                        }
                    }
                }
                if (summaries.length > 0) break
            }

            console.log('[ReviewSync] Parsed summaries:', summaries.length, summaries.map(s => s.round))
            if (summaries.length === 0) {
                console.log('[ReviewSync] No summaries parsed from AI response')
                return 0
            }

            // 获取主 Session 消息
            const allMessages = await this.engine.getAllMessages(mainSessionId)
            const allRounds = groupMessagesIntoRounds(allMessages)

            // 获取已存在的轮次
            const existingRounds = await this.reviewStore.getReviewRounds(reviewId)
            const existingRoundNumbers = new Set(existingRounds.map(r => r.roundNumber))

            // 保存
            const savedRounds: number[] = []
            const savedSummaries: Array<{ round: number; summary: string }> = []
            console.log('[ReviewSync] Existing rounds:', [...existingRoundNumbers])
            for (const summary of summaries) {
                if (existingRoundNumbers.has(summary.round)) {
                    console.log('[ReviewSync] Round', summary.round, 'already exists, skipping')
                    continue
                }
                const targetRound = allRounds.find(r => r.roundNumber === summary.round)
                if (!targetRound) {
                    console.log('[ReviewSync] Round', summary.round, 'not found in main session')
                    continue
                }
                try {
                    await this.reviewStore.createReviewRound({
                        reviewSessionId: reviewId,
                        roundNumber: summary.round,
                        userInput: targetRound.userInput,
                        aiSummary: summary.summary,
                        originalMessageIds: targetRound.messageIds,
                        startedAt: targetRound.startedAt,
                        endedAt: targetRound.endedAt
                    })
                    savedRounds.push(summary.round)
                    savedSummaries.push({ round: summary.round, summary: summary.summary })
                    console.log('[ReviewSync] Saved round', summary.round)
                } catch (e) {
                    console.error('[ReviewSync] Failed to save round', summary.round, e)
                }
            }

            // 通知前端
            const newExistingRounds = await this.reviewStore.getReviewRounds(reviewId)
            const pendingCount = allRounds.length - newExistingRounds.length

            // 计算未 review 的轮次数
            const reviewedRoundNumbers = await this.reviewStore.getReviewedRoundNumbers(reviewId)
            const unreviewedCount = newExistingRounds.filter(r => !reviewedRoundNumbers.has(r.roundNumber)).length

            this.broadcastSyncStatus(reviewSession, {
                status: pendingCount > 0 ? 'syncing' : 'complete',
                totalRounds: allRounds.length,
                summarizedRounds: newExistingRounds.length,
                pendingRounds: pendingCount,
                savedRounds,
                savedSummaries,
                unreviewedRounds: unreviewedCount
            })

            return savedRounds.length
        } catch (err) {
            console.error('[ReviewSync] Failed to save summary:', err)
            return 0
        }
    }

    /**
     * 广播同步状态到前端
     */
    private broadcastSyncStatus(reviewSession: StoredReviewSession, data: {
        status: 'checking' | 'syncing' | 'complete'
        totalRounds: number
        summarizedRounds: number
        pendingRounds: number
        syncingRounds?: number[]
        savedRounds?: number[]
        savedSummaries?: Array<{ round: number; summary: string }>  // 保存的汇总内容
        unreviewedRounds?: number
    }): void {
        if (!this.sseManager) return

        const session = this.engine.getSession(reviewSession.mainSessionId)
        if (!session) return

        this.sseManager.broadcast({
            type: 'review-sync-status',
            namespace: session.namespace,
            sessionId: reviewSession.mainSessionId,
            data: {
                reviewSessionId: reviewSession.id,
                ...data
            }
        } as SyncEvent)
    }

    /**
     * 手动触发同步（供 API 调用）
     */
    async triggerSync(mainSessionId: string): Promise<void> {
        console.log('[ReviewSync] triggerSync called:', mainSessionId)
        const reviewSession = await this.reviewStore.getActiveReviewSession(mainSessionId)
        console.log('[ReviewSync] triggerSync reviewSession:', reviewSession?.id ?? 'null')
        if (reviewSession) {
            this.reviewToMainMap.set(reviewSession.reviewSessionId, mainSessionId)
            await this.syncRounds(reviewSession)
        }
    }
}
