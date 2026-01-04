# HAPI 常驻 AI 自动迭代功能 - 设计文档

## 1. 概述

### 1.1 背景

当前 HAPI 的常驻 AI Advisor 系统已具备：
- 持续监控所有开发会话
- 双层建议机制（Layer 1 本地检查 + Layer 2 MiniMax 审查）
- 建议状态自动评估
- 跨项目洞察能力

但目前 Advisor **只产生建议，不自动执行**。本功能将扩展 Advisor 的能力，使其可以在用户授权后自动迭代、升级、改造项目。

### 1.2 目标

1. **设置控制**：提供 Telegram Bot + Web UI 两种方式控制自动迭代开关
2. **跨项目支持**：AI 可以监控和迭代多个项目
3. **按操作类型区分策略**：不同操作有不同的自动执行策略
4. **安全与审计**：完整的执行日志、回滚能力、通知机制

### 1.3 核心概念

```
┌─────────────────────────────────────────────────────────────────┐
│                       AutoIterationService                       │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │   Advisor    │───>│ ActionRequest │───>│ ExecutionEngine │   │
│  │ (suggestion) │    │   (parsed)    │    │   (execute)     │   │
│  └──────────────┘    └──────────────┘    └──────────────────┘   │
│         │                   │                     │              │
│         ▼                   ▼                     ▼              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │ PolicyEngine │    │  Approval    │    │   AuditLogger   │   │
│  │ (策略匹配)   │    │  (确认流程)  │    │   (执行日志)    │   │
│  └──────────────┘    └──────────────┘    └──────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 架构设计

### 2.1 系统组件

```
server/src/
├── agent/
│   ├── advisorService.ts       # 现有：建议生成
│   ├── advisorPrompt.ts        # 修改：扩展 action_request 输出
│   ├── autoIteration/          # 新增：自动迭代模块
│   │   ├── index.ts            # 模块导出
│   │   ├── types.ts            # 类型定义
│   │   ├── config.ts           # 配置与策略定义
│   │   ├── service.ts          # AutoIterationService 核心
│   │   ├── policyEngine.ts     # 策略匹配引擎
│   │   ├── executionEngine.ts  # 执行引擎
│   │   ├── approvalFlow.ts     # 审批流程
│   │   └── auditLogger.ts      # 审计日志
│   └── ...
├── store/
│   └── index.ts                # 修改：新增自动迭代相关表
├── web/routes/
│   └── settings.ts             # 修改：新增自动迭代设置 API
├── telegram/
│   ├── bot.ts                  # 修改：新增命令处理
│   └── autoIterCommands.ts     # 新增：自动迭代 Telegram 命令
└── webapp/src/
    └── pages/
        └── AutoIterationSettings.tsx  # 新增：设置页面
```

### 2.2 数据流

```
                                 用户设置
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
             Telegram Bot                      Web UI
            /auto_iter on                   设置页面开关
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
                         auto_iteration_config 表
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AdvisorService                              │
│                                                                  │
│  1. 监听会话事件                                                  │
│  2. 生成建议/ActionRequest                                       │
│  3. 解析 [[HAPI_ADVISOR]] 输出                                   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼ type === 'action_request'
┌─────────────────────────────────────────────────────────────────┐
│                    AutoIterationService                          │
│                                                                  │
│  1. 检查全局/项目级开关                                           │
│  2. PolicyEngine 匹配操作策略                                     │
│  3. 根据策略决定执行方式：                                        │
│     - auto_execute: 直接执行                                     │
│     - notify_then_execute: 通知后执行（可取消）                  │
│     - require_confirm: 等待用户确认                              │
│     - always_manual: 不自动执行，仅记录建议                      │
│  4. ExecutionEngine 执行操作                                     │
│  5. AuditLogger 记录日志                                         │
│  6. 广播结果 & Telegram 通知                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 数据库设计

### 3.1 新增表

