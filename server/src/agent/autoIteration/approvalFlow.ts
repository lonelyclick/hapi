/**
 * 自动迭代功能 - 审批流程
 */

import type { ActionRequest, AutoIterationLog, ExecutionPolicy, ApprovalMethod } from './types'
import type { AuditLogger } from './auditLogger'

// 通知回调类型
export type NotificationCallback = (
    request: ActionRequest,
    log: AutoIterationLog,
    options: {
        type: 'notify_then_execute' | 'require_confirm'
        timeoutSeconds?: number
        message: string
    }
) => Promise<void>

interface PendingApproval {
    request: ActionRequest
    log: AutoIterationLog
    timer?: ReturnType<typeof setTimeout>
    resolve: (result: { approved: boolean; method: ApprovalMethod }) => void
}

/**
 * 审批流程管理器
 */
export class ApprovalFlow {
    // 等待确认的请求
    private pendingApprovals: Map<string, PendingApproval> = new Map()

    // 通知回调（由外部设置，如 Telegram Bot）
    private notificationCallback?: NotificationCallback

    // 默认超时时间（秒）
    private defaultTimeoutSeconds = 30

    constructor(private auditLogger: AuditLogger) {}

    /**
     * 设置通知回调
     */
    setNotificationCallback(callback: NotificationCallback): void {
        this.notificationCallback = callback
    }

    /**
     * 发起审批流程
     */
    async requestApproval(
        request: ActionRequest,
        log: AutoIterationLog,
        policy: ExecutionPolicy
    ): Promise<{ approved: boolean; method: ApprovalMethod }> {
        switch (policy) {
            case 'auto_execute':
                // 自动批准
                console.log(`[AutoIteration] Auto-approving ${log.id}`)
                return { approved: true, method: 'auto' }

            case 'notify_then_execute':
                // 通知后自动执行
                return await this.notifyThenExecute(request, log)

            case 'require_confirm':
                // 等待用户确认
                return await this.requireConfirm(request, log)

            case 'always_manual':
            case 'disabled':
            default:
                // 不自动执行
                console.log(`[AutoIteration] Rejecting ${log.id} due to policy: ${policy}`)
                return { approved: false, method: 'auto' }
        }
    }

    /**
     * 通知后执行（给定时间取消）
     */
    private async notifyThenExecute(
        request: ActionRequest,
        log: AutoIterationLog
    ): Promise<{ approved: boolean; method: ApprovalMethod }> {
        const timeoutSeconds = this.defaultTimeoutSeconds

        // 1. 发送通知
        if (this.notificationCallback) {
            await this.notificationCallback(request, log, {
                type: 'notify_then_execute',
                timeoutSeconds,
                message: `将在 ${timeoutSeconds} 秒后自动执行: ${request.reason}`
            })
        }

        console.log(`[AutoIteration] Notify-then-execute for ${log.id}, timeout: ${timeoutSeconds}s`)

        // 2. 等待取消或超时
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingApprovals.delete(log.id)
                console.log(`[AutoIteration] Timeout auto-approve for ${log.id}`)
                resolve({ approved: true, method: 'timeout' })
            }, timeoutSeconds * 1000)

            this.pendingApprovals.set(log.id, {
                request,
                log,
                timer,
                resolve: (result) => {
                    clearTimeout(timer)
                    this.pendingApprovals.delete(log.id)
                    resolve(result)
                }
            })
        })
    }

    /**
     * 需要确认
     */
    private async requireConfirm(
        request: ActionRequest,
        log: AutoIterationLog
    ): Promise<{ approved: boolean; method: ApprovalMethod }> {
        // 1. 发送确认请求
        if (this.notificationCallback) {
            await this.notificationCallback(request, log, {
                type: 'require_confirm',
                message: `需要确认: ${request.reason}`
            })
        }

        console.log(`[AutoIteration] Waiting for confirmation for ${log.id}`)

        // 2. 等待用户响应（无超时，但可以设置最大等待时间）
        return new Promise((resolve) => {
            // 设置最大等待时间（24小时）
            const maxWaitTimer = setTimeout(() => {
                this.pendingApprovals.delete(log.id)
                console.log(`[AutoIteration] Max wait timeout for ${log.id}`)
                // 更新日志状态为超时
                this.auditLogger.markTimeout(log.id)
                resolve({ approved: false, method: 'timeout' })
            }, 24 * 60 * 60 * 1000)

            this.pendingApprovals.set(log.id, {
                request,
                log,
                timer: maxWaitTimer,
                resolve: (result) => {
                    clearTimeout(maxWaitTimer)
                    this.pendingApprovals.delete(log.id)
                    resolve(result)
                }
            })
        })
    }

    /**
     * 处理用户响应
     */
    handleUserResponse(logId: string, approved: boolean, userId?: string): boolean {
        const pending = this.pendingApprovals.get(logId)
        if (!pending) {
            console.log(`[AutoIteration] No pending approval found for ${logId}`)
            return false
        }

        console.log(`[AutoIteration] User response for ${logId}: ${approved ? 'approved' : 'rejected'}`)

        pending.resolve({
            approved,
            method: 'manual'
        })

        return true
    }

    /**
     * 取消等待中的审批
     */
    cancelPending(logId: string): boolean {
        const pending = this.pendingApprovals.get(logId)
        if (!pending) {
            return false
        }

        if (pending.timer) {
            clearTimeout(pending.timer)
        }

        this.pendingApprovals.delete(logId)
        console.log(`[AutoIteration] Cancelled pending approval for ${logId}`)

        return true
    }

    /**
     * 获取等待中的审批列表
     */
    getPendingApprovals(): Array<{
        logId: string
        request: ActionRequest
        log: AutoIterationLog
    }> {
        return Array.from(this.pendingApprovals.entries()).map(([logId, pending]) => ({
            logId,
            request: pending.request,
            log: pending.log
        }))
    }

    /**
     * 检查是否有等待中的审批
     */
    hasPendingApproval(logId: string): boolean {
        return this.pendingApprovals.has(logId)
    }

    /**
     * 清理所有等待中的审批
     */
    clearAllPending(): void {
        for (const [logId, pending] of this.pendingApprovals) {
            if (pending.timer) {
                clearTimeout(pending.timer)
            }
            pending.resolve({ approved: false, method: 'auto' })
        }
        this.pendingApprovals.clear()
        console.log('[AutoIteration] Cleared all pending approvals')
    }

    /**
     * 格式化通知消息
     */
    static formatNotificationMessage(
        request: ActionRequest,
        log: AutoIterationLog,
        options: { type: string; message: string }
    ): string {
        const icon = options.type === 'require_confirm' ? '⚠️' : '🤖'
        const riskIcon = request.riskLevel === 'high' ? '🔴' : request.riskLevel === 'medium' ? '🟡' : '🟢'

        return `${icon} **Auto-Iteration Request**

**操作**: ${request.actionType}
**项目**: ${request.targetProject || 'N/A'}
**原因**: ${request.reason}
**预期结果**: ${request.expectedOutcome}
**风险等级**: ${riskIcon} ${request.riskLevel}
**可回滚**: ${request.reversible ? '是' : '否'}
**置信度**: ${(request.confidence * 100).toFixed(0)}%

${options.message}`
    }
}
