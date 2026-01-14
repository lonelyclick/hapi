/**
 * 自动 Review 服务
 *
 * 每 N 轮对话自动触发 Review AI 总结
 */

import type { SyncEngine, SyncEvent, DecryptedMessage } from '../sync/syncEngine'
import type { ReviewStore } from './store'

// 配置：每多少轮用户对话触发一次自动 Review
const AUTO_REVIEW_INTERVAL = 5

// 默认 Review 模型
const DEFAULT_REVIEW_MODEL = 'claude'

export class AutoReviewService {
    private engine: SyncEngine
    private reviewStore: ReviewStore
    // 记录每个 Session 的用户消息计数（从上次 Review 后开始计数）
    private sessionMessageCounts: Map<string, number> = new Map()
    // 正在进行 Review 的 Session（防止重复触发）
    private reviewingSessionIds: Set<string> = new Set()
    // Review Session 监听器（等待 Review AI 完成）
    private reviewWatchers: Map<string, {
        reviewSessionId: string
        mainSessionId: string
        reviewId: string
        messageCountAtStart: number
    }> = new Map()

    constructor(engine: SyncEngine, reviewStore: ReviewStore) {
        this.engine = engine
        this.reviewStore = reviewStore
    }

    /**
     * 启动服务，监听消息事件
     */
    start(): void {
        this.engine.subscribe(this.handleEvent.bind(this))
        console.log('[AutoReview] Service started, interval:', AUTO_REVIEW_INTERVAL)
    }

    private async handleEvent(event: SyncEvent): Promise<void> {
        if (event.type !== 'message-received') return
        if (!event.sessionId || !event.message) return

        const sessionId = event.sessionId
        const content = event.message.content as Record<string, unknown>
        const role = content?.role

        // 检查是否是 Review Session 的消息
        const watcher = this.reviewWatchers.get(sessionId)
        if (watcher) {
            // 这是 Review Session 的消息
            if (role === 'agent') {
                await this.handleReviewResponse(watcher, event.message)
            }
            return
        }

        // 只统计用户消息
        if (role !== 'user') return

        // 检查是否是 Review 产生的 Session（不要递归触发）
        const session = this.engine.getSession(sessionId)
        if (session?.metadata?.source === 'review') return

        // 增加计数
        const currentCount = (this.sessionMessageCounts.get(sessionId) ?? 0) + 1
        this.sessionMessageCounts.set(sessionId, currentCount)

        console.log(`[AutoReview] Session ${sessionId.slice(0, 8)} message count: ${currentCount}/${AUTO_REVIEW_INTERVAL}`)

        // 检查是否达到阈值
        if (currentCount >= AUTO_REVIEW_INTERVAL) {
            // 防止重复触发
            if (this.reviewingSessionIds.has(sessionId)) {
                return
            }

            this.reviewingSessionIds.add(sessionId)
            // 重置计数
            this.sessionMessageCounts.set(sessionId, 0)

            // 异步触发 Review
            this.triggerAutoReview(sessionId).catch(err => {
                console.error('[AutoReview] Failed to trigger review:', err)
                this.reviewingSessionIds.delete(sessionId)
            })
        }
    }

    /**
     * 触发自动 Review
     */
    private async triggerAutoReview(mainSessionId: string): Promise<void> {
        console.log(`[AutoReview] Triggering review for session ${mainSessionId.slice(0, 8)}`)

        const session = this.engine.getSession(mainSessionId)
        if (!session || !session.active) {
            console.log('[AutoReview] Session not active, skipping')
            this.reviewingSessionIds.delete(mainSessionId)
            return
        }

        const machineId = session.metadata?.machineId?.trim()
        if (!machineId) {
            console.log('[AutoReview] Session has no machine, skipping')
            this.reviewingSessionIds.delete(mainSessionId)
            return
        }

        const machine = this.engine.getMachine(machineId)
        if (!machine || !machine.active) {
            console.log('[AutoReview] Machine not active, skipping')
            this.reviewingSessionIds.delete(mainSessionId)
            return
        }

        const directory = session.metadata?.path
        if (!directory) {
            console.log('[AutoReview] Session has no directory, skipping')
            this.reviewingSessionIds.delete(mainSessionId)
            return
        }

        // 创建 Review Session
        const spawnResult = await this.engine.spawnSession(
            machineId,
            directory,
            DEFAULT_REVIEW_MODEL,
            false,
            'simple',
            undefined,
            {
                source: 'review'
            }
        )

        if (spawnResult.type !== 'success') {
            console.error('[AutoReview] Failed to spawn review session:', spawnResult.message)
            this.reviewingSessionIds.delete(mainSessionId)
            return
        }

        const reviewSessionId = spawnResult.sessionId
        console.log(`[AutoReview] Created review session ${reviewSessionId.slice(0, 8)}`)

        // 等待 Session 上线
        const isOnline = await this.waitForOnline(reviewSessionId, 60_000)
        if (!isOnline) {
            console.error('[AutoReview] Review session failed to come online')
            this.reviewingSessionIds.delete(mainSessionId)
            return
        }

        // 保存到数据库
        const reviewRecord = await this.reviewStore.createReviewSession({
            namespace: session.namespace,
            mainSessionId,
            reviewSessionId,
            reviewModel: DEFAULT_REVIEW_MODEL,
            contextSummary: '(auto-review)'
        })

        // 获取主 Session 的对话内容
        const summary = await this.buildConversationSummary(mainSessionId)
        if (!summary) {
            console.error('[AutoReview] Failed to build conversation summary')
            this.reviewingSessionIds.delete(mainSessionId)
            return
        }

        // 设置 Watcher 监听 Review 回复
        this.reviewWatchers.set(reviewSessionId, {
            reviewSessionId,
            mainSessionId,
            reviewId: reviewRecord.id,
            messageCountAtStart: 0
        })

        // 发送总结给 Review Session
        await this.engine.sendMessage(reviewSessionId, {
            text: summary,
            sentFrom: 'webapp'
        })

        // 更新状态为 active
        await this.reviewStore.updateReviewSessionStatus(reviewRecord.id, 'active')

        console.log(`[AutoReview] Sent summary to review session ${reviewSessionId.slice(0, 8)}`)
    }