```sql
-- 自动迭代配置（每个 namespace 一条记录）
CREATE TABLE IF NOT EXISTS auto_iteration_config (
    namespace TEXT PRIMARY KEY,

    -- 全局开关
    enabled INTEGER DEFAULT 0,                    -- 0=关闭, 1=开启

    -- 策略配置 (JSON)
    -- {
    --   "format_code": "auto_execute",
    --   "run_tests": "auto_execute",
    --   "refactor": "require_confirm",
    --   "delete_file": "always_manual",
    --   ...
    -- }
    policy_json TEXT,

    -- 项目白名单 (JSON 数组)
    -- ["/home/user/project1", "/home/user/project2"]
    -- 空数组表示允许所有项目
    allowed_projects TEXT DEFAULT '[]',

    -- 通知级别: all | errors_only | none
    notification_level TEXT DEFAULT 'all',

    -- 审计配置
    keep_logs_days INTEGER DEFAULT 30,            -- 日志保留天数

    -- 元数据
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    updated_at INTEGER DEFAULT (unixepoch() * 1000),
    updated_by TEXT                               -- 最后修改者
);

-- 自动迭代执行日志
CREATE TABLE IF NOT EXISTS auto_iteration_logs (
    id TEXT PRIMARY KEY,                          -- UUID
    namespace TEXT NOT NULL,

    -- 来源信息
    source_suggestion_id TEXT,                    -- 来源建议 ID（可选）
    source_session_id TEXT,                       -- 来源会话 ID
    project_path TEXT,                            -- 项目路径

    -- 操作信息
    action_type TEXT NOT NULL,                    -- 操作类型
    action_detail TEXT,                           -- 操作详情 (JSON)
    reason TEXT,                                  -- 执行原因

    -- 执行状态
    -- pending: 等待执行
    -- approved: 已批准（等待执行）
    -- executing: 执行中
    -- completed: 执行成功
    -- failed: 执行失败
    -- rejected: 用户拒绝
    -- cancelled: 用户取消
    -- timeout: 等待确认超时
    execution_status TEXT DEFAULT 'pending',

    -- 批准方式
    -- auto: 策略自动批准
    -- manual: 用户手动批准
    -- timeout: 超时自动批准（仅 notify_then_execute）
    approval_method TEXT,
    approved_by TEXT,                             -- 批准者
    approved_at INTEGER,                          -- 批准时间

    -- 执行结果
    result_json TEXT,                             -- 执行结果详情
    error_message TEXT,                           -- 错误信息（如果失败）

    -- 回滚信息
    rollback_available INTEGER DEFAULT 0,         -- 是否可回滚
    rollback_data TEXT,                           -- 回滚数据 (JSON)
    rolled_back INTEGER DEFAULT 0,                -- 是否已回滚
    rolled_back_at INTEGER,                       -- 回滚时间

    -- 时间戳
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    executed_at INTEGER,

    -- 索引外键
    FOREIGN KEY (source_suggestion_id) REFERENCES agent_suggestions(id) ON DELETE SET NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_auto_iteration_logs_namespace
    ON auto_iteration_logs(namespace);
CREATE INDEX IF NOT EXISTS idx_auto_iteration_logs_status
    ON auto_iteration_logs(execution_status);
CREATE INDEX IF NOT EXISTS idx_auto_iteration_logs_created
    ON auto_iteration_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_auto_iteration_logs_project
    ON auto_iteration_logs(project_path);
```

### 3.2 类型定义

```typescript
// server/src/agent/autoIteration/types.ts

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
    | 'pending'
    | 'approved'
    | 'executing'
    | 'completed'
    | 'failed'
    | 'rejected'
    | 'cancelled'
    | 'timeout'

// 批准方式
export type ApprovalMethod = 'auto' | 'manual' | 'timeout'

// 通知级别
export type NotificationLevel = 'all' | 'errors_only' | 'none'

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
    description: string                 // 步骤描述
}

// 配置
export interface AutoIterationConfig {
    namespace: string
    enabled: boolean
    policy: Record<ActionType, ExecutionPolicy>
    allowedProjects: string[]           // 空数组表示允许所有
    notificationLevel: NotificationLevel
    keepLogsDays: number
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
```

---

## 4. 核心组件设计

### 4.1 PolicyEngine - 策略引擎

