/**
 * AdvisorService - 核心服务：订阅事件、摘要、建议解析、广播
 */

import { randomUUID } from 'node:crypto'
import type { SyncEngine, SyncEvent, DecryptedMessage, Session } from '../sync/syncEngine'
import type { Store, StoredAgentSuggestion, SuggestionStatus } from '../store'
import type { AdvisorScheduler } from './advisorScheduler'
import { SuggestionEvaluator } from './suggestionEvaluator'
import type {
    SessionSummary,
    AdvisorOutput,
    AdvisorSuggestionOutput,
    AdvisorMemoryOutput,
    AdvisorEventMessage,
    AdvisorEventData
} from './types'
import { ADVISOR_OUTPUT_PATTERN } from './types'

export interface AdvisorServiceConfig {
    namespace: string
    summaryThreshold?: number      // 触发摘要的消息数阈值
    summaryIdleTimeoutMs?: number  // 空闲多久后触发摘要
    evaluationIntervalMs?: number  // 评估建议状态的间隔
}

export class AdvisorService {
    private syncEngine: SyncEngine
    private store: Store
    private scheduler: AdvisorScheduler
    private evaluator: SuggestionEvaluator
    private namespace: string
    private summaryThreshold: number
    private summaryIdleTimeoutMs: number
    private evaluationIntervalMs: number

    private unsubscribe: (() => void) | null = null
    private pendingMessageCounts: Map<string, number> = new Map()  // sessionId -> 待处理消息计数
    private idleTimers: Map<string, NodeJS.Timeout> = new Map()    // sessionId -> 空闲计时器
    private broadcastedSet: Set<string> = new Set()                // 已广播的 suggestionId:status:sessionId
    private evaluationTimer: NodeJS.Timeout | null = null
    private telegramNotifier: AdvisorTelegramNotifier | null = null

    constructor(
        syncEngine: SyncEngine,
        store: Store,
        scheduler: AdvisorScheduler,
        config: AdvisorServiceConfig
    ) {
        this.syncEngine = syncEngine
        this.store = store
        this.scheduler = scheduler
        this.namespace = config.namespace
        this.summaryThreshold = config.summaryThreshold ?? 10
        this.summaryIdleTimeoutMs = config.summaryIdleTimeoutMs ?? 60_000
        this.evaluationIntervalMs = config.evaluationIntervalMs ?? 300_000  // 5分钟
        this.evaluator = new SuggestionEvaluator(store, syncEngine)
    }

    /**
     * 设置 Telegram 通知器
     */
    setTelegramNotifier(notifier: AdvisorTelegramNotifier): void {
        this.telegramNotifier = notifier
    }

    /**
     * 启动服务
     */
    start(): void {
        // 订阅事件
        this.unsubscribe = this.syncEngine.subscribe((event) => {
            this.handleSyncEvent(event)
        })

        // 启动定期评估
        this.evaluationTimer = setInterval(() => {
            this.evaluatePendingSuggestions().catch(error => {
                console.error('[AdvisorService] Evaluation error:', error)
            })
        }, this.evaluationIntervalMs)

        console.log('[AdvisorService] Started')
    }

    /**
     * 停止服务
     */
    stop(): void {
        if (this.unsubscribe) {
            this.unsubscribe()
            this.unsubscribe = null
        }

        if (this.evaluationTimer) {
            clearInterval(this.evaluationTimer)
            this.evaluationTimer = null
        }

        // 清理所有空闲计时器
        for (const timer of this.idleTimers.values()) {
            clearTimeout(timer)
        }
        this.idleTimers.clear()

        console.log('[AdvisorService] Stopped')
    }

    /**
     * 处理 SyncEngine 事件
     */
    private handleSyncEvent(event: SyncEvent): void {
        if (event.type === 'message-received' && event.sessionId && event.message) {
            this.onMessage(event.sessionId, event.message)
        }
    }

