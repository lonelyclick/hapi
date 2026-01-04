/**
 * 自动迭代功能 - 默认策略配置
 */

import type { ActionType, ExecutionPolicy, AutoIterationConfig, NotificationLevel } from './types'

/**
 * 默认策略映射表
 *
 * - auto_execute: 自动执行，不需确认（低风险）
 * - notify_then_execute: 通知后30秒自动执行（中等风险）
 * - require_confirm: 需要用户确认才执行（高风险）
 * - always_manual: 永远需要手动执行（危险操作）
 * - disabled: 禁用此类操作
 */
export const DEFAULT_POLICY: Record<ActionType, ExecutionPolicy> = {
    // 低风险：自动执行
    format_code: 'auto_execute',
    fix_lint: 'auto_execute',
    add_comments: 'auto_execute',
    run_tests: 'auto_execute',

    // 中等风险：通知后执行
    fix_type_errors: 'notify_then_execute',
    update_deps: 'notify_then_execute',

    // 高风险：需要确认
    refactor: 'require_confirm',
    optimize: 'require_confirm',
    edit_config: 'require_confirm',
    create_file: 'require_confirm',

    // 危险操作：永远手动
    delete_file: 'always_manual',
    git_commit: 'always_manual',
    git_push: 'always_manual',
    deploy: 'always_manual',

    // 自定义：默认需要确认
    custom: 'require_confirm'
}

/**
 * 操作类型的风险等级描述
 */
export const ACTION_RISK_LEVELS: Record<ActionType, {
    level: 'low' | 'medium' | 'high' | 'critical'
    reversible: boolean
    description: string
}> = {
    format_code: { level: 'low', reversible: true, description: '代码格式化' },
    fix_lint: { level: 'low', reversible: true, description: '修复 lint 问题' },
    add_comments: { level: 'low', reversible: true, description: '添加代码注释' },
    run_tests: { level: 'low', reversible: false, description: '运行测试' },
    fix_type_errors: { level: 'medium', reversible: true, description: '修复类型错误' },
    update_deps: { level: 'medium', reversible: true, description: '更新依赖' },
    refactor: { level: 'high', reversible: true, description: '代码重构' },
    optimize: { level: 'high', reversible: true, description: '性能优化' },
    edit_config: { level: 'high', reversible: true, description: '编辑配置文件' },
    create_file: { level: 'medium', reversible: true, description: '创建文件' },
    delete_file: { level: 'critical', reversible: false, description: '删除文件' },
    git_commit: { level: 'high', reversible: true, description: 'Git 提交' },
    git_push: { level: 'critical', reversible: false, description: 'Git 推送' },
    deploy: { level: 'critical', reversible: false, description: '部署' },
    custom: { level: 'high', reversible: false, description: '自定义操作' }
}

/**
 * 策略的中文描述
 */
export const POLICY_DESCRIPTIONS: Record<ExecutionPolicy, string> = {
    auto_execute: '自动执行',
    notify_then_execute: '通知后执行 (30秒)',
    require_confirm: '需要确认',
    always_manual: '永远手动',
    disabled: '禁用'
}

/**
 * 通知级别描述
 */
export const NOTIFICATION_LEVEL_DESCRIPTIONS: Record<NotificationLevel, string> = {
    all: '所有操作',
    errors_only: '仅错误',
    none: '不通知'
}

/**
 * 默认配置
 */
export function getDefaultConfig(namespace: string): AutoIterationConfig {
    return {
        namespace,
        enabled: false,  // 默认关闭
        policy: {},      // 使用 DEFAULT_POLICY
        allowedProjects: [],  // 空表示允许所有
        notificationLevel: 'all',
        keepLogsDays: 30,
        createdAt: Date.now(),
        updatedAt: Date.now()
    }
}

/**
 * 获取操作类型的有效策略
 * 优先使用用户配置，否则使用默认策略
 */
export function getEffectivePolicy(
    actionType: ActionType,
    userPolicy?: Partial<Record<ActionType, ExecutionPolicy>>
): ExecutionPolicy {
    if (userPolicy && userPolicy[actionType]) {
        return userPolicy[actionType]!
    }
    return DEFAULT_POLICY[actionType] ?? 'require_confirm'
}

/**
 * 所有操作类型列表
 */
export const ALL_ACTION_TYPES: ActionType[] = [
    'format_code', 'fix_lint', 'add_comments', 'run_tests',
    'fix_type_errors', 'update_deps', 'refactor', 'optimize',
    'edit_config', 'create_file', 'delete_file',
    'git_commit', 'git_push', 'deploy', 'custom'
]

/**
 * 所有执行策略列表
 */
export const ALL_EXECUTION_POLICIES: ExecutionPolicy[] = [
    'auto_execute', 'notify_then_execute', 'require_confirm', 'always_manual', 'disabled'
]
