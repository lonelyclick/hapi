/**
 * 自动迭代功能 - 类型定义
 */

// 操作类型
export type ActionType =
    | 'format_code'      // 代码格式化
    | 'fix_lint'         // 修复 lint 问题
    | 'add_comments'     // 添加注释
    | 'run_tests'        // 运行测试
    | 'fix_type_errors'  // 修复类型错误
    | 'update_deps'      // 更新依赖
    | 'refactor'         // 重构代码
    | 'optimize'         // 性能优化
    | 'edit_config'      // 编辑配置文件
    | 'create_file'      // 创建文件
    | 'delete_file'      // 删除文件
    | 'git_commit'       // Git 提交
    | 'git_push'         // Git 推送
    | 'deploy'           // 部署
    | 'custom'           // 自定义操作

// 执行策略
export type ExecutionPolicy =
    | 'auto_execute'          // 自动执行，不需确认
    | 'notify_then_execute'   // 通知后自动执行（给30秒取消时间）
    | 'require_confirm'       // 需要用户确认才执行
    | 'always_manual'         // 永远需要手动执行（不自动执行，仅记录）
    | 'disabled'              // 禁用此类操作

// 执行状态
export type ExecutionStatus =
    | 'pending'       // 等待执行
    | 'approved'      // 已批准（等待执行）
    | 'executing'     // 执行中
    | 'completed'     // 执行成功
    | 'failed'        // 执行失败
    | 'rejected'      // 用户拒绝
    | 'cancelled'     // 用户取消
    | 'timeout'       // 等待确认超时

// 批准方式
export type ApprovalMethod = 'auto' | 'manual' | 'timeout'

// 通知级别
export type NotificationLevel = 'all' | 'errors_only' | 'none'

// 操作步骤
export interface ActionStep {
    type: 'command' | 'edit' | 'create' | 'delete' | 'message'

    // command 类型
    command?: string

    // edit 类型
    filePath?: string
    oldContent?: string
    newContent?: string

    // create 类型
    content?: string

    // delete 类型（使用 filePath）

    // message 类型（发送消息给用户/会话）
    message?: string

    // 通用
    description: string
}

// Advisor 输出的 ActionRequest
export interface ActionRequest {
    type: 'action_request'
    id: string                          // 唯一 ID
    actionType: ActionType              // 操作类型
    targetSessionId?: string            // 目标会话（可选，不指定则自动选择）
    targetProject?: string              // 目标项目路径

    // 操作详情
    steps: ActionStep[]                 // 执行步骤
    reason: string                      // 为什么需要这个操作
    expectedOutcome: string             // 预期结果

    // 风险评估
    riskLevel: 'low' | 'medium' | 'high'
    reversible: boolean                 // 是否可回滚

    // 依赖
    dependsOn?: string[]                // 依赖的其他 ActionRequest ID

    // 元数据
    sourceSessionId?: string            // 触发此请求的会话
    confidence: number                  // 0.0-1.0
}

// 配置
export interface AutoIterationConfig {
    namespace: string
    enabled: boolean
    policy: Partial<Record<ActionType, ExecutionPolicy>>
    allowedProjects: string[]           // 空数组表示允许所有
    notificationLevel: NotificationLevel
    keepLogsDays: number
    createdAt: number
    updatedAt: number
    updatedBy?: string
}

// 执行日志
export interface AutoIterationLog {
    id: string
    namespace: string
    sourceSuggestionId?: string
    sourceSessionId?: string
    projectPath?: string
    actionType: ActionType
    actionDetail: ActionStep[]
    reason?: string
    executionStatus: ExecutionStatus
    approvalMethod?: ApprovalMethod
    approvedBy?: string
    approvedAt?: number
    resultJson?: unknown
    errorMessage?: string
    rollbackAvailable: boolean
    rollbackData?: unknown
    rolledBack: boolean
    rolledBackAt?: number
    createdAt: number
    executedAt?: number
}

// 数据库行类型
export type DbAutoIterationConfigRow = {
    namespace: string
    enabled: number
    policy_json: string | null
    allowed_projects: string
    notification_level: string
    keep_logs_days: number
    created_at: number
    updated_at: number
    updated_by: string | null
}

export type DbAutoIterationLogRow = {
    id: string
    namespace: string
    source_suggestion_id: string | null
    source_session_id: string | null
    project_path: string | null
    action_type: string
    action_detail: string | null
    reason: string | null
    execution_status: string
    approval_method: string | null
    approved_by: string | null
    approved_at: number | null
    result_json: string | null
    error_message: string | null
    rollback_available: number
    rollback_data: string | null
    rolled_back: number
    rolled_back_at: number | null
    created_at: number
    executed_at: number | null
}

// 转换函数的辅助类型
export interface AutoIterationLogFilters {
    status?: ExecutionStatus
    actionType?: ActionType
    projectPath?: string
    limit?: number
    offset?: number
}