    /**
     * 处理新消息
     */
    private onMessage(sessionId: string, message: DecryptedMessage): void {
        const content = message.content as Record<string, unknown> | null
        if (!content) {
            return
        }

        // 检查是否是 Advisor 会话
        if (this.scheduler.isAdvisorSession(sessionId)) {
            // 解析 Advisor 输出 (agent 角色的 codex 消息)
            if (content.role === 'agent' || content.role === 'assistant') {
                this.parseAdvisorOutput(sessionId, content)
            }
            return
        }

        // 忽略来自 Advisor 广播的事件消息
        const meta = content.meta as Record<string, unknown> | null
        if (meta?.sentFrom === 'advisor') {
            return
        }

        // 获取会话信息
        const session = this.syncEngine.getSession(sessionId)
        if (!session || session.namespace !== this.namespace) {
            return
        }

        // 更新待处理消息计数
        const currentCount = (this.pendingMessageCounts.get(sessionId) ?? 0) + 1
        this.pendingMessageCounts.set(sessionId, currentCount)

        // 重置空闲计时器
        this.resetIdleTimer(sessionId)

        // 检查是否达到阈值
        if (currentCount >= this.summaryThreshold) {
            this.generateAndDeliverSummary(sessionId).catch(error => {
                console.error('[AdvisorService] Summary generation error:', error)
            })
        }
    }

    /**
     * 重置空闲计时器
     */
    private resetIdleTimer(sessionId: string): void {
        const existingTimer = this.idleTimers.get(sessionId)
        if (existingTimer) {
            clearTimeout(existingTimer)
        }

        const timer = setTimeout(() => {
            this.idleTimers.delete(sessionId)
            const pendingCount = this.pendingMessageCounts.get(sessionId) ?? 0
            if (pendingCount > 0) {
                this.generateAndDeliverSummary(sessionId).catch(error => {
                    console.error('[AdvisorService] Idle summary error:', error)
                })
            }
        }, this.summaryIdleTimeoutMs)

        this.idleTimers.set(sessionId, timer)
    }

    /**
     * 生成并投递摘要给 Advisor
     */
    private async generateAndDeliverSummary(sessionId: string): Promise<void> {
        const session = this.syncEngine.getSession(sessionId)
        if (!session) {
            return
        }

        // 获取或创建 session state
        let sessionState = this.store.getAgentSessionState(sessionId)
        const lastSeq = sessionState?.lastSeq ?? 0

        // 获取增量消息
        const messages = this.syncEngine.getMessagesAfter(sessionId, { afterSeq: lastSeq, limit: 200 })
        if (messages.length === 0) {
            return
        }

        // 构建摘要
        const summary = this.buildSummary(session, messages)

        // 更新 session state
        const newSeq = messages[messages.length - 1]?.seq ?? lastSeq
        this.store.upsertAgentSessionState(sessionId, session.namespace, {
            lastSeq: newSeq,
            summary: JSON.stringify(summary)
        })

        // 重置待处理消息计数
        this.pendingMessageCounts.set(sessionId, 0)

        // 投递给 Advisor
        await this.deliverToAdvisor(summary)
    }

    /**
     * 构建摘要
     */
    private buildSummary(session: Session, messages: DecryptedMessage[]): SessionSummary {
        const metadata = session.metadata
        const workDir = metadata?.path || 'unknown'
        const project = workDir.split('/').pop() || 'unknown'

        // 提取活动摘要
        const activities: string[] = []
        const errors: string[] = []
        const decisions: string[] = []
        const codeChanges: string[] = []

        for (const msg of messages) {
            const content = msg.content as Record<string, unknown> | null
            if (!content) continue

            const role = content.role as string

            // 提取消息文本 - 处理多种消息格式
            let text = ''
            let isAgentMessage = false

            const innerContent = content.content as Record<string, unknown> | string | null

            // 格式 1: codex 消息 { role: 'agent', content: { type: 'codex', data: { type: 'message', message: '...' } } }
            if (innerContent && typeof innerContent === 'object') {
                const contentType = (innerContent as Record<string, unknown>).type as string
                if (contentType === 'codex') {
                    const data = (innerContent as Record<string, unknown>).data as Record<string, unknown>
                    if (data?.type === 'message' && typeof data.message === 'string') {
                        text = data.message
                        isAgentMessage = role === 'agent'
                    }
                } else if (contentType === 'event') {
                    // 跳过 event 消息
                    continue
                } else {
                    // 其他对象格式
                    text = ((innerContent as Record<string, unknown>).text as string) || ''
                }
            } else if (typeof innerContent === 'string') {
                text = innerContent
            }

            // 格式 2: 用户消息 { role: 'user', content: '...' }
            if (!text && role === 'user' && typeof content.content === 'string') {
                text = content.content
            }

            if (!text) continue

            // 简单的活动分类
            if (text.length > 200) {
                activities.push(text.slice(0, 200) + '...')
            } else {
                activities.push(text)
            }

            // 检测错误
            if (/error|failed|exception|crash|错误|失败/i.test(text)) {
                errors.push(text.slice(0, 100))
            }

            // 检测决策
            if (/decided|choose|选择|决定|采用|will use|using|用/i.test(text)) {
                decisions.push(text.slice(0, 100))
            }

            // 检测代码变更 (来自 agent 的消息)
            if (isAgentMessage && /created|modified|edited|deleted|wrote|创建|修改|编辑|删除|写入/i.test(text)) {
                codeChanges.push(text.slice(0, 100))
            }
        }

        return {
            sessionId: session.id,
            namespace: session.namespace,
            workDir,
            project,
            recentActivity: activities.slice(-5).join('\n'),
            todos: session.todos,
            codeChanges: codeChanges.slice(-5),
            errors: errors.slice(-3),
            decisions: decisions.slice(-3),
            messageCount: messages.length,
            lastMessageSeq: messages[messages.length - 1]?.seq ?? 0,
            timestamp: Date.now()
        }
    }

