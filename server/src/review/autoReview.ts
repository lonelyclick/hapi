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
    if (!data || data.type !== 'assistant') return null

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

function groupMessagesIntoRounds(messages: Array<{ id: string; content: unknown; createdAt: number }>): DialogueRound[] {
    const rounds: DialogueRound[] = []
    let currentRound: DialogueRound | null = null
    let roundNumber = 0

    for (const message of messages) {
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
     * Review Session AI 回复结束后，保存汇总结果并继续同步
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

            // 保存汇总结果
            console.log('[ReviewSync] Saving summary...')
            const savedCount = await this.saveSummary(reviewSession)

            // 只有成功保存了汇总结果，才继续检查是否有更多待同步的轮次
            // 这样可以避免无限循环：如果 AI 回复中没有有效的汇总，就不要再触发同步
            if (savedCount > 0) {
                console.log('[ReviewSync] Saved', savedCount, 'rounds, checking for more...')
                await this.syncRounds(reviewSession)
            } else {
                console.log('[ReviewSync] No new rounds saved, not triggering more syncs')
            }
        } catch (err) {
            console.error('[ReviewSync] Failed to handle review AI response:', err)
        }
    }

    /**
     * 同步轮次到 Review AI
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

        // 检查 Review AI 是否正在处理中
        const reviewAISession = this.engine.getSession(reviewSession.reviewSessionId)
        if (reviewAISession?.thinking) {
            console.log('[ReviewSync] syncRounds - Review AI thinking, skip')
            return
        }

        try {
            this.syncingReviewIds.add(reviewId)

            // 获取主 Session 所有消息
            const allMessages = await this.engine.getAllMessages(mainSessionId)
            const allRounds = groupMessagesIntoRounds(allMessages)

            // 获取已汇总的轮次
            const existingRounds = await this.reviewStore.getReviewRounds(reviewId)
            const summarizedRoundNumbers = new Set(existingRounds.map(r => r.roundNumber))

            // 找出未汇总的轮次
            const pendingRounds = allRounds.filter(r => !summarizedRoundNumbers.has(r.roundNumber))

            // 通知前端当前状态
            this.broadcastSyncStatus(reviewSession, {
                status: 'checking',
                totalRounds: allRounds.length,
                summarizedRounds: existingRounds.length,
                pendingRounds: pendingRounds.length
            })

            if (pendingRounds.length === 0) {
                this.broadcastSyncStatus(reviewSession, {
                    status: 'complete',
                    totalRounds: allRounds.length,
                    summarizedRounds: existingRounds.length,
                    pendingRounds: 0
                })
                return
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

            // 构建同步 Prompt
            let syncPrompt = `## 对话汇总任务\n\n请帮我汇总以下 ${batchRounds.length} 轮对话的内容。\n\n`

            for (const round of batchRounds) {
                syncPrompt += `### 第 ${round.roundNumber} 轮对话\n\n**用户输入：**\n${round.userInput}\n\n**AI 回复：**\n${round.aiMessages.join('\n\n---\n\n')}\n\n---\n\n`
            }

            syncPrompt += `### 要求\n\n请用 JSON 数组格式输出汇总结果，每轮对话一个 JSON 对象：\n\n\`\`\`json\n[\n${batchRounds.map(r => `  {\n    "round": ${r.roundNumber},\n    "summary": "用简洁的语言汇总 AI 在这一轮中做了什么，重点关注：执行了什么操作、修改了哪些文件、解决了什么问题。200-500字以内。"\n  }`).join(',\n')}\n]\n\`\`\`\n\n只输出 JSON 数组，不要输出其他内容。`

            // 通知前端正在同步
            this.broadcastSyncStatus(reviewSession, {
                status: 'syncing',
                totalRounds: allRounds.length,
                summarizedRounds: existingRounds.length,
                pendingRounds: pendingRounds.length,
                syncingRounds: batchRounds.map(r => r.roundNumber)
            })

            // 发送给 Review AI
            await this.engine.sendMessage(reviewSession.reviewSessionId, {
                text: syncPrompt,
                sentFrom: 'webapp'
            })

            // 更新状态为 active
            if (reviewSession.status === 'pending') {
                await this.reviewStore.updateReviewSessionStatus(reviewId, 'active')
            }
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

            // 提取汇总
            let summaries: Array<{ round: number; summary: string }> = []

            for (const m of messagesResult.messages.reverse()) {
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
