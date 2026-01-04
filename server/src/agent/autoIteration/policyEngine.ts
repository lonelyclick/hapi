/**
 * 自动迭代功能 - 策略匹配引擎
 */

import type { ActionType, ExecutionPolicy, ActionRequest, AutoIterationConfig } from './types'
import { DEFAULT_POLICY, getEffectivePolicy } from './config'

export interface PolicyCheckResult {
    allowed: boolean
    policy: ExecutionPolicy
    reason?: string
}

/**
 * 策略引擎 - 决定操作是否可以执行以及执行策略
 */
export class PolicyEngine {
    constructor(private config: AutoIterationConfig) {}

    /**
     * 更新配置
     */
    updateConfig(config: AutoIterationConfig): void {
        this.config = config
    }

    /**
     * 获取当前配置
     */
    getConfig(): AutoIterationConfig {
        return this.config
    }

    /**
     * 获取操作的执行策略
     */
    getPolicy(actionType: ActionType): ExecutionPolicy {
        // 1. 检查全局开关
        if (!this.config.enabled) {
            return 'disabled'
        }

        // 2. 用户自定义策略优先
        return getEffectivePolicy(actionType, this.config.policy)
    }

    /**
     * 检查项目是否在白名单中
     */
    isProjectAllowed(projectPath: string): boolean {
        // 白名单为空表示允许所有
        if (this.config.allowedProjects.length === 0) {
            return true
        }

        // 检查路径匹配（支持前缀匹配）
        return this.config.allowedProjects.some(allowed => {
            // 标准化路径
            const normalizedAllowed = allowed.replace(/\/+$/, '')
            const normalizedProject = projectPath.replace(/\/+$/, '')

            return normalizedProject === normalizedAllowed ||
                   normalizedProject.startsWith(normalizedAllowed + '/')
        })
    }

    /**
     * 综合判断是否可以执行
     */
    canExecute(request: ActionRequest): PolicyCheckResult {
        // 1. 检查全局开关
        if (!this.config.enabled) {
            return {
                allowed: false,
                policy: 'disabled',
                reason: '自动迭代功能已禁用'
            }
        }

        // 2. 检查项目白名单
        if (request.targetProject && !this.isProjectAllowed(request.targetProject)) {
            return {
                allowed: false,
                policy: 'disabled',
                reason: `项目不在白名单中: ${request.targetProject}`
            }
        }

        // 3. 获取策略
        const policy = this.getPolicy(request.actionType)

        // 4. 禁用的操作
        if (policy === 'disabled') {
            return {
                allowed: false,
                policy,
                reason: `操作类型 ${request.actionType} 已禁用`
            }
        }

        // 5. always_manual 不自动执行
        if (policy === 'always_manual') {
            return {
                allowed: false,
                policy,
                reason: `操作类型 ${request.actionType} 需要手动执行`
            }
        }

        // 6. 检查置信度阈值（可选）
        if (request.confidence < 0.5) {
            return {
                allowed: false,
                policy,
                reason: `置信度过低: ${request.confidence}`
            }
        }

        return { allowed: true, policy }
    }

    /**
     * 判断是否需要用户确认
     */
    requiresConfirmation(actionType: ActionType): boolean {
        const policy = this.getPolicy(actionType)
        return policy === 'require_confirm' || policy === 'always_manual'
    }

    /**
     * 判断是否会自动执行（包括延迟执行）
     */
    willAutoExecute(actionType: ActionType): boolean {
        const policy = this.getPolicy(actionType)
        return policy === 'auto_execute' || policy === 'notify_then_execute'
    }

    /**
     * 获取所有操作类型的策略概览
     */
    getPolicySummary(): Record<ActionType, { policy: ExecutionPolicy; isCustom: boolean }> {
        const summary: Record<ActionType, { policy: ExecutionPolicy; isCustom: boolean }> = {} as Record<ActionType, { policy: ExecutionPolicy; isCustom: boolean }>

        const actionTypes: ActionType[] = [
            'format_code', 'fix_lint', 'add_comments', 'run_tests',
            'fix_type_errors', 'update_deps', 'refactor', 'optimize',
            'edit_config', 'create_file', 'delete_file',
            'git_commit', 'git_push', 'deploy', 'custom'
        ]

        for (const actionType of actionTypes) {
            const isCustom = !!this.config.policy[actionType]
            summary[actionType] = {
                policy: this.getPolicy(actionType),
                isCustom
            }
        }

        return summary
    }

    /**
     * 验证策略配置是否有效
     */
    static validatePolicy(policy: Partial<Record<ActionType, ExecutionPolicy>>): {
        valid: boolean
        errors: string[]
    } {
        const errors: string[] = []
        const validPolicies: ExecutionPolicy[] = [
            'auto_execute', 'notify_then_execute', 'require_confirm', 'always_manual', 'disabled'
        ]

        for (const [action, value] of Object.entries(policy)) {
            if (!validPolicies.includes(value as ExecutionPolicy)) {
                errors.push(`无效的策略值 "${value}" for ${action}`)
            }
        }

        return {
            valid: errors.length === 0,
            errors
        }
    }

    /**
     * 获取默认策略
     */
    static getDefaultPolicy(): Record<ActionType, ExecutionPolicy> {
        return { ...DEFAULT_POLICY }
    }
}