    /**
     * 投递摘要给 Advisor
     */
    private async deliverToAdvisor(summary: SessionSummary): Promise<void> {
        const advisorSessionId = this.scheduler.getAdvisorSessionId()
        if (!advisorSessionId) {
            console.log('[AdvisorService] No advisor session, skip summary delivery')
            return
        }

        const content = `[[SESSION_SUMMARY]]${JSON.stringify(summary, null, 2)}`

        try {
            await this.syncEngine.sendMessage(advisorSessionId, {
                text: content,
                sentFrom: 'webapp'
            })
            console.log(`[AdvisorService] Summary delivered for session ${summary.sessionId}`)
        } catch (error) {
            console.error('[AdvisorService] Failed to deliver summary:', error)
        }
    }

    /**
     * 解析 Advisor 输出
     */
    private parseAdvisorOutput(sessionId: string, content: Record<string, unknown>): void {
        const msgContent = content.content as Record<string, unknown> | string | null
        let text = ''

        // 处理 codex 格式: { type: 'codex', data: { type: 'message', message: '...' } }
        if (msgContent && typeof msgContent === 'object') {
            const contentType = (msgContent as Record<string, unknown>).type as string
            if (contentType === 'codex') {
                const data = (msgContent as Record<string, unknown>).data as Record<string, unknown>
                if (data?.type === 'message' && typeof data.message === 'string') {
                    text = data.message
                }
            } else {
                text = ((msgContent as Record<string, unknown>).text as string) || ''
            }
        } else if (typeof msgContent === 'string') {
            text = msgContent
        }

        if (!text) {
            return
        }

        // 查找所有 [[HAPI_ADVISOR]] JSON
        const matches = text.matchAll(ADVISOR_OUTPUT_PATTERN)

        for (const match of matches) {
            const jsonStr = match[1]
            try {
                const output = JSON.parse(jsonStr) as AdvisorOutput
                this.handleAdvisorOutput(sessionId, output)
            } catch (error) {
                console.error('[AdvisorService] Failed to parse advisor output:', error, jsonStr)
            }
        }
    }

    /**
     * 处理 Advisor 输出
     */
    private handleAdvisorOutput(advisorSessionId: string, output: AdvisorOutput): void {
        switch (output.type) {
            case 'suggestion':
                this.handleSuggestion(advisorSessionId, output)
                break
            case 'memory':
                this.handleMemory(output)
                break
            case 'action_request':
                // 仅记录，不执行
                console.log('[AdvisorService] Action request received (not executed):', output)
                break
        }
    }

    /**
     * 处理建议
     */
    private handleSuggestion(advisorSessionId: string, output: AdvisorSuggestionOutput): void {
        const suggestionId = output.id || `adv_${Date.now()}_${randomUUID().slice(0, 8)}`

        const suggestion = this.store.createAgentSuggestion({
            id: suggestionId,
            namespace: this.namespace,
            sessionId: advisorSessionId,
            sourceSessionId: output.sourceSessionId,
            title: output.title,
            detail: output.detail,
            category: output.category,
            severity: output.severity,
            confidence: output.confidence,
            scope: output.scope,
            targets: output.targets
        })

        if (suggestion) {
            console.log(`[AdvisorService] Suggestion created: ${suggestion.id} - ${suggestion.title}`)

            // 广播给相关会话
            this.broadcastSuggestion(suggestion)

            // 发送 Telegram 通知
            this.telegramNotifier?.notifySuggestion(suggestion)
        }
    }

