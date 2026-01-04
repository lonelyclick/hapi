/**
 * AdvisorService - 核心服务：订阅事件、摘要、建议解析、广播
 */

import { randomUUID } from 'node:crypto'
import type { SyncEngine, SyncEvent, DecryptedMessage, Session, AdvisorAlertData, AdvisorIdleSuggestionData, SuggestionChip } from '../sync/syncEngine'
import type { Store, StoredAgentSuggestion, SuggestionStatus } from '../store'
import type { AdvisorScheduler } from './advisorScheduler'
import { SuggestionEvaluator } from './suggestionEvaluator'
import { MinimaxService } from './minimaxService'
import type {
    SessionSummary,
    AdvisorOutput,
    AdvisorSuggestionOutput,
    AdvisorMemoryOutput,
    AdvisorEventMessage,
    AdvisorEventData,
    AdvisorActionRequestOutput
} from './types'
import { ADVISOR_OUTPUT_PATTERN } from './types'
import type { AutoIterationService } from './autoIteration'
import type { ActionRequest } from './autoIteration/types'

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
    private minimaxService: MinimaxService
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
    private autoIterationService: AutoIterationService | null = null

    // 空闲检查配置
    private readonly idleCheckTimeoutMs = 30_000  // 30秒静默后触发检查

    // SESSION_SUMMARY 推送频率控制
    private lastSummaryHash: Map<string, string> = new Map()       // sessionId -> 上次摘要的内容哈希
    private lastSummaryTime: Map<string, number> = new Map()       // sessionId -> 上次推送时间戳
    private readonly summaryMinIntervalMs = 30_000                 // 最小推送间隔 30 秒

    // MiniMax 审查并发控制
    private minimaxReviewingSet: Set<string> = new Set()           // 正在审查的 sessionId

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
        this.minimaxService = new MinimaxService()
    }

    /**
     * 设置 Telegram 通知器
     */
    setTelegramNotifier(notifier: AdvisorTelegramNotifier): void {
        this.telegramNotifier = notifier
    }

    /**
     * 设置自动迭代服务
     */
    setAutoIterationService(service: AutoIterationService): void {
        this.autoIterationService = service
        console.log('[AdvisorService] AutoIterationService connected')
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

        // 监听 session-updated 事件，检测 AI 回复完成
        if (event.type === 'session-updated' && event.sessionId) {
            const data = event.data as { wasThinking?: boolean; thinking?: boolean } | null
            // wasThinking=true 且 thinking=false 表示 AI 刚完成回复
            if (data?.wasThinking && data.thinking === false) {
                this.onThinkingComplete(event.sessionId)
            }
        }
    }

    /**
     * AI 回复完成时触发双层建议
     */
    private onThinkingComplete(sessionId: string): void {
        const session = this.syncEngine.getSession(sessionId)
        if (!session || session.namespace !== this.namespace) {
            return
        }

        // 排除 Advisor 会话
        if (this.scheduler.isAdvisorSession(sessionId)) {
            return
        }

        console.log(`[AdvisorService] Thinking complete for session ${sessionId}, triggering dual-layer suggestions`)

        // Layer 1: 立即执行本地检查（同步）
        this.performIdleCheck(sessionId).catch(error => {
            console.error('[AdvisorService] Layer 1 idle check error:', error)
        })

        // Layer 2: 异步启动 MiniMax 审查（不阻塞）
        this.performMinimaxReview(sessionId).catch(error => {
            console.error('[AdvisorService] Layer 2 MiniMax review error:', error)
        })
    }

    /**
     * 执行 MiniMax 审查（Layer 2）
     */
    private async performMinimaxReview(sessionId: string): Promise<void> {
        // 并发控制：同一 session 同时只能有一个审查
        if (this.minimaxReviewingSet.has(sessionId)) {
            console.log(`[AdvisorService] MiniMax review already in progress for ${sessionId}`)
            return
        }

        const session = this.syncEngine.getSession(sessionId)
        if (!session) {
            return
        }

        this.minimaxReviewingSet.add(sessionId)

        try {
            // 1. 广播开始事件
            this.broadcastMinimaxStart(sessionId)

            // 2. 构建摘要
            const summary = this.buildSummaryForMinimax(session)

            // 3. 调用 MiniMax
            const result = await this.minimaxService.reviewSession({ sessionId, summary })

            // 4. 广播结果或错误
            if (result.error) {
                this.broadcastMinimaxError(sessionId, result.error)
            } else if (result.chips.length > 0) {
                this.broadcastMinimaxComplete(sessionId, result.chips)
            } else {
                // 没有建议时也广播完成（空芯片）
                this.broadcastMinimaxComplete(sessionId, [])
            }
        } finally {
            this.minimaxReviewingSet.delete(sessionId)
        }
    }

    /**
     * 为 MiniMax 构建摘要
     */
    private buildSummaryForMinimax(session: Session): SessionSummary {
        const metadata = session.metadata
        const workDir = metadata?.path || 'unknown'
        const project = workDir.split('/').pop() || 'unknown'

        // 获取最近消息
        const recentMessages = this.syncEngine.getMessagesAfter(session.id, {
            afterSeq: Math.max(0, session.seq - 50),
            limit: 50
        })

        // 提取活动、代码变更、错误、决策
        const activities: string[] = []
        const codeChanges: string[] = []
        const errors: string[] = []
        const decisions: string[] = []

        for (const msg of recentMessages) {
            const content = msg.content as Record<string, unknown> | null
            if (!content) continue

            const text = this.extractMessageText(content)
            if (!text || text.startsWith('#InitPrompt-') || text.startsWith('[[SESSION_SUMMARY]]')) {
                continue
            }

            const shortText = text.slice(0, 100)
            activities.push(shortText)

            if (/error|failed|exception|错误|失败/i.test(text)) {
                errors.push(shortText)
            }
            if (/decided|choose|选择|决定|采用/i.test(text)) {
                decisions.push(shortText)
            }
            if (/created|modified|edited|wrote|创建|修改|编辑|写入/i.test(text)) {
                codeChanges.push(shortText)
            }
        }

        // 简化 todos
        const simplifiedTodos = session.todos && Array.isArray(session.todos)
            ? (session.todos as Array<{ content?: string; status?: string }>)
                .slice(0, 5)
                .map(t => ({ s: t.status?.charAt(0), t: t.content?.slice(0, 50) }))
            : undefined

        return {
            sessionId: session.id,
            namespace: session.namespace,
            workDir,
            project,
            recentActivity: activities.slice(-5).join('\n'),
            todos: simplifiedTodos,
            codeChanges: codeChanges.slice(-3),
            errors: errors.slice(-2),
            decisions: decisions.slice(-2),
            messageCount: recentMessages.length,
            lastMessageSeq: recentMessages[recentMessages.length - 1]?.seq ?? 0,
            timestamp: Date.now()
        }
    }

    /**
     * 广播 MiniMax 开始事件
     */
    private broadcastMinimaxStart(sessionId: string): void {
        const event: SyncEvent = {
            type: 'advisor-minimax-start',
            namespace: this.namespace,
            sessionId,
            minimaxStart: { sessionId }
        }
        this.syncEngine.emit(event)
        console.log(`[AdvisorService] MiniMax review started for ${sessionId}`)
    }

    /**
     * 广播 MiniMax 完成事件
     */
    private broadcastMinimaxComplete(sessionId: string, chips: SuggestionChip[]): void {
        const event: SyncEvent = {
            type: 'advisor-minimax-complete',
            namespace: this.namespace,
            sessionId,
            minimaxComplete: { sessionId, chips }
        }
        this.syncEngine.emit(event)
        console.log(`[AdvisorService] MiniMax review complete for ${sessionId}: ${chips.length} chips`)
    }

    /**
     * 广播 MiniMax 错误事件
     */
    private broadcastMinimaxError(sessionId: string, error: string): void {
        const event: SyncEvent = {
            type: 'advisor-minimax-error',
            namespace: this.namespace,
            sessionId,
            minimaxError: { sessionId, error }
        }
        this.syncEngine.emit(event)
        console.log(`[AdvisorService] MiniMax review error for ${sessionId}: ${error}`)
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

        // 1. 检查 Todos 完成情况 - 包括 in_progress 和 pending
        if (session.todos && Array.isArray(session.todos) && session.todos.length > 0) {
            const todos = session.todos as Array<{ content?: string; status?: string; activeForm?: string }>
            const inProgressTodos = todos.filter(t => t.status === 'in_progress')
            const pendingTodos = todos.filter(t => t.status === 'pending')
            const completedTodos = todos.filter(t => t.status === 'completed')
            const incompleteTodos = [...inProgressTodos, ...pendingTodos]

            if (incompleteTodos.length > 0) {
                const todoTitles = incompleteTodos.slice(0, 3).map(t => t.content || t.activeForm || '未命名任务').join(', ')
                const severity = inProgressTodos.length > 0 ? 'medium' : 'low'
                issues.push({
                    type: 'incomplete_todos',
                    description: inProgressTodos.length > 0
                        ? `有 ${inProgressTodos.length} 个任务正在进行中: ${todoTitles}`
                        : `有 ${pendingTodos.length} 个待处理任务: ${todoTitles}`,
                    severity,
                    data: {
                        inProgressCount: inProgressTodos.length,
                        pendingCount: pendingTodos.length,
                        completedCount: completedTodos.length,
                        totalCount: todos.length,
                        titles: todoTitles,
                        todos: incompleteTodos.slice(0, 5)
                    }
                })
            }
        }

        // 2. 检查最近消息中的错误和警告
        const recentMessages = this.syncEngine.getMessagesAfter(session.id, {
            afterSeq: Math.max(0, session.seq - 30),
            limit: 30
        })

        let errorCount = 0
        let warningCount = 0
        let lastError = ''
        let lastWarning = ''
        let hasTypeError = false
        let hasTestFailure = false
        let hasBuildError = false

        for (const msg of recentMessages) {
            const content = msg.content as Record<string, unknown>
            const text = this.extractMessageText(content)

            // 检测错误
            if (/error|failed|exception|crash|错误|失败|异常/i.test(text)) {
                errorCount++
                if (!lastError && text.length < 200) {
                    lastError = text.slice(0, 100)
                }
                // 检测特定错误类型
                if (/typescript|type\s*error|类型错误/i.test(text)) hasTypeError = true
                if (/test.*fail|测试.*失败|jest|vitest|mocha/i.test(text)) hasTestFailure = true
                if (/build.*fail|编译.*失败|compile.*error/i.test(text)) hasBuildError = true
            }

            // 检测警告
            if (/warning|warn|警告|deprecated/i.test(text) && !/error/i.test(text)) {
                warningCount++
                if (!lastWarning && text.length < 200) {
                    lastWarning = text.slice(0, 100)
                }
            }
        }

        if (errorCount > 0) {
            issues.push({
                type: 'recent_errors',
                description: `最近有 ${errorCount} 条消息包含错误信息`,
                severity: errorCount >= 3 ? 'high' : 'medium',
                data: { errorCount, lastError, hasTypeError, hasTestFailure, hasBuildError }
            })
        }

        if (warningCount > 0) {
            issues.push({
                type: 'recent_warnings',
                description: `最近有 ${warningCount} 条警告信息`,
                severity: 'low',
                data: { warningCount, lastWarning }
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

        // 4. 检查会话空闲时间
        const idleTime = Date.now() - session.updatedAt
        if (idleTime > 60_000) {  // 超过1分钟空闲
            issues.push({
                type: 'session_idle',
                description: `会话已空闲 ${Math.floor(idleTime / 60000)} 分钟`,
                severity: 'low',
                data: { idleTime, lastActivity: session.updatedAt }
            })
        }

        // 5. 检查项目路径提取信息
        const metadata = session.metadata
        if (metadata?.path) {
            const projectPath = metadata.path
            const projectName = projectPath.split('/').pop() || 'unknown'
            issues.push({
                type: 'project_context',
                description: `当前项目: ${projectName}`,
                severity: 'low',
                data: { projectPath, projectName, host: metadata.host }
            })
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
     * 生成空闲建议（多个芯片）
     */
    private async generateIdleSuggestion(
        sessionId: string,
        session: Session,
        issues: Array<{ type: string; description: string; severity: 'low' | 'medium' | 'high'; data?: unknown }>
    ): Promise<void> {
        if (issues.length === 0) return

        const chips: SuggestionChip[] = []

        // 根据问题类型生成芯片
        for (const issue of issues) {
            const newChips = this.generateChipsForIssue(issue, session)
            chips.push(...newChips)
        }

        // 添加通用建议芯片
        chips.push(...this.generateGeneralChips(session, issues))

        // 限制芯片数量（最多 6 个）
        const finalChips = chips.slice(0, 6)

        if (finalChips.length === 0) return

        const suggestion: AdvisorIdleSuggestionData = {
            suggestionId: randomUUID(),
            sessionId,
            chips: finalChips,
            reason: `检测到 ${issues.length} 个待处理项`,
            createdAt: Date.now()
        }

        // 广播建议
        await this.broadcastIdleSuggestion(suggestion)
    }

    /**
     * 根据问题类型生成芯片
     */
    private generateChipsForIssue(
        issue: { type: string; description: string; severity: 'low' | 'medium' | 'high'; data?: unknown },
        session: Session
    ): SuggestionChip[] {
        const chips: SuggestionChip[] = []

        switch (issue.type) {
            case 'incomplete_todos': {
                const data = issue.data as {
                    titles?: string
                    inProgressCount?: number
                    pendingCount?: number
                    completedCount?: number
                    totalCount?: number
                    todos?: Array<{ content?: string; activeForm?: string }>
                }
                if (data?.inProgressCount && data.inProgressCount > 0) {
                    chips.push({
                        id: randomUUID(),
                        label: '继续任务',
                        text: `请继续完成进行中的任务`,
                        category: 'todo_check',
                        icon: '▶️'
                    })
                }
                if (data?.pendingCount && data.pendingCount > 0) {
                    // 添加第一个待办任务的具体芯片
                    const firstTodo = data.todos?.[0]
                    if (firstTodo) {
                        const todoName = firstTodo.content || firstTodo.activeForm || '待处理任务'
                        chips.push({
                            id: randomUUID(),
                            label: todoName.slice(0, 12) + (todoName.length > 12 ? '...' : ''),
                            text: `请处理任务: ${todoName}`,
                            category: 'todo_check',
                            icon: '📋'
                        })
                    }
                    // 如果有多个待办，添加"处理所有"芯片
                    if (data.pendingCount > 1) {
                        chips.push({
                            id: randomUUID(),
                            label: `全部 ${data.pendingCount} 项`,
                            text: `请依次处理剩余的 ${data.pendingCount} 个待办任务`,
                            category: 'todo_check',
                            icon: '📝'
                        })
                    }
                }
                break
            }
            case 'recent_errors': {
                const data = issue.data as {
                    lastError?: string
                    errorCount?: number
                    hasTypeError?: boolean
                    hasTestFailure?: boolean
                    hasBuildError?: boolean
                }
                // 根据错误类型生成更具体的芯片
                if (data?.hasTypeError) {
                    chips.push({
                        id: randomUUID(),
                        label: '修复类型',
                        text: '请检查并修复 TypeScript 类型错误',
                        category: 'error_analysis',
                        icon: '🔷'
                    })
                }
                if (data?.hasTestFailure) {
                    chips.push({
                        id: randomUUID(),
                        label: '修复测试',
                        text: '请检查失败的测试用例并修复',
                        category: 'error_analysis',
                        icon: '🧪'
                    })
                }
                if (data?.hasBuildError) {
                    chips.push({
                        id: randomUUID(),
                        label: '修复构建',
                        text: '请修复构建/编译错误',
                        category: 'error_analysis',
                        icon: '🔨'
                    })
                }
                // 通用错误修复
                if (!data?.hasTypeError && !data?.hasTestFailure && !data?.hasBuildError) {
                    chips.push({
                        id: randomUUID(),
                        label: '修复错误',
                        text: data?.lastError
                            ? `请检查并修复错误: ${data.lastError}`
                            : '请检查最近的错误并修复',
                        category: 'error_analysis',
                        icon: '🔧'
                    })
                }
                if (data?.errorCount && data.errorCount > 1) {
                    chips.push({
                        id: randomUUID(),
                        label: '分析全部',
                        text: `分析最近的 ${data.errorCount} 个错误并给出修复建议`,
                        category: 'error_analysis',
                        icon: '🔍'
                    })
                }
                break
            }
            case 'recent_warnings': {
                const data = issue.data as { warningCount?: number; lastWarning?: string }
                chips.push({
                    id: randomUUID(),
                    label: '处理警告',
                    text: data?.lastWarning
                        ? `请处理警告: ${data.lastWarning}`
                        : `请检查并处理 ${data?.warningCount || ''} 个警告`,
                    category: 'code_review',
                    icon: '⚠️'
                })
                break
            }
            case 'stalled_task': {
                const data = issue.data as { duration?: number }
                const minutes = data?.duration ? Math.floor(data.duration / 60000) : 0
                chips.push({
                    id: randomUUID(),
                    label: '检查状态',
                    text: `任务已运行 ${minutes} 分钟，请检查是否卡住`,
                    category: 'general',
                    icon: '⏸️'
                })
                chips.push({
                    id: randomUUID(),
                    label: '重试任务',
                    text: '如果任务卡住，请考虑中断并重试',
                    category: 'general',
                    icon: '🔄'
                })
                break
            }
            case 'session_idle': {
                // 空闲时不生成特定芯片，由通用芯片处理
                break
            }
            case 'project_context': {
                // 项目上下文不生成芯片，仅用于辅助生成其他建议
                break
            }
        }

        return chips
    }

    /**
     * 生成通用建议芯片
     */
    private generateGeneralChips(
        session: Session,
        issues: Array<{ type: string; description: string; severity: 'low' | 'medium' | 'high'; data?: unknown }>
    ): SuggestionChip[] {
        const chips: SuggestionChip[] = []

        // 获取项目信息
        const projectContext = issues.find(i => i.type === 'project_context')
        const projectData = projectContext?.data as { projectName?: string; projectPath?: string } | undefined

        // 如果有 Todos，添加进度相关芯片
        if (session.todos && Array.isArray(session.todos) && session.todos.length > 0) {
            const todos = session.todos as Array<{ status?: string; content?: string }>
            const completedCount = todos.filter(t => t.status === 'completed').length
            const totalCount = todos.length

            if (completedCount > 0 && completedCount < totalCount) {
                chips.push({
                    id: randomUUID(),
                    label: '总结进度',
                    text: `当前任务进度: ${completedCount}/${totalCount} 已完成。请总结已完成的工作并继续剩余任务。`,
                    category: 'general',
                    icon: '📊'
                })
            }

            // 如果全部完成
            if (completedCount === totalCount && totalCount > 0) {
                chips.push({
                    id: randomUUID(),
                    label: '任务完成',
                    text: '所有任务已完成！请总结本次工作成果。',
                    category: 'general',
                    icon: '✅'
                })
            }
        }

        // 常用开发操作建议
        const hasErrors = issues.some(i => i.type === 'recent_errors')
        const hasTodos = issues.some(i => i.type === 'incomplete_todos')

        // 如果没有明显问题，提供通用建议
        if (!hasErrors && !hasTodos) {
            chips.push({
                id: randomUUID(),
                label: '运行测试',
                text: '请运行测试确保代码正常工作',
                category: 'code_review',
                icon: '🧪'
            })

            chips.push({
                id: randomUUID(),
                label: '代码审查',
                text: '请检查最近的代码变更，确保代码质量',
                category: 'code_review',
                icon: '👀'
            })

            if (projectData?.projectName) {
                chips.push({
                    id: randomUUID(),
                    label: '提交代码',
                    text: `请检查 ${projectData.projectName} 的改动并提交代码`,
                    category: 'general',
                    icon: '💾'
                })
            }
        }

        // 空闲时间较长时的建议
        const idleIssue = issues.find(i => i.type === 'session_idle')
        if (idleIssue) {
            const idleData = idleIssue.data as { idleTime?: number }
            const idleMinutes = idleData?.idleTime ? Math.floor(idleData.idleTime / 60000) : 0

            if (idleMinutes >= 5) {
                chips.push({
                    id: randomUUID(),
                    label: '继续工作',
                    text: '会话已空闲一段时间，请继续之前的工作',
                    category: 'general',
                    icon: '💪'
                })
            }

            // 提供下一步建议
            chips.push({
                id: randomUUID(),
                label: '下一步？',
                text: '请告诉我接下来需要做什么',
                category: 'general',
                icon: '❓'
            })
        }

        return chips
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
        console.log(`[AdvisorService] Idle suggestion broadcasted: ${suggestion.suggestionId} - ${suggestion.chips.length} chips`)
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
                this.handleActionRequest(advisorSessionId, output as AdvisorActionRequestOutput)
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
     * 处理执行请求（自动迭代）
     */
    private handleActionRequest(advisorSessionId: string, output: AdvisorActionRequestOutput): void {
        console.log(`[AdvisorService] Action request received: ${output.actionType}`)

        // 检查是否连接了自动迭代服务
        if (!this.autoIterationService) {
            console.log('[AdvisorService] AutoIterationService not connected, action request ignored')
            return
        }

        // 检查自动迭代是否启用
        if (!this.autoIterationService.isEnabled()) {
            console.log('[AdvisorService] AutoIteration is disabled, action request ignored')
            return
        }

        // 转换为 ActionRequest 格式
        const actionRequest: ActionRequest = {
            type: 'action_request',
            id: output.id || `act_${Date.now()}_${randomUUID().slice(0, 8)}`,
            actionType: output.actionType,
            targetSessionId: output.targetSessionId,
            targetProject: output.targetProject,
            steps: output.steps || [],
            reason: output.reason || '',
            expectedOutcome: output.expectedOutcome || '',
            riskLevel: output.riskLevel || 'medium',
            reversible: output.reversible ?? true,
            dependsOn: output.dependsOn,
            sourceSessionId: output.sourceSessionId || advisorSessionId,
            confidence: output.confidence ?? 0.7
        }

        // 发送给自动迭代服务处理
        this.autoIterationService.handleActionRequest(actionRequest).catch(error => {
            console.error('[AdvisorService] Failed to handle action request:', error)
        })
    }

    /**
     * 广播建议给相关会话
     */
    async broadcastSuggestion(suggestion: StoredAgentSuggestion): Promise<void> {
        const sessions = this.syncEngine.getActiveSessions()
            .filter(s => s.namespace === suggestion.namespace)

        // 对于所有级别的建议，发送全局 alert 事件
        // 之前只有 critical/high，现在改为所有级别都广播
        this.broadcastAlert(suggestion)

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
            severity: suggestion.severity as 'critical' | 'high' | 'medium' | 'low',
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
