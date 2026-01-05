/**
 * 自动迭代功能 - 审计日志
 */

import { randomUUID } from 'node:crypto'
import type { IStore } from '../../store'
import type {
    ActionRequest,
    AutoIterationLog,
    ExecutionStatus,
    ApprovalMethod
} from './types'

/**
 * 审计日志管理器
 */
export class AuditLogger {
    constructor(
        private store: IStore,
        private namespace: string = 'default'
    ) {}

    /**
     * 创建执行日志
     */
    async createLog(request: ActionRequest, suggestionId?: string): Promise<AutoIterationLog | null> {
        const id = `ail_${Date.now()}_${randomUUID().slice(0, 8)}`

        const storedLog = await this.store.createAutoIterationLog({
            id,
            namespace: this.namespace,
            sourceSuggestionId: suggestionId,
            sourceSessionId: request.sourceSessionId,
            projectPath: request.targetProject,
            actionType: request.actionType,
            actionDetail: request.steps,
            reason: request.reason
        })

        if (!storedLog) {
            console.error('[AutoIteration] Failed to create audit log')
            return null
        }

        console.log(`[AutoIteration] Created log ${id} for action ${request.actionType}`)

        return this.toAutoIterationLog(storedLog)
    }

    /**
     * 更新日志状态
     */
    async updateLog(id: string, update: {
        executionStatus?: ExecutionStatus
        approvalMethod?: ApprovalMethod
        approvedBy?: string
        approvedAt?: number
        resultJson?: unknown
        errorMessage?: string
        rollbackAvailable?: boolean
        rollbackData?: unknown
        rolledBack?: boolean
        rolledBackAt?: number
        executedAt?: number
    }): Promise<boolean> {
        const success = await this.store.updateAutoIterationLog(id, update)

        if (success && update.executionStatus) {
            console.log(`[AutoIteration] Log ${id} status updated to ${update.executionStatus}`)
        }

        return success
    }

    /**
     * 标记为已批准
     */
    async markApproved(id: string, method: ApprovalMethod, approvedBy?: string): Promise<boolean> {
        return await this.updateLog(id, {
            executionStatus: 'approved',
            approvalMethod: method,
            approvedBy,
            approvedAt: Date.now()
        })
    }

    /**
     * 标记为执行中
     */
    async markExecuting(id: string): Promise<boolean> {
        return await this.updateLog(id, {
            executionStatus: 'executing'
        })
    }

    /**
     * 标记为已完成
     */
    async markCompleted(id: string, result?: unknown, rollbackData?: unknown): Promise<boolean> {
        return await this.updateLog(id, {
            executionStatus: 'completed',
            resultJson: result,
            rollbackAvailable: !!rollbackData,
            rollbackData,
            executedAt: Date.now()
        })
    }

    /**
     * 标记为失败
     */
    async markFailed(id: string, errorMessage: string, rollbackData?: unknown): Promise<boolean> {
        return await this.updateLog(id, {
            executionStatus: 'failed',
            errorMessage,
            rollbackAvailable: !!rollbackData,
            rollbackData,
            executedAt: Date.now()
        })
    }

    /**
     * 标记为已拒绝
     */
    async markRejected(id: string, reason?: string): Promise<boolean> {
        return await this.updateLog(id, {
            executionStatus: 'rejected',
            errorMessage: reason
        })
    }

    /**
     * 标记为已取消
     */
    async markCancelled(id: string): Promise<boolean> {
        return await this.updateLog(id, {
            executionStatus: 'cancelled'
        })
    }

    /**
     * 标记为超时
     */
    async markTimeout(id: string): Promise<boolean> {
        return await this.updateLog(id, {
            executionStatus: 'timeout'
        })
    }

    /**
     * 标记为已回滚
     */
    async markRolledBack(id: string): Promise<boolean> {
        return await this.updateLog(id, {
            rolledBack: true,
            rolledBackAt: Date.now()
        })
    }

    /**
     * 获取日志
     */
    async getLog(id: string): Promise<AutoIterationLog | null> {
        const storedLog = await this.store.getAutoIterationLog(id)
        return storedLog ? this.toAutoIterationLog(storedLog) : null
    }

    /**
     * 获取日志列表
     */
    async getLogs(filters?: {
        status?: ExecutionStatus | ExecutionStatus[]
        actionType?: string
        projectPath?: string
        limit?: number
        offset?: number
    }): Promise<AutoIterationLog[]> {
        const storedLogs = await this.store.getAutoIterationLogs(this.namespace, filters as Parameters<Store['getAutoIterationLogs']>[1])
        return storedLogs.map(log => this.toAutoIterationLog(log))
    }

    /**
     * 获取待处理的日志
     */
    async getPendingLogs(): Promise<AutoIterationLog[]> {
        return await this.getLogs({ status: ['pending', 'approved'] })
    }

    /**
     * 清理旧日志
     */
    async cleanupOldLogs(keepDays: number): Promise<number> {
        const count = await this.store.cleanupOldAutoIterationLogs(this.namespace, keepDays)
        if (count > 0) {
            console.log(`[AutoIteration] Cleaned up ${count} old logs`)
        }
        return count
    }

    /**
     * 获取统计信息
     */
    async getStats(): Promise<{
        total: number
        pending: number
        completed: number
        failed: number
        rejected: number
    }> {
        const allLogs = await this.getLogs({ limit: 1000 })

        return {
            total: allLogs.length,
            pending: allLogs.filter(l => l.executionStatus === 'pending').length,
            completed: allLogs.filter(l => l.executionStatus === 'completed').length,
            failed: allLogs.filter(l => l.executionStatus === 'failed').length,
            rejected: allLogs.filter(l => l.executionStatus === 'rejected').length
        }
    }

    /**
     * 转换存储类型到业务类型
     */
    private toAutoIterationLog(stored: ReturnType<Store['getAutoIterationLog']>): AutoIterationLog {
        if (!stored) throw new Error('Stored log is null')

        return {
            id: stored.id,
            namespace: stored.namespace,
            sourceSuggestionId: stored.sourceSuggestionId ?? undefined,
            sourceSessionId: stored.sourceSessionId ?? undefined,
            projectPath: stored.projectPath ?? undefined,
            actionType: stored.actionType,
            actionDetail: (stored.actionDetail as AutoIterationLog['actionDetail']) ?? [],
            reason: stored.reason ?? undefined,
            executionStatus: stored.executionStatus,
            approvalMethod: stored.approvalMethod ?? undefined,
            approvedBy: stored.approvedBy ?? undefined,
            approvedAt: stored.approvedAt ?? undefined,
            resultJson: stored.resultJson,
            errorMessage: stored.errorMessage ?? undefined,
            rollbackAvailable: stored.rollbackAvailable,
            rollbackData: stored.rollbackData,
            rolledBack: stored.rolledBack,
            rolledBackAt: stored.rolledBackAt ?? undefined,
            createdAt: stored.createdAt,
            executedAt: stored.executedAt ?? undefined
        }
    }
}