```typescript
// server/src/agent/autoIteration/policyEngine.ts

export class PolicyEngine {
    // 默认策略（内置，不可修改）
    private static readonly DEFAULT_POLICY: Record<ActionType, ExecutionPolicy> = {
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

    constructor(private config: AutoIterationConfig) {}

    /**
     * 获取操作的执行策略
     */
    getPolicy(actionType: ActionType): ExecutionPolicy {
        // 1. 检查全局开关
        if (!this.config.enabled) {
            return 'disabled'
        }

        // 2. 用户自定义策略优先
        if (this.config.policy[actionType]) {
            return this.config.policy[actionType]
        }

        // 3. 使用默认策略
        return PolicyEngine.DEFAULT_POLICY[actionType] ?? 'require_confirm'
    }

    /**
     * 检查项目是否在白名单中
     */
    isProjectAllowed(projectPath: string): boolean {
        // 白名单为空表示允许所有
        if (this.config.allowedProjects.length === 0) {
            return true
        }

        // 检查路径匹配
        return this.config.allowedProjects.some(allowed =>
            projectPath.startsWith(allowed) || allowed.startsWith(projectPath)
        )
    }

    /**
     * 综合判断是否可以执行
     */
    canExecute(request: ActionRequest): {
        allowed: boolean
        policy: ExecutionPolicy
        reason?: string
    } {
        // 1. 检查项目白名单
        if (request.targetProject && !this.isProjectAllowed(request.targetProject)) {
            return {
                allowed: false,
                policy: 'disabled',
                reason: `Project not in whitelist: ${request.targetProject}`
            }
        }

        // 2. 获取策略
        const policy = this.getPolicy(request.actionType)

        // 3. 禁用的操作
        if (policy === 'disabled') {
            return {
                allowed: false,
                policy,
                reason: `Action type ${request.actionType} is disabled`
            }
        }

        return { allowed: true, policy }
    }
}
```

### 4.2 ExecutionEngine - 执行引擎

```typescript
// server/src/agent/autoIteration/executionEngine.ts

export class ExecutionEngine {
    constructor(
        private syncEngine: SyncEngine,
        private store: Store
    ) {}

    /**
     * 执行 ActionRequest
     */
    async execute(request: ActionRequest, log: AutoIterationLog): Promise<{
        success: boolean
        result?: unknown
        error?: string
        rollbackData?: unknown
    }> {
        // 1. 选择目标会话
        const targetSession = await this.selectTargetSession(request)
        if (!targetSession) {
            return { success: false, error: 'No suitable session found' }
        }

        // 2. 创建回滚点（如果可能）
        let rollbackData: unknown = null
        if (request.reversible) {
            rollbackData = await this.createRollbackPoint(request, targetSession)
        }

        // 3. 逐步执行
        const results: unknown[] = []
        for (const step of request.steps) {
            try {
                const stepResult = await this.executeStep(step, targetSession)
                results.push(stepResult)
            } catch (error) {
                // 步骤失败，尝试回滚
                if (rollbackData) {
                    await this.rollback(rollbackData)
                }
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                    rollbackData
                }
            }
        }

        return { success: true, result: results, rollbackData }
    }

    /**
     * 选择目标会话
     */
    private async selectTargetSession(request: ActionRequest): Promise<Session | null> {
        // 1. 如果指定了目标会话，使用它
        if (request.targetSessionId) {
            const session = this.syncEngine.getSession(request.targetSessionId)
            if (session?.active) return session
        }

        // 2. 如果指定了项目，查找该项目的活跃会话
        if (request.targetProject) {
            const sessions = this.syncEngine.getActiveSessions()
            for (const session of sessions) {
                const workDir = session.metadata?.workDir as string
                if (workDir && workDir.includes(request.targetProject)) {
                    return session
                }
            }
        }

        // 3. 使用来源会话
        if (request.sourceSessionId) {
            const session = this.syncEngine.getSession(request.sourceSessionId)
            if (session?.active) return session
        }

        return null
    }

    /**
     * 执行单个步骤
     */
    private async executeStep(step: ActionStep, session: Session): Promise<unknown> {
        switch (step.type) {
            case 'command':
                // 通过 SyncEngine 发送命令到会话
                return await this.syncEngine.sendAutoCommand(session.id, step.command!)

            case 'edit':
                // 发送编辑指令
                return await this.syncEngine.sendAutoEdit(session.id, {
                    filePath: step.filePath!,
                    oldContent: step.oldContent!,
                    newContent: step.newContent!
                })

            case 'create':
                return await this.syncEngine.sendAutoCreate(session.id, {
                    filePath: step.filePath!,
                    content: step.content!
                })

            case 'delete':
                return await this.syncEngine.sendAutoDelete(session.id, step.filePath!)

            case 'message':
                return await this.syncEngine.sendAutoMessage(session.id, step.message!)

            default:
                throw new Error(`Unknown step type: ${step.type}`)
        }
    }

    /**
     * 创建回滚点
     */
    private async createRollbackPoint(
        request: ActionRequest,
        session: Session
    ): Promise<unknown> {
        // 对于文件操作，记录原始内容
        // 对于 Git 操作，记录当前 HEAD
        // 具体实现取决于操作类型
        return {
            timestamp: Date.now(),
            sessionId: session.id,
            originalState: {} // TODO: 根据操作类型记录原始状态
        }
    }

    /**
     * 回滚操作
     */
    async rollback(rollbackData: unknown): Promise<boolean> {
        // TODO: 实现回滚逻辑
        return false
    }
}
```