    /**
     * 处理 Review Session 的回复
     */
    private async handleReviewResponse(
        watcher: {
            reviewSessionId: string
            mainSessionId: string
            reviewId: string
            messageCountAtStart: number
        },
        message: DecryptedMessage
    ): Promise<void> {
        const content = message.content as Record<string, unknown>

        // 解析 agent 消息
        let payload: Record<string, unknown> | null = null
        const rawContent = content?.content
        if (typeof rawContent === 'string') {
            try {
                payload = JSON.parse(rawContent)
            } catch {
                return
            }
        } else if (typeof rawContent === 'object' && rawContent) {
            payload = rawContent as Record<string, unknown>
        }

        if (!payload) return

        const data = payload.data as Record<string, unknown>
        if (!data || data.type !== 'assistant') return

        // 提取 AI 回复文本
        const msg = data.message as Record<string, unknown>
        if (!msg?.content) return

        const contentArr = msg.content as Array<{ type?: string; text?: string }>
        const texts: string[] = []
        for (const item of contentArr) {
            if (item.type === 'text' && item.text) {
                texts.push(item.text)
            }
        }

        if (texts.length === 0) return

        const reviewText = texts.join('\n\n')
        console.log(`[AutoReview] Got review response for session ${watcher.mainSessionId.slice(0, 8)}`)

        // 发送 Review 结果到主 Session
        const reviewMessage = `## Auto Review 反馈

以下是来自 Review AI 的自动反馈意见：

---

${reviewText}

---

*此消息由 Auto Review 自动生成*`

        await this.engine.sendMessage(watcher.mainSessionId, {
            text: reviewMessage,
            sentFrom: 'webapp'
        })

        // 更新状态
        await this.reviewStore.completeReviewSession(watcher.reviewId, reviewText)

        // 清理
        this.reviewWatchers.delete(watcher.reviewSessionId)
        this.reviewingSessionIds.delete(watcher.mainSessionId)

        console.log(`[AutoReview] Completed review for session ${watcher.mainSessionId.slice(0, 8)}`)
    }

    /**
     * 构建对话摘要
     */
    private async buildConversationSummary(sessionId: string): Promise<string | null> {
        const messagesResult = await this.engine.getMessagesPage(sessionId, { limit: 100, beforeSeq: null })
        const dialogueMessages: Array<{ role: string; text: string }> = []

        for (const m of messagesResult.messages) {
            const content = m.content as Record<string, unknown>
            const role = content?.role

            if (role === 'user') {
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

                const text = typeof payload?.text === 'string' ? payload.text : ''
                if (text) {
                    dialogueMessages.push({ role: 'User', text })
                }
            } else if (role === 'agent') {
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
                            const text = item.text
                            dialogueMessages.push({ role: 'AI', text: text.slice(0, 2000) + (text.length > 2000 ? '...(truncated)' : '') })
                        }
                    }
                }
            }
        }

        if (dialogueMessages.length === 0) {
            return null
        }

        // 取最近的对话
        const recentMessages = dialogueMessages.slice(-40)

        return `以下是主 Session 中的对话内容，请进行 Review 并给出反馈：

---

${recentMessages.map((msg) => `**${msg.role}**: ${msg.text}`).join('\n\n---\n\n')}

---

请分析上述对话内容，关注：
1. 用户的需求是否被正确理解和完成
2. AI 的实现是否有问题或可以改进
3. 代码是否有 bug、安全问题或性能问题
4. 有什么遗漏或需要注意的地方

请给出简洁的 Review 意见。`
    }

    /**
     * 等待 Session 上线
     */
    private async waitForOnline(sessionId: string, timeoutMs: number): Promise<boolean> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const session = this.engine.getSession(sessionId)
            if (session?.active) {
                return true
            }
            await new Promise(resolve => setTimeout(resolve, 500))
        }
        return false
    }
}
