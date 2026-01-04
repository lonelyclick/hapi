/**
 * AdvisorService - 核心服务：订阅事件、摘要、建议解析、广播
 */

import { randomUUID } from 'node:crypto'
import type { SyncEngine, SyncEvent, DecryptedMessage, Session, AdvisorAlertData, AdvisorIdleSuggestionData } from '../sync/syncEngine'
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
    private idleTimers: Map<string, NodeJS.Timeout> = new Map()    // sessionId -> 空闲计时器（60秒摘要）
    private idleCheckTimers: Map<string, NodeJS.Timeout> = new Map()  // sessionId -> 空闲检查计时器（30秒建议）
    private broadcastedSet: Set<string> = new Set()                // 已广播的 suggestionId:status:sessionId
    private evaluationTimer: NodeJS.Timeout | null = null
    private telegramNotifier: AdvisorTelegramNotifier | null = null

    // 空闲检查配置
    private readonly idleCheckTimeoutMs = 30_000  // 30秒静默后触发检查

    // SESSION_SUMMARY 推送频率控制
    private lastSummaryHash: Map<string, string> = new Map()       // sessionId -> 上次摘要的内容哈希
    private lastSummaryTime: Map<string, number> = new Map()       // sessionId -> 上次推送时间戳
    private readonly summaryMinIntervalMs = 30_000                 // 最小推送间隔 30 秒

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

        // 清理所有空闲检查计时器
        for (const timer of this.idleCheckTimers.values()) {
            clearTimeout(timer)
        }
        this.idleCheckTimers.clear()

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

        // 忽略来自 Advisor 发送的消息（包括 SESSION_SUMMARY）
        const meta = content.meta as Record<string, unknown> | null
        if (meta?.sentFrom === 'advisor') {
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

        // 获取会话信息
        const session = this.syncEngine.getSession(sessionId)
        if (!session || session.namespace !== this.namespace) {
            return
        }

        // 更新待处理消息计数
        const currentCount = (this.pendingMessageCounts.get(sessionId) ?? 0) + 1
        this.pendingMessageCounts.set(sessionId, currentCount)

        // 重置空闲计时器（60秒摘要）
        this.resetIdleTimer(sessionId)

        // 重置空闲检查计时器（30秒建议）
        this.resetIdleCheckTimer(sessionId)

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
     * 重置空闲检查计时器（30秒静默后触发建议检查）
     */
    private resetIdleCheckTimer(sessionId: string): void {
        const existingTimer = this.idleCheckTimers.get(sessionId)
        if (existingTimer) {
            clearTimeout(existingTimer)
        }

        const timer = setTimeout(() => {
            this.idleCheckTimers.delete(sessionId)
            this.performIdleCheck(sessionId).catch(error => {
                console.error('[AdvisorService] Idle check error:', error)
            })
        }, this.idleCheckTimeoutMs)

        this.idleCheckTimers.set(sessionId, timer)
    }

    /**
     * 执行空闲检查
     */
    private async performIdleCheck(sessionId: string): Promise<void> {
        const session = this.syncEngine.getSession(sessionId)
        if (!session || !session.active) {
            return
        }

        // 本地快速检查
        const issues = this.quickLocalCheck(session)

        if (issues.length === 0) {
            console.log(`[AdvisorService] Idle check passed for ${sessionId}`)
            return
        }

        // 有问题，生成建议
        await this.generateIdleSuggestion(sessionId, session, issues)
    }

    /**
     * 本地快速检查（无需 AI）
     */
    private quickLocalCheck(session: Session): Array<{ type: string; description: string; severity: 'low' | 'medium' | 'high'; data?: unknown }> {
        const issues: Array<{ type: string; description: string; severity: 'low' | 'medium' | 'high'; data?: unknown }> = []

        // 1. 检查 Todos 完成情况
        if (session.todos && Array.isArray(session.todos) && session.todos.length > 0) {
            const todos = session.todos as Array<{ content?: string; status?: string }>
            const inProgressTodos = todos.filter(t => t.status === 'in_progress')
            const pendingTodos = todos.filter(t => t.status === 'pending')

            if (inProgressTodos.length > 0) {
                const todoTitles = inProgressTodos.slice(0, 3).map(t => t.content || '未命名任务').join(', ')
                issues.push({
                    type: 'incomplete_todos',
                    description: `有 ${inProgressTodos.length} 个任务正在进行中: ${todoTitles}`,
                    severity: 'medium',
                    data: { inProgressCount: inProgressTodos.length, pendingCount: pendingTodos.length, titles: todoTitles }
                })
            }
        }

        // 2. 检查最近消息中的错误
        const recentMessages = this.syncEngine.getMessagesAfter(session.id, {
            afterSeq: Math.max(0, session.seq - 20),
            limit: 20
        })

        let errorCount = 0
        let lastError = ''
        for (const msg of recentMessages) {
            const content = msg.content as Record<string, unknown>
            const text = this.extractMessageText(content)
            if (/error|failed|exception|crash|错误|失败|异常/i.test(text)) {
                errorCount++
                if (!lastError && text.length < 200) {
                    lastError = text.slice(0, 100)
                }
            }
        }

        if (errorCount > 0) {
            issues.push({
                type: 'recent_errors',
                description: `最近有 ${errorCount} 条消息包含错误信息`,
                severity: errorCount >= 3 ? 'high' : 'medium',
                data: { errorCount, lastError }
            })
        }

        // 3. 检查任务是否卡住（thinking 超时）
        if (session.thinking && session.thinkingAt) {
            const thinkingDuration = Date.now() - session.thinkingAt
            if (thinkingDuration > 120_000) {  // 超过2分钟
                issues.push({
                    type: 'stalled_task',
                    description: `任务已运行 ${Math.floor(thinkingDuration / 60000)} 分钟，可能卡住`,
                    severity: 'high',
                    data: { duration: thinkingDuration }
                })
            }
        }

        return issues
    }

    /**
     * 从消息内容中提取文本（复用现有逻辑）
     */
    private extractMessageText(content: Record<string, unknown>): string {
        const innerContent = content.content as Record<string, unknown> | string | null
        if (typeof innerContent === 'string') {
            return innerContent
        }
        if (innerContent && typeof innerContent === 'object') {
            const contentType = (innerContent as Record<string, unknown>).type as string
            if (contentType === 'codex') {
                const data = (innerContent as Record<string, unknown>).data as Record<string, unknown>
                if (data?.type === 'message' && typeof data.message === 'string') {
                    return data.message
                }
            } else if (contentType === 'text') {
                return ((innerContent as Record<string, unknown>).text as string) || ''
            }
        }
        return ''
    }

    /**
     * 生成空闲建议
     */
    private async generateIdleSuggestion(
        sessionId: string,
        session: Session,
        issues: Array<{ type: string; description: string; severity: 'low' | 'medium' | 'high'; data?: unknown }>
    ): Promise<void> {
        const primaryIssue = issues[0]
        if (!primaryIssue) return

        // 根据问题类型生成建议
        const categoryMap: Record<string, 'todo_check' | 'error_analysis' | 'code_review' | 'general'> = {
            'incomplete_todos': 'todo_check',
            'recent_errors': 'error_analysis',
            'stalled_task': 'general'
        }

        const titleMap: Record<string, string> = {
            'incomplete_todos': '继续未完成的任务',
            'recent_errors': '处理检测到的错误',
            'stalled_task': '检查任务运行状态'
        }

        const suggestedTextMap: Record<string, (data: unknown) => string> = {
            'incomplete_todos': (data) => {
                const d = data as { titles?: string }
                return `请继续完成任务: ${d?.titles || '进行中的任务'}`
            },
            'recent_errors': (data) => {
                const d = data as { lastError?: string }
                return d?.lastError
                    ? `请检查并修复错误: ${d.lastError}`
                    : '请检查最近的错误并修复'
            },
            'stalled_task': () => '任务似乎卡住了，请检查运行状态或考虑重启'
        }

        const suggestion: AdvisorIdleSuggestionData = {
            suggestionId: randomUUID(),
            sessionId,
            title: titleMap[primaryIssue.type] || '会话检查建议',
            detail: issues.map(i => i.description).join('\n'),
            reason: `会话静默 30 秒，检测到 ${issues.length} 个待处理项`,
            category: categoryMap[primaryIssue.type] || 'general',
            severity: primaryIssue.severity,
            suggestedText: suggestedTextMap[primaryIssue.type]?.(primaryIssue.data),
            createdAt: Date.now()
        }

        // 广播建议
        await this.broadcastIdleSuggestion(suggestion)
    }

    /**
     * 广播空闲建议
     */
    private async broadcastIdleSuggestion(suggestion: AdvisorIdleSuggestionData): Promise<void> {
        const event: SyncEvent = {
            type: 'advisor-idle-suggestion',
            namespace: this.namespace,
            sessionId: suggestion.sessionId,
            idleSuggestion: suggestion
        }

        this.syncEngine.emit(event)
        console.log(`[AdvisorService] Idle suggestion broadcasted: ${suggestion.suggestionId} - ${suggestion.title}`)
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
        const sessionState = this.store.getAgentSessionState(sessionId)
        const lastSeq = sessionState?.lastSeq ?? 0

        // 获取增量消息
        const incrementalMessages = this.syncEngine.getMessagesAfter(sessionId, { afterSeq: lastSeq, limit: 200 })
        if (incrementalMessages.length === 0) {
            return
        }

        // 构建摘要 - 使用增量消息，同时传入之前的摘要作为上下文
        const previousSummary = sessionState?.summary ? JSON.parse(sessionState.summary) as SessionSummary : null
        const summary = this.buildSummary(session, incrementalMessages, previousSummary)

        // 如果摘要没有有意义的内容，跳过投递
        const codeChangesCount = summary.codeChanges?.length ?? 0
        const errorCount = summary.errors?.length ?? 0
        if (!summary.recentActivity && codeChangesCount === 0 && errorCount === 0) {
            // 但仍然更新 lastSeq 避免重复处理相同消息
            const newSeq = incrementalMessages[incrementalMessages.length - 1]?.seq ?? lastSeq
            this.store.upsertAgentSessionState(sessionId, session.namespace, {
                lastSeq: newSeq,
                summary: sessionState?.summary  // 保留之前的摘要
            })
            this.pendingMessageCounts.set(sessionId, 0)
            return
        }

        // 更新 session state
        const newSeq = incrementalMessages[incrementalMessages.length - 1]?.seq ?? lastSeq
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
    private buildSummary(session: Session, messages: DecryptedMessage[], previousSummary?: SessionSummary | null): SessionSummary {
        const metadata = session.metadata
        const workDir = metadata?.path || 'unknown'
        const project = workDir.split('/').pop() || 'unknown'

        // 从之前的摘要继承内容（如果有），同时过滤掉 init prompt 内容
        const filterInitPrompt = (items: string[]) => items.filter(item => !item.trim().startsWith('#InitPrompt-'))
        const activities: string[] = []
        const errors: string[] = previousSummary?.errors ? filterInitPrompt([...previousSummary.errors]) : []
        const decisions: string[] = previousSummary?.decisions ? filterInitPrompt([...previousSummary.decisions]) : []
        const codeChanges: string[] = previousSummary?.codeChanges ? filterInitPrompt([...previousSummary.codeChanges]) : []

        // 预过滤消息：排除 advisor 发送的消息和 SESSION_SUMMARY 消息
        const filteredMessages = messages.filter(msg => {
            const content = msg.content as Record<string, unknown> | null
            if (!content) return false

            // 检查 meta.sentFrom
            const meta = content.meta as Record<string, unknown> | null
            if (meta?.sentFrom === 'advisor') return false

            // 检查 event/output 类型
            const innerContent = content.content as Record<string, unknown> | null
            if (innerContent && typeof innerContent === 'object') {
                const contentType = (innerContent as Record<string, unknown>).type as string
                if (contentType === 'event' || contentType === 'output') return false
            }

            return true
        })

        for (const msg of filteredMessages) {
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
                    // 跳过非 message 类型的 codex 消息 (token_count, tool-call, tool-call-result 等)
                } else if (contentType === 'text') {
                    // 用户消息格式: { role: 'user', content: { type: 'text', text: '...' } }
                    text = ((innerContent as Record<string, unknown>).text as string) || ''
                } else {
                    // 其他对象格式（event/output 已在预过滤中排除）
                    text = ((innerContent as Record<string, unknown>).text as string) || ''
                }
            } else if (typeof innerContent === 'string') {
                text = innerContent
            }

            if (!text) continue

            // 跳过 init prompt 消息（以 #InitPrompt- 开头的消息）
            const trimmedText = text.trim()
            if (trimmedText.startsWith('#InitPrompt-')) {
                continue
            }

            // 跳过 SESSION_SUMMARY 消息（避免递归）
            if (trimmedText.startsWith('[[SESSION_SUMMARY]]')) {
                continue
            }

            // 简单的活动分类 - 限制长度以节省 token
            if (text.length > 100) {
                activities.push(text.slice(0, 100) + '...')
            } else {
                activities.push(text)
            }

            // 检测错误
            if (/error|failed|exception|crash|错误|失败/i.test(text)) {
                errors.push(text.slice(0, 80))
            }

            // 检测决策 - 只保留关键决策
            if (/decided|choose|选择|决定|采用|will use|架构|设计/i.test(text)) {
                decisions.push(text.slice(0, 80))
            }

            // 检测代码变更 (来自 agent 的消息)
            if (isAgentMessage && /created|modified|edited|deleted|wrote|创建|修改|编辑|删除|写入/i.test(text)) {
                codeChanges.push(text.slice(0, 80))
            }
        }

        // 如果当前增量没有活动，使用之前的活动
        const finalActivity = activities.length > 0
            ? activities.slice(-3).join('\n')  // 减少为3条
            : (previousSummary?.recentActivity || '')

        // 精简 todos - 只保留状态和标题
        const simplifiedTodos = session.todos && Array.isArray(session.todos)
            ? (session.todos as Array<{ content?: string; status?: string }>)
                .filter(t => t.status === 'in_progress' || t.status === 'pending')
                .slice(0, 5)
                .map(t => ({ s: t.status?.charAt(0), t: t.content?.slice(0, 50) }))
            : undefined

        return {
            sessionId: session.id,
            namespace: session.namespace,
            workDir,
            project,
            recentActivity: finalActivity,
            todos: simplifiedTodos,
            codeChanges: codeChanges.slice(-3),  // 减少为3条
            errors: errors.slice(-2),  // 减少为2条
            decisions: decisions.slice(-2),  // 减少为2条
            messageCount: filteredMessages.length,
            lastMessageSeq: filteredMessages[filteredMessages.length - 1]?.seq ?? 0,
            timestamp: Date.now()
        }
    }

    /**
     * 计算摘要内容哈希（用于去重）
     */
    private computeSummaryHash(summary: SessionSummary): string {
        // 只对关键内容计算哈希，忽略时间戳等动态字段
        const hashContent = {
            recentActivity: summary.recentActivity,
            codeChanges: summary.codeChanges,
            errors: summary.errors,
            decisions: summary.decisions,
            todos: summary.todos
        }
        return JSON.stringify(hashContent)
    }

    /**
     * 检查是否应该推送摘要
     */
    private shouldDeliverSummary(sessionId: string, summary: SessionSummary, hash: string): { should: boolean; reason: string } {
        const now = Date.now()
        const lastTime = this.lastSummaryTime.get(sessionId) ?? 0
        const lastHash = this.lastSummaryHash.get(sessionId)
        const timeSinceLastPush = now - lastTime

        // 1. messageCount=0 时，降低推送频率或跳过
        if (summary.messageCount === 0) {
            // 如果没有新消息，完全跳过推送
            return { should: false, reason: 'messageCount=0, no new activity' }
        }

        // 2. 检查推送间隔
        if (timeSinceLastPush < this.summaryMinIntervalMs) {
            return { should: false, reason: `interval too short (${Math.round(timeSinceLastPush / 1000)}s < ${this.summaryMinIntervalMs / 1000}s)` }
        }

        // 3. 检查内容是否有变化
        if (lastHash && hash === lastHash) {
            return { should: false, reason: 'content unchanged (duplicate)' }
        }

        // 4. 检查是否有实质性活动
        const hasActivity = Boolean(summary.recentActivity) ||
            (summary.codeChanges?.length ?? 0) > 0 ||
            (summary.errors?.length ?? 0) > 0

        if (!hasActivity) {
            return { should: false, reason: 'no meaningful activity' }
        }

        return { should: true, reason: 'ok' }
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

        const sessionId = summary.sessionId
        const hash = this.computeSummaryHash(summary)

        // 检查是否应该推送
        const { should, reason } = this.shouldDeliverSummary(sessionId, summary, hash)
        if (!should) {
            console.log(`[AdvisorService] Skip summary for session ${sessionId}: ${reason}`)
            return
        }

        const content = `[[SESSION_SUMMARY]]${JSON.stringify(summary, null, 2)}`

        try {
            await this.syncEngine.sendMessage(advisorSessionId, {
                text: content,
                sentFrom: 'advisor'
            })

            // 更新推送记录
            this.lastSummaryHash.set(sessionId, hash)
            this.lastSummaryTime.set(sessionId, Date.now())

            console.log(`[AdvisorService] Summary delivered for session ${sessionId}`)
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

        if (msgContent && typeof msgContent === 'object') {
            const contentType = (msgContent as Record<string, unknown>).type as string

            // 格式 1: Claude Code 格式 { type: 'output', data: { type: 'assistant', message: { content: [...] } } }
            if (contentType === 'output') {
                const data = (msgContent as Record<string, unknown>).data as Record<string, unknown>
                if (data?.type === 'assistant') {
                    const message = data.message as Record<string, unknown>
                    const contentArray = message?.content as Array<Record<string, unknown>>
                    if (Array.isArray(contentArray)) {
                        // 拼接所有 text 类型的内容
                        for (const item of contentArray) {
                            if (item.type === 'text' && typeof item.text === 'string') {
                                text += item.text + '\n'
                            }
                        }
                    }
                }
            }
            // 格式 2: Codex 格式 { type: 'codex', data: { type: 'message', message: '...' } }
            else if (contentType === 'codex') {
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

        // 对于 critical/high 级别的建议，发送全局 alert 事件
        if (suggestion.severity === 'critical' || suggestion.severity === 'high') {
            this.broadcastAlert(suggestion)
        }

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
     * 广播全局 alert（用于 critical/high 级别建议）
     */
    private broadcastAlert(suggestion: StoredAgentSuggestion): void {
        const alertData: AdvisorAlertData = {
            suggestionId: suggestion.id,
            title: suggestion.title,
            detail: suggestion.detail ?? undefined,
            category: suggestion.category ?? undefined,
            severity: suggestion.severity as 'critical' | 'high',
            sourceSessionId: suggestion.sourceSessionId ?? undefined
        }

        const event: SyncEvent = {
            type: 'advisor-alert',
            namespace: suggestion.namespace,
            alert: alertData
        }

        this.syncEngine.emit(event)
        console.log(`[AdvisorService] Broadcasted alert: ${suggestion.severity} - ${suggestion.title}`)
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