### 4.3 ApprovalFlow - 审批流程

```typescript
// server/src/agent/autoIteration/approvalFlow.ts

export class ApprovalFlow {
    // 等待确认的请求
    private pendingApprovals: Map<string, {
        request: ActionRequest
        log: AutoIterationLog
        timer?: NodeJS.Timeout
        resolve: (approved: boolean) => void
    }> = new Map()

    constructor(
        private store: Store,
        private telegramBot?: TelegramBot,
        private config?: AutoIterationConfig
    ) {}

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
                return { approved: true, method: 'auto' }

            case 'notify_then_execute':
                return await this.notifyThenExecute(request, log)

            case 'require_confirm':
                return await this.requireConfirm(request, log)

            case 'always_manual':
            case 'disabled':
            default:
                return { approved: false, method: 'auto' }
        }
    }

    /**
     * 通知后执行（给30秒取消时间）
     */
    private async notifyThenExecute(
        request: ActionRequest,
        log: AutoIterationLog
    ): Promise<{ approved: boolean; method: ApprovalMethod }> {
        // 1. 发送通知
        await this.sendNotification(request, log, {
            type: 'notify_then_execute',
            timeoutSeconds: 30,
            message: `将在 30 秒后自动执行: ${request.reason}`
        })

        // 2. 等待取消或超时
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingApprovals.delete(log.id)
                resolve({ approved: true, method: 'timeout' })
            }, 30_000)

            this.pendingApprovals.set(log.id, {
                request,
                log,
                timer,
                resolve: (approved) => {
                    clearTimeout(timer)
                    this.pendingApprovals.delete(log.id)
                    resolve({ approved, method: 'manual' })
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
        await this.sendNotification(request, log, {
            type: 'require_confirm',
            message: `需要确认: ${request.reason}`
        })

        // 2. 等待用户响应（无超时）
        return new Promise((resolve) => {
            this.pendingApprovals.set(log.id, {
                request,
                log,
                resolve: (approved) => {
                    this.pendingApprovals.delete(log.id)
                    resolve({ approved, method: 'manual' })
                }
            })
        })
    }

    /**
     * 用户响应
     */
    handleUserResponse(logId: string, approved: boolean, userId?: string): boolean {
        const pending = this.pendingApprovals.get(logId)
        if (!pending) return false

        pending.resolve(approved)
        return true
    }

    /**
     * 发送通知
     */
    private async sendNotification(
        request: ActionRequest,
        log: AutoIterationLog,
        options: {
            type: 'notify_then_execute' | 'require_confirm'
            timeoutSeconds?: number
            message: string
        }
    ): Promise<void> {
        if (!this.telegramBot) return

        // 构建消息
        const message = this.formatNotificationMessage(request, log, options)

        // 发送到 Telegram
        await this.telegramBot.sendAutoIterationNotification(message, log.id, options.type)
    }

    private formatNotificationMessage(
        request: ActionRequest,
        log: AutoIterationLog,
        options: { type: string; message: string }
    ): string {
        const icon = options.type === 'require_confirm' ? '⚠️' : '🤖'
        return `${icon} **Auto-Iteration Request**

**操作**: ${request.actionType}
**项目**: ${request.targetProject || 'N/A'}
**原因**: ${request.reason}
**风险**: ${request.riskLevel}
**可回滚**: ${request.reversible ? '是' : '否'}

${options.message}
`
    }
}
```

### 4.4 AutoIterationService - 核心服务

