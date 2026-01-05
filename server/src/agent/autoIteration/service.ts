/**
 * 自动迭代功能 - 核心服务
 */

import { EventEmitter } from 'node:events'
import type { IStore } from '../../store'
import type {
    ActionRequest,
    ActionType,
    AutoIterationConfig,
    AutoIterationLog,
    ExecutionPolicy,
    ExecutionStatus,
    NotificationLevel
} from './types'
import { PolicyEngine } from './policyEngine'
import { ExecutionEngine, type RollbackData } from './executionEngine'
import { ApprovalFlow, type NotificationCallback } from './approvalFlow'
import { AuditLogger } from './auditLogger'
import { getDefaultConfig } from './config'

// SyncEngine 的简化接口
interface SyncEngineInterface {
    getSession(sessionId: string): { id: string; active: boolean; metadata: { path?: string } | null } | undefined
    getActiveSessions(namespace: string): Array<{ id: string; active: boolean; metadata: { path?: string } | null }>
    sendMessage(sessionId: string, payload: { text: string; sentFrom?: string }): Promise<void>
    getOnlineMachines(namespace: string): Array<{ id: string; namespace: string; metadata?: unknown }>
    spawnSession(
        machineId: string,
        directory: string,
        agent?: 'claude' | 'codex' | 'gemini' | 'glm' | 'minimax' | 'grok',
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        options?: { sessionId?: string; permissionMode?: string }
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }>
}

export interface AutoIterationServiceEvents {
    'action-request': (request: ActionRequest) => void
    'action-approved': (log: AutoIterationLog) => void
    'action-rejected': (log: AutoIterationLog, reason?: string) => void
    'action-executing': (log: AutoIterationLog) => void
    'action-completed': (log: AutoIterationLog, result?: unknown) => void
    'action-failed': (log: AutoIterationLog, error: string) => void
    'config-updated': (config: AutoIterationConfig) => void
}

/**
 * 自动迭代核心服务
 */
export class AutoIterationService extends EventEmitter {
    private policyEngine!: PolicyEngine
    private executionEngine!: ExecutionEngine
    private approvalFlow!: ApprovalFlow
    private auditLogger!: AuditLogger
    private config!: AutoIterationConfig
    private initialized = false

    constructor(
        private syncEngine: SyncEngineInterface,
        private store: IStore,
        private namespace: string = 'default'
    ) {
        super()
    }

    /**
     * 异步初始化服务
     */
    async init(): Promise<void> {
        if (this.initialized) return

        // 加载配置
        this.config = await this.loadConfig()

        // 初始化组件
        this.auditLogger = new AuditLogger(this.store, this.namespace)
        this.policyEngine = new PolicyEngine(this.config)
        this.executionEngine = new ExecutionEngine(this.syncEngine, this.auditLogger, this.namespace)
        this.approvalFlow = new ApprovalFlow(this.auditLogger)

        this.initialized = true
        console.log(`[AutoIteration] Service initialized for namespace: ${this.namespace}, enabled: ${this.config.enabled}`)
    }

    /**
     * 加载配置
     */
    private async loadConfig(): Promise<AutoIterationConfig> {
        const stored = await this.store.getAutoIterationConfig(this.namespace)
        if (stored) {
            return {
                namespace: stored.namespace,
                enabled: stored.enabled,
                policy: stored.policyJson ?? {},
                allowedProjects: stored.allowedProjects,
                notificationLevel: stored.notificationLevel,
                keepLogsDays: stored.keepLogsDays,
                createdAt: stored.createdAt,
                updatedAt: stored.updatedAt,
                updatedBy: stored.updatedBy ?? undefined
            }
        }

        // 返回默认配置
        return getDefaultConfig(this.namespace)
    }

    /**
     * 设置通知回调
     */
    setNotificationCallback(callback: NotificationCallback): void {
        this.approvalFlow.setNotificationCallback(callback)
    }

    /**
     * 处理 ActionRequest
     */
    async handleActionRequest(request: ActionRequest, suggestionId?: string): Promise<void> {
        console.log(`[AutoIteration] Handling action request: ${request.actionType}`)

        // 1. 创建执行日志
        const log = this.auditLogger.createLog(request, suggestionId)
        if (!log) {
            console.error('[AutoIteration] Failed to create log for action request')
            return
        }

        this.emit('action-request', request)

        // 2. 检查策略
        const { allowed, policy, reason } = this.policyEngine.canExecute(request)

        if (!allowed) {
            this.auditLogger.markRejected(log.id, reason)
            this.emit('action-rejected', log, reason)
            console.log(`[AutoIteration] Action rejected: ${reason}`)
            return
        }

        // 3. 发起审批
        const { approved, method } = await this.approvalFlow.requestApproval(request, log, policy)

        if (!approved) {
            const status = method === 'manual' ? 'rejected' : 'cancelled'
            this.auditLogger.updateLog(log.id, {
                executionStatus: status as ExecutionStatus,
                approvalMethod: method
            })
            this.emit('action-rejected', log, `Approval ${status}`)
            console.log(`[AutoIteration] Action ${status}`)
            return
        }

        // 4. 标记为已批准
        this.auditLogger.markApproved(log.id, method)
        this.emit('action-approved', log)

        // 5. 执行
        this.emit('action-executing', log)
        const result = await this.executionEngine.execute(request, log)

        // 6. 记录结果
        if (result.success) {
            this.auditLogger.markCompleted(log.id, result.result, result.rollbackData)
            this.emit('action-completed', log, result.result)
            console.log(`[AutoIteration] Action completed successfully`)
        } else {
            this.auditLogger.markFailed(log.id, result.error ?? 'Unknown error', result.rollbackData)
            this.emit('action-failed', log, result.error ?? 'Unknown error')
            console.log(`[AutoIteration] Action failed: ${result.error}`)
        }
    }

