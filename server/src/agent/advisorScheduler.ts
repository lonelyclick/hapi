/**
 * AdvisorScheduler - 保证 Advisor 会话常驻
 */

import { randomUUID } from 'node:crypto'
import type { SyncEngine, Machine, Session } from '../sync/syncEngine'
import type { Store } from '../store'
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
    private store: Store
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

    constructor(
        syncEngine: SyncEngine,
        store: Store,
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
            const state = this.store.getAdvisorState(this.namespace)
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
                this.store.upsertAdvisorState(this.namespace, {
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
                this.store.upsertAdvisorState(this.namespace, {
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
            this.store.upsertAdvisorState(this.namespace, {
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

    onSessionEnd(sessionId: string): void {
        if (sessionId === this.advisorSessionId) {
            console.log(`[AdvisorScheduler] Advisor session ${sessionId} ended, scheduling restart`)
            this.store.upsertAdvisorState(this.namespace, {
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
     * 触发每日审查
     */
    private async triggerDailyReview(): Promise<void> {
        const today = new Date().toISOString().split('T')[0]
        if (this.lastDailyReviewDate === today) {
            console.log('[AdvisorScheduler] Daily review already done today, skipping')
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

        const reviewPrompt = this.buildDailyReviewPrompt()
        try {
            await this.syncEngine.sendMessage(this.advisorSessionId, {
                text: reviewPrompt,
                sentFrom: 'webapp'
            })
            console.log('[AdvisorScheduler] Daily review prompt sent')
        } catch (error) {
            console.error('[AdvisorScheduler] Failed to send daily review prompt:', error)
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

        const reviewPrompt = this.buildProactiveReviewPrompt(activeSessions)
        try {
            await this.syncEngine.sendMessage(this.advisorSessionId, {
                text: reviewPrompt,
                sentFrom: 'webapp'
            })
        } catch (error) {
            console.error('[AdvisorScheduler] Failed to send proactive review prompt:', error)
        }
    }

    /**
     * 手动触发审查（公开方法，供外部调用）
     */
    async manualTriggerReview(type: 'daily' | 'proactive' = 'proactive'): Promise<void> {
        console.log(`[AdvisorScheduler] Manual trigger: ${type} review`)
        if (type === 'daily') {
            await this.triggerDailyReview()
        } else {
            await this.triggerProactiveReview()
        }
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
# 每日自迭代审查 - ${today}

你是 HAPI 项目的自迭代引擎。你的目标不仅仅是维护代码质量，而是**主动推动项目演进**。

工作目录: ${workingDir}

## 审查维度

### 1. 功能演进 (Feature Evolution)
- 分析现有功能，思考如何让它们更智能、更自动化
- 发现用户可能需要但尚未实现的功能
- 考虑如何让 AI Agent 能力更强大
- 思考如何提升用户体验

### 2. 架构优化 (Architecture)
- 识别架构瓶颈和技术债务
- 考虑可扩展性和可维护性
- 评估当前设计是否适应未来需求
- 发现可以模块化或解耦的地方

### 3. AI 时代适应 (AI-Native)
- 思考如何更好地利用 AI 能力（自然语言理解、代码生成、推理等）
- 考虑引入新的 AI 技术（如 RAG、Agent 协作、工具调用优化）
- 让项目更"AI-native"而不只是"AI-assisted"
- 关注 AI 领域最新趋势如何应用到项目中

### 4. 自动化程度 (Automation)
- 发现可以自动化的手动流程
- 提升 CI/CD 和部署流程
- 增强自我监控和自我修复能力
- 减少人工干预的需求

## 执行步骤

1. **了解项目现状**
   - 读取 README.md 和关键配置文件
   - 查看最近的 git log 了解开发动态
   - 浏览核心模块的代码结构

2. **深入分析**
   - 选择一个你认为最有价值的改进方向
   - 深入阅读相关代码
   - 思考具体的改进方案

3. **输出行动**
   - 对于可以立即执行的改进，输出 ActionRequest
   - 对于需要讨论的大改动，输出 Suggestion
   - 优先选择高 ROI（投入产出比）的改进

## 输出期望

不要只报告"代码没有问题"。作为自迭代引擎，你应该：
- 始终能找到至少一个可改进的地方
- 提出具体、可执行的改进方案
- 优先输出 ActionRequest（自动执行）而非 Suggestion（需人工确认）
- 思考长远，不只是修 bug

**记住：你的目标是让这个项目持续进化，变得更智能、更强大。**`
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