```typescript
// server/src/agent/autoIteration/service.ts

export class AutoIterationService {
    private policyEngine: PolicyEngine
    private executionEngine: ExecutionEngine
    private approvalFlow: ApprovalFlow
    private auditLogger: AuditLogger

    constructor(
        private syncEngine: SyncEngine,
        private store: Store,
        private advisorService: AdvisorService,
        private telegramBot?: TelegramBot
    ) {
        // 初始化配置
        const config = this.loadConfig()

        this.policyEngine = new PolicyEngine(config)
        this.executionEngine = new ExecutionEngine(syncEngine, store)
        this.approvalFlow = new ApprovalFlow(store, telegramBot, config)
        this.auditLogger = new AuditLogger(store)

        // 订阅 Advisor 的 ActionRequest 输出
        this.subscribeToAdvisorOutput()
    }

    /**
     * 加载配置
     */
    private loadConfig(): AutoIterationConfig {
        const stored = this.store.getAutoIterationConfig('default')
        if (stored) return stored

        // 返回默认配置
        return {
            namespace: 'default',
            enabled: false,  // 默认关闭
            policy: {},
            allowedProjects: [],
            notificationLevel: 'all',
            keepLogsDays: 30,
            updatedAt: Date.now()
        }
    }

    /**
     * 订阅 Advisor 输出
     */
    private subscribeToAdvisorOutput(): void {
        // 监听 AdvisorService 解析出的 ActionRequest
        this.advisorService.on('action-request', async (request: ActionRequest) => {
            await this.handleActionRequest(request)
        })
    }

    /**
     * 处理 ActionRequest
     */
    async handleActionRequest(request: ActionRequest): Promise<void> {
        // 1. 创建执行日志
        const log = await this.auditLogger.createLog(request)

        // 2. 检查策略
        const { allowed, policy, reason } = this.policyEngine.canExecute(request)

        if (!allowed) {
            await this.auditLogger.updateLog(log.id, {
                executionStatus: 'rejected',
                errorMessage: reason
            })
            await this.notify(log, 'rejected', reason)
            return
        }

        // 3. 发起审批
        const { approved, method } = await this.approvalFlow.requestApproval(
            request, log, policy
        )

        if (!approved) {
            await this.auditLogger.updateLog(log.id, {
                executionStatus: method === 'manual' ? 'rejected' : 'cancelled',
                approvalMethod: method
            })
            return
        }

        // 4. 执行
        await this.auditLogger.updateLog(log.id, {
            executionStatus: 'executing',
            approvalMethod: method,
            approvedAt: Date.now()
        })

        const result = await this.executionEngine.execute(request, log)

        // 5. 记录结果
        await this.auditLogger.updateLog(log.id, {
            executionStatus: result.success ? 'completed' : 'failed',
            resultJson: result.result,
            errorMessage: result.error,
            rollbackAvailable: !!result.rollbackData,
            rollbackData: result.rollbackData,
            executedAt: Date.now()
        })

        // 6. 通知
        await this.notify(log, result.success ? 'completed' : 'failed', result.error)
    }

    /**
     * 发送通知
     */
    private async notify(
        log: AutoIterationLog,
        status: string,
        message?: string
    ): Promise<void> {
        const config = this.loadConfig()

        if (config.notificationLevel === 'none') return
        if (config.notificationLevel === 'errors_only' && status === 'completed') return

        // Telegram 通知
        if (this.telegramBot) {
            await this.telegramBot.sendAutoIterationResult(log, status, message)
        }

        // 广播事件
        this.syncEngine.emit('auto-iteration-status', { log, status, message })
    }

    // ========== 公开 API ==========

    /**
     * 更新配置
     */
    async updateConfig(update: Partial<AutoIterationConfig>): Promise<AutoIterationConfig> {
        const current = this.loadConfig()
        const newConfig = { ...current, ...update, updatedAt: Date.now() }

        this.store.upsertAutoIterationConfig('default', newConfig)

        // 重新加载策略引擎
        this.policyEngine = new PolicyEngine(newConfig)

        return newConfig
    }

    /**
     * 获取配置
     */
    getConfig(): AutoIterationConfig {
        return this.loadConfig()
    }

    /**
     * 获取执行日志
     */
    getLogs(filters?: {
        status?: ExecutionStatus
        actionType?: ActionType
        projectPath?: string
        limit?: number
    }): AutoIterationLog[] {
        return this.store.getAutoIterationLogs('default', filters)
    }

    /**
     * 手动审批
     */
    handleApproval(logId: string, approved: boolean, userId?: string): boolean {
        return this.approvalFlow.handleUserResponse(logId, approved, userId)
    }

    /**
     * 回滚操作
     */
    async rollback(logId: string): Promise<boolean> {
        const log = this.store.getAutoIterationLog(logId)
        if (!log || !log.rollbackAvailable || log.rolledBack) {
            return false
        }

        const success = await this.executionEngine.rollback(log.rollbackData)

        if (success) {
            this.store.updateAutoIterationLog(logId, {
                rolledBack: true,
                rolledBackAt: Date.now()
            })
        }

        return success
    }
}
```

