/**
 * Review 同步检测服务
 *
 * 主 Session 每轮对话结束后，检查是否有活跃的 Review Session 需要同步新数据
 */

import type { SyncEngine, SyncEvent } from '../sync/syncEngine'
import type { SSEManager } from '../sse/sseManager'
import type { ReviewStore } from './store'

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

function groupMessagesIntoRounds(messages: Array<{ id: string; content: unknown }>): DialogueRound[] {
    const rounds: DialogueRound[] = []
    let currentRound: DialogueRound | null = null
    let roundNumber = 0

    for (const message of messages) {
        const userText = extractUserText(message.content)
        const aiText = extractAIText(message.content)

        if (userText) {
            // 用户输入开始新的一轮
            if (currentRound) {
                rounds.push(currentRound)
            }
            roundNumber++
            currentRound = {
                roundNumber,
                userInput: userText,
                aiMessages: [],
                messageIds: [message.id]
            }
        } else if (aiText && currentRound) {
            // AI 回复添加到当前轮
            currentRound.aiMessages.push(aiText)
            currentRound.messageIds.push(message.id)
        }
    }

    // 添加最后一轮
    if (currentRound) {
        rounds.push(currentRound)
    }

    return rounds
}

export class AutoReviewService {
    private engine: SyncEngine
    private reviewStore: ReviewStore
    private sseManager: SSEManager | null = null

    constructor(engine: SyncEngine, reviewStore: ReviewStore) {
        this.engine = engine
        this.reviewStore = reviewStore
    }

    /**
     * 设置 SSE Manager（用于通知前端）
     */
    setSseManager(sseManager: SSEManager): void {
        this.sseManager = sseManager
    }

    /**
     * 启动服务，监听 session-updated 事件（AI 回复结束）
     */
    start(): void {
        this.engine.subscribe(this.handleEvent.bind(this))
        console.log('[ReviewSync] Service started - monitoring session updates')
    }

    private async handleEvent(event: SyncEvent): Promise<void> {
        // 监听 session-updated 事件，检查是否是 AI 回复结束
        if (event.type !== 'session-updated') return
        if (!event.sessionId) return

        const data = event.data as { wasThinking?: boolean; thinking?: boolean } | undefined

        // wasThinking: true 表示 AI 刚刚完成思考（从 thinking 变为非 thinking）
        if (!data?.wasThinking) return

        const sessionId = event.sessionId

        // 检查是否是 Review Session（不处理 Review Session 自己的事件）
        const session = this.engine.getSession(sessionId)
        if (session?.metadata?.source === 'review') return

        // 检查是否有活跃的 Review Session
        await this.checkAndNotifyPendingRounds(sessionId)
    }

    /**
     * 检查是否有未同步的轮次，并通知前端
     */
    private async checkAndNotifyPendingRounds(mainSessionId: string): Promise<void> {
        try {
            // 获取活跃的 Review Session
            const reviewSession = await this.reviewStore.getActiveReviewSession(mainSessionId)
            if (!reviewSession) {
                // 没有活跃的 Review Session，不需要处理
                return
            }

            // 获取主 Session 所有消息
            const allMessages = await this.engine.getAllMessages(mainSessionId)

            // 按轮次分组
            const allRounds = groupMessagesIntoRounds(allMessages)

            // 获取已汇总的轮次
            const existingRounds = await this.reviewStore.getReviewRounds(reviewSession.id)
            const summarizedRoundNumbers = new Set(existingRounds.map(r => r.roundNumber))

            // 计算未汇总的轮次
            const pendingRounds = allRounds.filter(r => !summarizedRoundNumbers.has(r.roundNumber))

            console.log(`[ReviewSync] Session ${mainSessionId.slice(0, 8)}: total=${allRounds.length}, summarized=${existingRounds.length}, pending=${pendingRounds.length}`)

            // 通过 SSE 通知前端
            if (this.sseManager) {
                const session = this.engine.getSession(mainSessionId)
                if (session) {
                    this.sseManager.broadcast({
                        type: 'review-sync-status',
                        namespace: session.namespace,
                        sessionId: mainSessionId,
                        data: {
                            reviewSessionId: reviewSession.id,
                            totalRounds: allRounds.length,
                            summarizedRounds: existingRounds.length,
                            pendingRounds: pendingRounds.length,
                            hasPendingRounds: pendingRounds.length > 0
                        }
                    } as SyncEvent)
                }
            }
        } catch (err) {
            console.error('[ReviewSync] Failed to check pending rounds:', err)
        }
    }
}
