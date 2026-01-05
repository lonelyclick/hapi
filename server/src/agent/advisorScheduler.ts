/**
 * AdvisorScheduler - 保证 Advisor 会话常驻
 */

import { randomUUID } from 'node:crypto'
import type { SyncEngine, Machine, Session } from '../sync/syncEngine'
import type { IStore } from '../store'
import { buildAdvisorInitPrompt } from './advisorPrompt'

export interface AdvisorSchedulerConfig {
    namespace: string
    restartDelayMs?: number
    initPromptSent?: Set<string>  // 跟踪已发送 init prompt 的 sessionId
    dailyReviewEnabled?: boolean  // 是否启用每日审查
    dailyReviewHour?: number      // 每日审查的小时（0-23）
    proactiveReviewIntervalMs?: number  // 主动审查间隔（毫秒）
}

export class AdvisorScheduler {
    private syncEngine: SyncEngine
    private store: IStore
    private namespace: string
    private advisorSessionId: string | null = null
    private restartTimer: NodeJS.Timeout | null = null
    private restartDelayMs: number
    private initPromptSent: Set<string>
    private isStarting = false
    private unsubscribe: (() => void) | null = null

    // 定期审查相关
    private dailyReviewEnabled: boolean
    private dailyReviewHour: number
    private proactiveReviewIntervalMs: number
    private dailyReviewTimer: NodeJS.Timeout | null = null
    private proactiveReviewTimer: NodeJS.Timeout | null = null
    private lastDailyReviewDate: string | null = null

    // 审查状态（审查期间暂停 Summary 推送）
    private _isReviewing = false
    private reviewStartTime: number | null = null
    private readonly reviewTimeoutMs = 5 * 60 * 1000  // 审查超时 5 分钟

    constructor(
        syncEngine: SyncEngine,
        store: IStore,
        config: AdvisorSchedulerConfig
    ) {
        this.syncEngine = syncEngine
        this.store = store
        this.namespace = config.namespace
        this.restartDelayMs = config.restartDelayMs ?? 5000
        this.initPromptSent = config.initPromptSent ?? new Set()
        this.dailyReviewEnabled = config.dailyReviewEnabled ?? true
        this.dailyReviewHour = config.dailyReviewHour ?? 9  // 默认早上9点
        this.proactiveReviewIntervalMs = config.proactiveReviewIntervalMs ?? 4 * 60 * 60 * 1000  // 默认4小时
    }

    async start(): Promise<void> {
        if (this.isStarting) {
            console.log('[AdvisorScheduler] Already starting, skip')
            return
        }

        this.isStarting = true

        try {
            // 1. 从 agent_state 读取或生成 advisor_session_id
            const state = await this.store.getAdvisorState(this.namespace)
            this.advisorSessionId = state?.advisorSessionId || `advisor-${randomUUID().slice(0, 8)}`

            // 2. 选择在线机器
            const machine = this.selectMachine()
            if (!machine) {
                console.log('[AdvisorScheduler] No online machine found, scheduling retry')
                this.scheduleRestart()
                return
            }

            // 3. 检查是否已有运行中的 Advisor 会话
            const existingSession = this.syncEngine.getSession(this.advisorSessionId)
            if (existingSession?.active) {
                console.log(`[AdvisorScheduler] Advisor session ${this.advisorSessionId} already running`)
                // 更新状态
                await this.store.upsertAdvisorState(this.namespace, {
                    advisorSessionId: this.advisorSessionId,
                    machineId: machine.id,
                    status: 'running',
                    lastSeen: Date.now()
                })
                return
            }

            // 4. 获取 advisorWorkingDir
            const workingDir = (machine.metadata as Record<string, unknown>)?.advisorWorkingDir as string
                || '/home/guang/softwares/hapi'

            console.log(`[AdvisorScheduler] Spawning advisor session on machine ${machine.id}, workingDir: ${workingDir}`)

            // 5. Spawn 新会话
            const spawnResult = await this.syncEngine.spawnSession(
                machine.id,
                workingDir,
                'claude',
                false,  // yolo
                'simple',  // sessionType
                undefined,  // worktreeName
                {
                    sessionId: this.advisorSessionId,
                    claudeAgent: 'advisor',
                    permissionMode: 'acceptEdits'
                }
            )

            if (spawnResult.type !== 'success') {
                console.error('[AdvisorScheduler] Failed to spawn advisor session:', spawnResult.message)
                await this.store.upsertAdvisorState(this.namespace, {
                    advisorSessionId: this.advisorSessionId,
                    machineId: machine.id,
                    status: 'error'
                })
                this.scheduleRestart()
                return
            }

            // 使用实际返回的 sessionId（可能与请求的不同）
            this.advisorSessionId = spawnResult.sessionId
            console.log(`[AdvisorScheduler] Advisor session spawned: ${this.advisorSessionId}`)

            // 6. 发送 init prompt（仅在首次）
            // 等待 CLI 完全连接（CLI 可能需要一点时间来加入 Socket.IO room）
            if (!this.initPromptSent.has(this.advisorSessionId)) {
                await new Promise(resolve => setTimeout(resolve, 2000))
                await this.sendInitPrompt(workingDir)
                this.initPromptSent.add(this.advisorSessionId)
            }

            // 7. 更新 agent_state
            await this.store.upsertAdvisorState(this.namespace, {
                advisorSessionId: this.advisorSessionId,
                machineId: machine.id,
                status: 'running',
                lastSeen: Date.now()
            })

            // 8. 订阅会话结束事件
            this.subscribeToSessionEnd()

            // 9. 启动定期审查
            this.startPeriodicReviews()

        } finally {
            this.isStarting = false
        }
    }