---

## 5. Advisor Prompt 扩展

### 5.1 修改 advisorPrompt.ts

在现有的 `advisorInstructions` 中扩展 `action_request` 的定义：

```typescript
### 执行请求（Action Request）- 自动迭代

当你认为有些操作可以自动执行时，使用此格式。系统会根据配置决定是否自动执行。

\`\`\`
[[HAPI_ADVISOR]]{"type":"action_request","id":"act_<timestamp>_<random>","actionType":"format_code|fix_lint|add_comments|run_tests|fix_type_errors|update_deps|refactor|optimize|edit_config|create_file|delete_file|git_commit|git_push|deploy|custom","targetProject":"目标项目路径","steps":[{"type":"command|edit|create|delete|message","command":"具体命令","filePath":"文件路径","oldContent":"原内容","newContent":"新内容","content":"文件内容","message":"消息内容","description":"步骤描述"}],"reason":"为什么需要这个操作","expectedOutcome":"预期结果","riskLevel":"low|medium|high","reversible":true|false,"confidence":0.0-1.0,"sourceSessionId":"触发会话ID"}
\`\`\`

### Action Request 使用指南

1. **actionType 选择**：
   - \`format_code\`: 代码格式化（低风险，通常自动执行）
   - \`fix_lint\`: 修复 lint 问题（低风险）
   - \`run_tests\`: 运行测试（低风险）
   - \`fix_type_errors\`: 修复类型错误（中等风险）
   - \`refactor\`: 重构代码（高风险，需确认）
   - \`delete_file\`: 删除文件（高风险，需手动确认）
   - \`git_commit\`/\`git_push\`: Git 操作（高风险，需手动确认）
   - \`deploy\`: 部署操作（高风险，需手动确认）

2. **steps 格式**：
   - \`command\`: 执行 bash 命令
   - \`edit\`: 编辑文件（需提供 oldContent 和 newContent）
   - \`create\`: 创建新文件
   - \`delete\`: 删除文件
   - \`message\`: 发送消息给用户

3. **风险评估**：
   - \`low\`: 不影响功能，可回滚
   - \`medium\`: 可能影响功能，但可控
   - \`high\`: 可能造成数据丢失或服务中断

4. **何时使用 Action Request**：
   - 发现明确的代码问题且知道如何修复
   - 可以自动化的重复性任务
   - 用户之前表达过类似意图

5. **何时不使用 Action Request**：
   - 不确定修复是否正确
   - 需要用户决策的问题
   - 涉及敏感数据或生产环境
```

---

## 6. API 设计

### 6.1 Web API

```typescript
// server/src/web/routes/settings.ts 新增

// 获取自动迭代配置
app.get('/settings/auto-iteration', (c) => {
    const config = autoIterationService.getConfig()
    return c.json({ config })
})

// 更新自动迭代配置
app.put('/settings/auto-iteration', async (c) => {
    const json = await c.req.json()
    const config = await autoIterationService.updateConfig(json)
    return c.json({ ok: true, config })
})

// 获取执行日志
app.get('/settings/auto-iteration/logs', (c) => {
    const { status, actionType, projectPath, limit } = c.req.query()
    const logs = autoIterationService.getLogs({
        status: status as ExecutionStatus,
        actionType: actionType as ActionType,
        projectPath,
        limit: limit ? parseInt(limit) : undefined
    })
    return c.json({ logs })
})

// 审批操作
app.post('/settings/auto-iteration/logs/:id/approve', async (c) => {
    const id = c.req.param('id')
    const success = autoIterationService.handleApproval(id, true, c.get('userId'))
    return c.json({ ok: success })
})

// 拒绝操作
app.post('/settings/auto-iteration/logs/:id/reject', async (c) => {
    const id = c.req.param('id')
    const success = autoIterationService.handleApproval(id, false, c.get('userId'))
    return c.json({ ok: success })
})

// 回滚操作
app.post('/settings/auto-iteration/logs/:id/rollback', async (c) => {
    const id = c.req.param('id')
    const success = await autoIterationService.rollback(id)
    return c.json({ ok: success })
})
```

### 6.2 Telegram 命令

```typescript
// server/src/telegram/autoIterCommands.ts

/**
 * 自动迭代 Telegram 命令
 */

// /auto_iter - 显示状态
bot.command('auto_iter', async (ctx) => {
    const config = autoIterationService.getConfig()
    const status = config.enabled ? '✅ 已启用' : '❌ 已禁用'

    await ctx.reply(`