    // ========== 公开 API ==========

    /**
     * 获取配置
     */
    getConfig(): AutoIterationConfig {
        return this.config
    }

    /**
     * 更新配置
     */
    async updateConfig(update: Partial<{
        enabled: boolean
        policy: Partial<Record<ActionType, ExecutionPolicy>>
        allowedProjects: string[]
        notificationLevel: NotificationLevel
        keepLogsDays: number
        updatedBy: string
    }>): Promise<AutoIterationConfig> {
        const stored = this.store.upsertAutoIterationConfig(this.namespace, {
            enabled: update.enabled,
            policyJson: update.policy,
            allowedProjects: update.allowedProjects,
            notificationLevel: update.notificationLevel,
            keepLogsDays: update.keepLogsDays,
            updatedBy: update.updatedBy
        })

        if (stored) {
            this.config = {
                namespace: stored.namespace,
                enabled: stored.enabled,
                policy: stored.policyJson ?? {},
                allowedProjects: stored.allowedProjects,
                notificationLevel: stored.notificationLevel,
                keepLogsDays: stored.keepLogsDays,
                createdAt: stored.createdAt,
                updatedAt: stored.updatedAt,
                updatedBy: stored.updatedBy ?? undefined
            }

            // 更新策略引擎
            this.policyEngine.updateConfig(this.config)

            this.emit('config-updated', this.config)
            console.log(`[AutoIteration] Config updated, enabled: ${this.config.enabled}`)
        }

        return this.config
    }

    /**
     * 启用自动迭代
     */
    async enable(updatedBy?: string): Promise<void> {
        await this.updateConfig({ enabled: true, updatedBy })
    }

    /**
     * 禁用自动迭代
     */
    async disable(updatedBy?: string): Promise<void> {
        await this.updateConfig({ enabled: false, updatedBy })
    }

    /**
     * 检查是否启用
     */
    isEnabled(): boolean {
        return this.config.enabled
    }

    /**
     * 获取执行日志
     */
    getLogs(filters?: {
        status?: ExecutionStatus | ExecutionStatus[]
        actionType?: ActionType
        projectPath?: string
        limit?: number
        offset?: number
    }): AutoIterationLog[] {
        return this.auditLogger.getLogs(filters)
    }

    /**
     * 获取单条日志
     */
    getLog(id: string): AutoIterationLog | null {
        return this.auditLogger.getLog(id)
    }

    /**
     * 手动审批
     */
    handleApproval(logId: string, approved: boolean, userId?: string): boolean {
        const result = this.approvalFlow.handleUserResponse(logId, approved, userId)

        if (result) {
            console.log(`[AutoIteration] Manual approval for ${logId}: ${approved ? 'approved' : 'rejected'}`)
        }

        return result
    }

    /**
     * 回滚操作
     */
    async rollback(logId: string): Promise<boolean> {
        const log = this.auditLogger.getLog(logId)
        if (!log) {
            console.error(`[AutoIteration] Log ${logId} not found`)
            return false
        }

        if (!log.rollbackAvailable || log.rolledBack) {
            console.error(`[AutoIteration] Cannot rollback log ${logId}`)
            return false
        }

        const success = await this.executionEngine.rollback(log.rollbackData as RollbackData)

        if (success) {
            this.auditLogger.markRolledBack(logId)
            console.log(`[AutoIteration] Rolled back ${logId}`)
        }

        return success
    }

    /**
     * 获取策略概览
     */
    getPolicySummary(): Record<ActionType, { policy: ExecutionPolicy; isCustom: boolean }> {
        return this.policyEngine.getPolicySummary()
    }

    /**
     * 获取待处理的审批
     */
    getPendingApprovals(): Array<{
        logId: string
        request: ActionRequest
        log: AutoIterationLog
    }> {
        return this.approvalFlow.getPendingApprovals()
    }

    /**
     * 获取统计信息
     */
    getStats(): {
        total: number
        pending: number
        completed: number
        failed: number
        rejected: number
    } {
        return this.auditLogger.getStats()
    }

    /**
     * 清理旧日志
     */
    cleanupOldLogs(): number {
        return this.auditLogger.cleanupOldLogs(this.config.keepLogsDays)
    }

    /**
     * 关闭服务
     */
    shutdown(): void {
        this.approvalFlow.clearAllPending()
        console.log('[AutoIteration] Service shutdown')
    }
}