    stop(): void {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer)
            this.restartTimer = null
        }
        if (this.dailyReviewTimer) {
            clearTimeout(this.dailyReviewTimer)
            this.dailyReviewTimer = null
        }
        if (this.proactiveReviewTimer) {
            clearInterval(this.proactiveReviewTimer)
            this.proactiveReviewTimer = null
        }
        if (this.unsubscribe) {
            this.unsubscribe()
            this.unsubscribe = null
        }
    }

    getAdvisorSessionId(): string | null {
        return this.advisorSessionId
    }

    isAdvisorSession(sessionId: string): boolean {
        if (sessionId === this.advisorSessionId) {
            return true
        }
        // 也检查会话 metadata
        const session = this.syncEngine.getSession(sessionId)
        const metadata = session?.metadata as Record<string, unknown> | null
        return metadata?.claudeAgent === 'advisor' || metadata?.isAdvisor === true
    }

    private selectMachine(): Machine | null {
        const machines = this.syncEngine.getOnlineMachinesByNamespace(this.namespace)
        if (machines.length === 0) {
            return null
        }
        // 当前只有一台机器，直接返回第一个
        return machines[0]
    }

    private async sendInitPrompt(workingDir: string): Promise<void> {
        if (!this.advisorSessionId) {
            return
        }

        try {
            const activeSessionCount = this.syncEngine.getActiveSessions()
                .filter(s => s.namespace === this.namespace && !this.isAdvisorSession(s.id))
                .length

            const prompt = await buildAdvisorInitPrompt({
                namespace: this.namespace,
                workingDir,
                activeSessionCount
            })

            console.log(`[AdvisorScheduler] Sending init prompt to session ${this.advisorSessionId}, prompt length: ${prompt.length}`)
            await this.syncEngine.sendMessage(this.advisorSessionId, {
                text: prompt,
                sentFrom: 'webapp'
            })

            console.log('[AdvisorScheduler] Init prompt sent to advisor session')
        } catch (error) {
            console.error('[AdvisorScheduler] Failed to send init prompt:', error)
        }
    }

    private subscribeToSessionEnd(): void {
        if (this.unsubscribe) {
            return  // 已经订阅
        }

        this.unsubscribe = this.syncEngine.subscribe((event) => {
            if (event.type === 'session-updated' && event.sessionId === this.advisorSessionId) {
                const session = this.syncEngine.getSession(this.advisorSessionId!)
                if (session && !session.active) {
                    console.log('[AdvisorScheduler] Advisor session went offline, scheduling restart')
                    this.onSessionEnd(this.advisorSessionId!)
                }
            }
        })
    }

    async onSessionEnd(sessionId: string): Promise<void> {
        if (sessionId === this.advisorSessionId) {
            console.log(`[AdvisorScheduler] Advisor session ${sessionId} ended, scheduling restart`)
            await this.store.upsertAdvisorState(this.namespace, {
                status: 'idle',
                lastSeen: Date.now()
            })
            this.scheduleRestart()
        }
    }

    private scheduleRestart(): void {
        if (this.restartTimer) {
            return  // 已经有计划的重启
        }

        this.restartTimer = setTimeout(() => {
            this.restartTimer = null
            this.start().catch(error => {
                console.error('[AdvisorScheduler] Restart failed:', error)
                this.scheduleRestart()
            })
        }, this.restartDelayMs)
    }

    // ==================== 定期审查功能 ====================

    /**
     * 启动定期审查
     */
    private startPeriodicReviews(): void {
        // 启动每日审查
        if (this.dailyReviewEnabled) {
            this.scheduleDailyReview()
        }

        // 启动主动审查（每隔一段时间触发一次）
        if (this.proactiveReviewIntervalMs > 0) {
            this.startProactiveReviews()
        }
    }

    /**
     * 调度每日审查
     */
    private scheduleDailyReview(): void {
        const now = new Date()
        const targetHour = this.dailyReviewHour

        // 计算下次审查时间
        let nextReview = new Date(now)
        nextReview.setHours(targetHour, 0, 0, 0)

        // 如果今天的目标时间已过，调度到明天
        if (nextReview <= now) {
            nextReview.setDate(nextReview.getDate() + 1)
        }

        const delay = nextReview.getTime() - now.getTime()
        console.log(`[AdvisorScheduler] Daily review scheduled for ${nextReview.toISOString()} (in ${Math.round(delay / 1000 / 60)} minutes)`)

        this.dailyReviewTimer = setTimeout(() => {
            this.triggerDailyReview()
            // 重新调度下一次
            this.scheduleDailyReview()
        }, delay)
    }

    /**
     * 启动主动审查（定时间隔）
     */
    private startProactiveReviews(): void {
        console.log(`[AdvisorScheduler] Proactive reviews enabled, interval: ${Math.round(this.proactiveReviewIntervalMs / 1000 / 60)} minutes`)

        // 首次延迟 5 分钟后开始
        setTimeout(() => {
            this.triggerProactiveReview()

            // 然后按间隔定期触发
            this.proactiveReviewTimer = setInterval(() => {
                this.triggerProactiveReview()
            }, this.proactiveReviewIntervalMs)
        }, 5 * 60 * 1000)
    }

    /**
     * 触发自迭代审查
     * @param force 强制触发（忽略日期检查，用于手动触发）
     */
    private async triggerDailyReview(force: boolean = false): Promise<void> {
        const today = new Date().toISOString().split('T')[0]
        if (!force && this.lastDailyReviewDate === today) {
            console.log('[AdvisorScheduler] Self-iteration already done today, skipping')
            return
        }

        if (!this.advisorSessionId) {
            console.log('[AdvisorScheduler] No advisor session, skipping daily review')
            return
        }

        const session = this.syncEngine.getSession(this.advisorSessionId)
        if (!session?.active) {
            console.log('[AdvisorScheduler] Advisor session not active, skipping daily review')
            return
        }

        console.log('[AdvisorScheduler] Triggering daily project review')
        this.lastDailyReviewDate = today

        // 开始审查，暂停 Summary 推送
        this.startReview()

        const reviewPrompt = this.buildDailyReviewPrompt()
        try {
            await this.syncEngine.sendMessage(this.advisorSessionId, {
                text: reviewPrompt,
                sentFrom: 'webapp'
            })
            console.log('[AdvisorScheduler] Daily review prompt sent')
        } catch (error) {
            console.error('[AdvisorScheduler] Failed to send daily review prompt:', error)
            this.endReview()  // 失败时恢复
        }
    }

    /**
     * 触发主动审查
     */
    private async triggerProactiveReview(): Promise<void> {
        if (!this.advisorSessionId) {
            return
        }

        const session = this.syncEngine.getSession(this.advisorSessionId)
        if (!session?.active) {
            return
        }

        // 获取活跃会话，看看是否有可以审查的内容
        const activeSessions = this.syncEngine.getActiveSessions()
            .filter(s => s.namespace === this.namespace && !this.isAdvisorSession(s.id))

        if (activeSessions.length === 0) {
            console.log('[AdvisorScheduler] No active sessions to review')
            return
        }

        console.log(`[AdvisorScheduler] Triggering proactive review for ${activeSessions.length} active sessions`)

        // 开始审查，暂停 Summary 推送
        this.startReview()

        const reviewPrompt = this.buildProactiveReviewPrompt(activeSessions)
        try {
            await this.syncEngine.sendMessage(this.advisorSessionId, {
                text: reviewPrompt,
                sentFrom: 'webapp'
            })
        } catch (error) {
            console.error('[AdvisorScheduler] Failed to send proactive review prompt:', error)
            this.endReview()  // 失败时恢复
        }
    }

    /**
     * 手动触发审查（公开方法，供外部调用）
     */
    async manualTriggerReview(type: 'daily' | 'proactive' = 'proactive'): Promise<void> {
        console.log(`[AdvisorScheduler] Manual trigger: ${type} review`)
        if (type === 'daily') {
            // 手动触发时跳过日期检查
            await this.triggerDailyReview(true)
        } else {
            await this.triggerProactiveReview()
        }
    }

    /**
     * 检查是否正在审查中（审查期间暂停 Summary 推送）
     */
    isReviewing(): boolean {
        // 检查超时
        if (this._isReviewing && this.reviewStartTime) {
            const elapsed = Date.now() - this.reviewStartTime
            if (elapsed > this.reviewTimeoutMs) {
                console.log('[AdvisorScheduler] Review timed out, resetting state')
                this._isReviewing = false
                this.reviewStartTime = null
            }
        }
        return this._isReviewing
    }

    /**
     * 开始审查（暂停 Summary 推送）
     */
    private startReview(): void {
        this._isReviewing = true
        this.reviewStartTime = Date.now()
        console.log('[AdvisorScheduler] Review started, Summary delivery paused')
    }

    /**
     * 结束审查（恢复 Summary 推送）
     */
    endReview(): void {
        this._isReviewing = false
        this.reviewStartTime = null
        console.log('[AdvisorScheduler] Review ended, Summary delivery resumed')
    }

    /**
     * 构建每日审查提示词
     */
    private buildDailyReviewPrompt(): string {
        const machine = this.selectMachine()
        const workingDir = machine
            ? (machine.metadata as Record<string, unknown>)?.advisorWorkingDir as string || '/home/guang/softwares/hapi'
            : '/home/guang/softwares/hapi'

        const today = new Date().toISOString().split('T')[0]

        return `[[DAILY_REVIEW]]
# HAPI 项目 CTO - 自迭代审查 ${today}

## 你的角色

你是 HAPI 项目的 **CTO / 技术总管**。你的职责是：
- **思考** 项目需要什么新功能、如何改进
- **规划** 任务和优先级
- **分发** 具体任务给子会话执行
- **审查** 子会话的执行结果

**重要：你不直接编写代码！所有开发、测试、修改工作都必须通过创建子会话来完成。**

工作目录: ${workingDir}

## 项目背景

HAPI 是一个 AI 编程助手的远程协作平台：
- 多 AI Agent 在远程服务器执行编程任务
- Web/Telegram 界面远程监控和交互
- 自动迭代系统（你作为 CTO）主动改进项目

## 你的工作流程

### 第一步：了解现状
运行 \`git log --oneline -20\` 查看最近的提交和改动。

### 第二步：思考和规划
思考项目需要什么：
- 新功能：用户可能需要什么？
- 改进：哪些现有功能可以更好？
- 修复：有什么已知问题需要处理？
- 技术债：有什么可以优化的？

### 第三步：分发任务

**当你决定要做某件事时，必须创建子会话来执行！**

输出以下格式来创建执行任务的子会话：

\`\`\`
[[HAPI_ADVISOR]]
{
  "type": "spawn_session",
  "id": "task-功能名称-${today}",
  "taskDescription": "详细的任务描述，包括：\\n1. 要实现什么功能\\n2. 涉及哪些文件\\n3. 技术要求\\n4. 验收标准",
  "workingDir": "${workingDir}",
  "agent": "claude",
  "yolo": true,
  "reason": "为什么要做这个任务",
  "expectedOutcome": "预期产出"
}
\`\`\`

### 第四步：记录决策

对于重要的规划和决策，输出 Suggestion 记录：

\`\`\`
[[HAPI_ADVISOR]]
{
  "type": "suggestion",
  "id": "plan-${today}",
  "title": "本次迭代计划",
  "detail": "计划做什么、为什么、预期效果",
  "category": "feature",
  "severity": "high",
  "confidence": 0.9,
  "scope": "project"
}
\`\`\`

## 禁止事项

- ❌ 不要直接使用 Edit、Write 工具修改代码
- ❌ 不要直接运行 npm/bun 构建或测试命令
- ❌ 不要在本会话中进行任何开发工作
- ✅ 可以使用 Read、Glob、Grep 了解代码
- ✅ 可以使用 git log/status 了解项目状态
- ✅ 必须通过 spawn_session 分发任务

## 本次迭代方向参考

请从以下方向选择，或提出你的想法：

1. **会话智能分组** - 按项目/时间/状态自动分组展示
2. **快捷命令系统** - 输入框支持 /deploy /test /review 等
3. **Agent 协作** - 多 Agent 协作完成复杂任务
4. **智能上下文** - 自动为 Agent 提供相关代码上下文
5. **自动化工作流** - 可重复执行的工作流
6. **监控大盘** - Agent 状态、资源、进度总览
7. **你的创意** - 任何你认为有价值的改进

---

**现在开始！先查看 git log 了解最近动态，然后规划并分发任务。**`
    }

    /**
     * 构建主动审查提示词
     */
    private buildProactiveReviewPrompt(sessions: Session[]): string {
        const sessionInfo = sessions.map(s => {
            const meta = s.metadata as Record<string, unknown> | null
            return `- ${s.id.slice(0, 8)}: ${meta?.path || 'unknown'} (${s.active ? 'active' : 'inactive'})`
        }).join('\n')

        return `[[PROACTIVE_REVIEW]]
定期检查：当前有 ${sessions.length} 个活跃会话。

${sessionInfo}

请检查：
1. 是否有长时间未完成的 TODO
2. 是否有反复出现的错误
3. 是否有可以优化的工作流程
4. 是否有跨会话的重复工作

如果发现可改进的地方，请输出建议或 ActionRequest。
即使只是小的优化建议也值得报告。`
    }
}