🤖 **自动迭代状态**

${status}

**项目白名单**: ${config.allowedProjects.length || '全部项目'}
**通知级别**: ${config.notificationLevel}
**日志保留**: ${config.keepLogsDays} 天

使用 /auto_iter_on 启用
使用 /auto_iter_off 禁用
使用 /auto_iter_logs 查看日志
使用 /auto_iter_policy 查看策略
    `, { parse_mode: 'Markdown' })
})

// /auto_iter_on - 启用
bot.command('auto_iter_on', async (ctx) => {
    await autoIterationService.updateConfig({ enabled: true })
    await ctx.reply('✅ 自动迭代已启用')
})

// /auto_iter_off - 禁用
bot.command('auto_iter_off', async (ctx) => {
    await autoIterationService.updateConfig({ enabled: false })
    await ctx.reply('❌ 自动迭代已禁用')
})

// /auto_iter_logs - 查看日志
bot.command('auto_iter_logs', async (ctx) => {
    const logs = autoIterationService.getLogs({ limit: 10 })

    if (logs.length === 0) {
        await ctx.reply('📋 暂无执行日志')
        return
    }

    const lines = logs.map(log => {
        const status = getStatusEmoji(log.executionStatus)
        const time = new Date(log.createdAt).toLocaleString()
        return `${status} [${log.actionType}] ${log.reason || 'N/A'} - ${time}`
    })

    await ctx.reply(`📋 **最近执行日志**\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' })
})