    /**
     * 处理记忆
     */
    private handleMemory(output: AdvisorMemoryOutput): void {
        const expiresAt = output.expiresInDays
            ? Date.now() + output.expiresInDays * 24 * 60 * 60 * 1000
            : undefined

        const memory = this.store.createAgentMemory({
            namespace: this.namespace,
            type: output.memoryType,
            contentJson: { content: output.content },
            confidence: output.confidence,
            expiresAt
        })

        if (memory) {
            console.log(`[AdvisorService] Memory created: ${memory.type} - ${output.content.slice(0, 50)}...`)
        }
    }

    /**
     * 广播建议给相关会话
     */
    async broadcastSuggestion(suggestion: StoredAgentSuggestion): Promise<void> {
        const sessions = this.syncEngine.getActiveSessions()
            .filter(s => s.namespace === suggestion.namespace)

        for (const session of sessions) {
            // 排除 Advisor 会话
            if (this.scheduler.isAdvisorSession(session.id)) {
                continue
            }

            // 去重检查
            const key = `${suggestion.id}:${suggestion.status}:${session.id}`
            if (this.broadcastedSet.has(key)) {
                continue
            }
            this.broadcastedSet.add(key)

            // 发送事件消息
            await this.sendEventMessage(session.id, {
                type: 'advisor-suggestion',
                suggestionId: suggestion.id,
                title: suggestion.title,
                detail: suggestion.detail ?? undefined,
                category: suggestion.category ?? undefined,
                severity: suggestion.severity,
                confidence: suggestion.confidence,
                scope: suggestion.scope,
                sourceSessionId: suggestion.sourceSessionId ?? undefined
            })
        }
    }

    /**
     * 广播状态变化
     */
    async broadcastStatusChange(suggestionId: string, newStatus: SuggestionStatus): Promise<void> {
        const suggestion = this.store.getAgentSuggestion(suggestionId)
        if (!suggestion) {
            return
        }

        const sessions = this.syncEngine.getActiveSessions()
            .filter(s => s.namespace === suggestion.namespace)

        for (const session of sessions) {
            if (this.scheduler.isAdvisorSession(session.id)) {
                continue
            }

            const key = `${suggestionId}:status:${newStatus}:${session.id}`
            if (this.broadcastedSet.has(key)) {
                continue
            }
            this.broadcastedSet.add(key)

            await this.sendEventMessage(session.id, {
                type: 'advisor-suggestion-status',
                suggestionId,
                title: suggestion.title,
                status: newStatus
            })
        }

        // 发送 Telegram 通知
        this.telegramNotifier?.notifyStatusChange(suggestion, newStatus)
    }

    /**
     * 发送事件消息（不会被当作用户输入）
     */
    private async sendEventMessage(sessionId: string, data: AdvisorEventData): Promise<void> {
        const message: AdvisorEventMessage = {
            role: 'agent',
            content: {
                type: 'event',
                data
            },
            meta: {
                sentFrom: 'advisor'
            }
        }

        // 直接写入数据库，不通过 sendMessage（避免触发 user 消息处理）
        try {
            this.store.addMessage(sessionId, message)
            console.log(`[AdvisorService] Event message sent to ${sessionId}: ${data.type}`)
        } catch (error) {
            console.error(`[AdvisorService] Failed to send event message to ${sessionId}:`, error)
        }
    }

    /**
     * 评估 pending 建议
     */
    private async evaluatePendingSuggestions(): Promise<void> {
        const results = await this.evaluator.evaluatePendingSuggestions(this.namespace)

        for (const [suggestionId, newStatus] of results) {
            if (newStatus !== 'pending') {
                console.log(`[AdvisorService] Suggestion ${suggestionId} status updated to ${newStatus}`)
                await this.broadcastStatusChange(suggestionId, newStatus)
            }
        }
    }
}

/**
 * Telegram 通知接口（由外部实现）
 */
export interface AdvisorTelegramNotifier {
    notifySuggestion(suggestion: StoredAgentSuggestion): void
    notifyStatusChange(suggestion: StoredAgentSuggestion, newStatus: SuggestionStatus): void
}