// /auto_iter_policy - 查看策略
bot.command('auto_iter_policy', async (ctx) => {
    const config = autoIterationService.getConfig()

    const lines = Object.entries(PolicyEngine.DEFAULT_POLICY).map(([action, defaultPolicy]) => {
        const custom = config.policy[action as ActionType]
        const policy = custom || defaultPolicy
        const icon = getPolicyIcon(policy)
        return `${icon} ${action}: ${policy}${custom ? ' (自定义)' : ''}`
    })

    await ctx.reply(`📋 **执行策略**\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' })
})

// 审批回调
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data
    if (!data) return

    if (data.startsWith('ai_approve:')) {
        const logId = data.replace('ai_approve:', '')
        const success = autoIterationService.handleApproval(logId, true, ctx.from?.id?.toString())
        await ctx.answerCbQuery(success ? '✅ 已批准' : '❌ 操作无效')
    }

    if (data.startsWith('ai_reject:')) {
        const logId = data.replace('ai_reject:', '')
        const success = autoIterationService.handleApproval(logId, false, ctx.from?.id?.toString())
        await ctx.answerCbQuery(success ? '❌ 已拒绝' : '❌ 操作无效')
    }
})
```

---

## 7. Web UI 设计

### 7.1 设置页面

```tsx
// webapp/src/pages/AutoIterationSettings.tsx

export function AutoIterationSettings() {
    const [config, setConfig] = useState<AutoIterationConfig | null>(null)
    const [logs, setLogs] = useState<AutoIterationLog[]>([])

    // 加载配置和日志
    useEffect(() => {
        fetchConfig()
        fetchLogs()
    }, [])

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">自动迭代设置</h1>

            {/* 全局开关 */}
            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>全局开关</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-medium">允许 AI 自动迭代</p>
                            <p className="text-sm text-gray-500">
                                启用后，AI Advisor 可以根据策略自动执行代码操作
                            </p>
                        </div>
                        <Switch
                            checked={config?.enabled ?? false}
                            onCheckedChange={(enabled) => updateConfig({ enabled })}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* 项目白名单 */}
            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>项目白名单</CardTitle>
                    <CardDescription>
                        留空表示允许所有项目，添加路径限制 AI 只能操作特定项目
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ProjectWhitelist
                        projects={config?.allowedProjects ?? []}
                        onChange={(allowedProjects) => updateConfig({ allowedProjects })}
                    />
                </CardContent>
            </Card>

            {/* 操作策略 */}
            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>操作策略</CardTitle>
                    <CardDescription>
                        为不同操作类型设置执行策略
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <PolicyEditor
                        policy={config?.policy ?? {}}
                        onChange={(policy) => updateConfig({ policy })}
                    />
                </CardContent>
            </Card>

            {/* 通知设置 */}
            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>通知设置</CardTitle>
                </CardHeader>
                <CardContent>
                    <Select
                        value={config?.notificationLevel ?? 'all'}
                        onValueChange={(notificationLevel) =>
                            updateConfig({ notificationLevel: notificationLevel as NotificationLevel })
                        }
                    >
                        <SelectItem value="all">所有操作</SelectItem>
                        <SelectItem value="errors_only">仅错误</SelectItem>
                        <SelectItem value="none">不通知</SelectItem>
                    </Select>
                </CardContent>
            </Card>

            {/* 执行日志 */}
            <Card>
                <CardHeader>
                    <CardTitle>执行日志</CardTitle>
                </CardHeader>
                <CardContent>
                    <LogTable
                        logs={logs}
                        onApprove={(id) => handleApprove(id)}
                        onReject={(id) => handleReject(id)}
                        onRollback={(id) => handleRollback(id)}
                    />
                </CardContent>
            </Card>
        </div>
    )
}
```

---

## 8. 实现计划

### Phase 1: 基础设施（预计 2-3 天）

1. **数据库扩展**
   - 新增 `auto_iteration_config` 表
   - 新增 `auto_iteration_logs` 表
   - Store 方法实现

2. **类型定义**
   - `server/src/agent/autoIteration/types.ts`

3. **策略引擎**
   - `server/src/agent/autoIteration/policyEngine.ts`

### Phase 2: 核心服务（预计 3-4 天）

4. **执行引擎**
   - `server/src/agent/autoIteration/executionEngine.ts`
   - SyncEngine 扩展（sendAutoCommand 等方法）

5. **审批流程**
   - `server/src/agent/autoIteration/approvalFlow.ts`

6. **核心服务**
   - `server/src/agent/autoIteration/service.ts`

7. **Advisor Prompt 扩展**
   - 修改 `advisorPrompt.ts`

### Phase 3: 控制接口（预计 2-3 天）

8. **Web API**
   - 修改 `settings.ts`

9. **Telegram 命令**
   - 新增 `autoIterCommands.ts`

### Phase 4: UI 与测试（预计 2-3 天）

10. **Web UI**
    - 设置页面
    - 日志查看

11. **测试**
    - 单元测试
    - 集成测试
    - E2E 测试

---

## 9. 安全考虑

### 9.1 权限控制

- 只有 `operator` 角色可以修改自动迭代设置
- 执行日志记录操作者身份
- 敏感操作需要二次确认

### 9.2 操作限制

- 默认禁用危险操作（delete_file, git_push, deploy）
- 项目白名单限制操作范围
- 速率限制防止滥用

### 9.3 审计与回滚

- 完整的执行日志
- 支持操作回滚
- Telegram 实时通知

### 9.4 隔离

- 每个 namespace 独立配置
- 不同项目可以有不同策略

---

## 10. 后续扩展

### 10.1 计划中的功能

- **定时任务**：定期运行测试、更新依赖
- **触发条件**：基于 Git 事件、CI 结果触发
- **学习能力**：根据用户反馈调整策略
- **团队协作**：共享策略模板

### 10.2 集成可能

- GitHub Actions 集成
- Slack/Discord 通知
- 自定义 Webhook

---

## 附录

### A. 默认策略表

| 操作类型 | 默认策略 | 风险等级 | 可回滚 |
|---------|---------|---------|-------|
| format_code | auto_execute | low | ✅ |
| fix_lint | auto_execute | low | ✅ |
| add_comments | auto_execute | low | ✅ |
| run_tests | auto_execute | low | ❌ |
| fix_type_errors | notify_then_execute | medium | ✅ |
| update_deps | notify_then_execute | medium | ✅ |
| refactor | require_confirm | high | ✅ |
| optimize | require_confirm | high | ✅ |
| edit_config | require_confirm | high | ✅ |
| create_file | require_confirm | medium | ✅ |
| delete_file | always_manual | high | ❌ |
| git_commit | always_manual | high | ✅ |
| git_push | always_manual | high | ❌ |
| deploy | always_manual | high | ❌ |
| custom | require_confirm | high | ❌ |

### B. 事件列表

| 事件名 | 触发时机 | 数据 |
|-------|---------|------|
| auto-iteration-request | 收到 ActionRequest | request |
| auto-iteration-approved | 操作被批准 | log, method |
| auto-iteration-executing | 开始执行 | log |
| auto-iteration-completed | 执行成功 | log, result |
| auto-iteration-failed | 执行失败 | log, error |
| auto-iteration-rejected | 操作被拒绝 | log, reason |
| auto-iteration-rollback | 操作被回滚 | log |
