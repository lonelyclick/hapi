/**
 * 协作协议层 (V4.3)
 *
 * 定义多 AI 协作的具体模式和流程：
 * 1. Pair Programming - 结对编程协议
 * 2. Code Review - 代码审查协议
 * 3. Knowledge Sharing - 知识共享协议
 * 4. Task Handoff - 任务交接协议
 */

import type { IStore, StoredAIProfile, StoredAITeam, StoredAITeamKnowledge } from '../store/interface'
import type { CollaborationTask, TaskParticipant, ParticipantRole } from './collaborationTask'

// 协作协议类型
export type CollaborationProtocolType =
    | 'pair-programming'
    | 'code-review'
    | 'knowledge-sharing'
    | 'task-handoff'
    | 'brainstorming'

// 协议阶段
export type ProtocolPhase =
    | 'setup'       // 准备阶段
    | 'active'      // 执行阶段
    | 'handoff'     // 交接阶段
    | 'review'      // 审查阶段
    | 'complete'    // 完成阶段

// 协作消息类型
export type CollaborationMessageType =
    | 'instruction'  // 指令
    | 'code'         // 代码
    | 'question'     // 问题
    | 'answer'       // 回答
    | 'suggestion'   // 建议
    | 'approval'     // 批准
    | 'rejection'    // 拒绝
    | 'handoff'      // 交接

// 协议配置
export interface ProtocolConfig {
    maxRounds: number           // 最大交互轮数
    timeoutMinutes: number      // 超时时间
    requireApproval: boolean    // 是否需要批准
    autoHandoff: boolean        // 是否自动交接
}

// 协议上下文
export interface ProtocolContext {
    taskId: string
    teamId?: string
    participants: TaskParticipant[]
    currentPhase: ProtocolPhase
    round: number
    startedAt: number
    lastActivityAt: number
    history: ProtocolMessage[]
}

// 协议消息
export interface ProtocolMessage {
    id: string
    senderProfileId: string
    receiverProfileIds?: string[]
    messageType: CollaborationMessageType
    content: string
    codeSnippet?: string
    metadata?: Record<string, unknown>
    createdAt: number
}

// 协议规则
export interface ProtocolRule {
    phase: ProtocolPhase
    allowedMessageTypes: CollaborationMessageType[]
    requiredParticipants: ParticipantRole[]
    nextPhase?: ProtocolPhase
    transitionCondition?: (ctx: ProtocolContext) => boolean
}

/**
 * 协作协议基类
 */
export abstract class CollaborationProtocol {
    protected store: IStore
    protected config: ProtocolConfig
    protected context: ProtocolContext | null = null
    protected rules: ProtocolRule[] = []

    constructor(store: IStore, config?: Partial<ProtocolConfig>) {
        this.store = store
        this.config = {
            maxRounds: config?.maxRounds ?? 10,
            timeoutMinutes: config?.timeoutMinutes ?? 60,
            requireApproval: config?.requireApproval ?? true,
            autoHandoff: config?.autoHandoff ?? false
        }
    }

    abstract get type(): CollaborationProtocolType
    abstract get description(): string

    /**
     * 初始化协议上下文
     */
    initialize(taskId: string, participants: TaskParticipant[], teamId?: string): ProtocolContext {
        const now = Date.now()
        this.context = {
            taskId,
            teamId,
            participants,
            currentPhase: 'setup',
            round: 0,
            startedAt: now,
            lastActivityAt: now,
            history: []
        }
        return this.context
    }

    /**
     * 处理消息
     */
    handleMessage(message: ProtocolMessage): {
        success: boolean
        response?: string
        nextPhase?: ProtocolPhase
        error?: string
    } {
        if (!this.context) {
            return { success: false, error: 'Protocol not initialized' }
        }

        // 验证消息类型是否允许
        const currentRule = this.rules.find(r => r.phase === this.context!.currentPhase)
        if (currentRule && !currentRule.allowedMessageTypes.includes(message.messageType)) {
            return {
                success: false,
                error: `Message type ${message.messageType} not allowed in phase ${this.context.currentPhase}`
            }
        }

        // 记录消息
        this.context.history.push(message)
        this.context.lastActivityAt = Date.now()
        this.context.round++

        // 检查是否需要阶段转换
        if (currentRule?.transitionCondition?.(this.context)) {
            const nextPhase = currentRule.nextPhase
            if (nextPhase) {
                this.context.currentPhase = nextPhase
                return { success: true, nextPhase }
            }
        }

        return { success: true }
    }

    /**
     * 获取当前上下文
     */
    getContext(): ProtocolContext | null {
        return this.context
    }

    /**
     * 生成协议 Prompt
     */
    abstract generatePrompt(forProfileId: string): Promise<string>

    /**
     * 检查协议是否超时
     */
    isTimeout(): boolean {
        if (!this.context) return false
        const elapsed = (Date.now() - this.context.startedAt) / 1000 / 60
        return elapsed > this.config.timeoutMinutes
    }

    /**
     * 检查协议是否完成
     */
    isComplete(): boolean {
        return this.context?.currentPhase === 'complete'
    }
}

/**
 * 结对编程协议
 */
export class PairProgrammingProtocol extends CollaborationProtocol {
    private driverProfileId: string | null = null
    private navigatorProfileId: string | null = null

    get type(): CollaborationProtocolType {
        return 'pair-programming'
    }

    get description(): string {
        return '结对编程：Driver 负责编码，Navigator 负责审查和指导'
    }

    constructor(store: IStore, config?: Partial<ProtocolConfig>) {
        super(store, {
            maxRounds: 20,
            timeoutMinutes: 120,
            requireApproval: false,
            autoHandoff: true,
            ...config
        })

        this.rules = [
            {
                phase: 'setup',
                allowedMessageTypes: ['instruction'],
                requiredParticipants: ['leader', 'worker'],
                nextPhase: 'active',
                transitionCondition: (ctx) => ctx.round >= 1
            },
            {
                phase: 'active',
                allowedMessageTypes: ['code', 'question', 'answer', 'suggestion'],
                requiredParticipants: ['worker'],
                nextPhase: 'handoff',
                transitionCondition: (ctx) => ctx.round >= 5 && ctx.round % 5 === 0
            },
            {
                phase: 'handoff',
                allowedMessageTypes: ['handoff', 'instruction'],
                requiredParticipants: ['worker'],
                nextPhase: 'active',
                transitionCondition: (ctx) => ctx.history.some(
                    m => m.messageType === 'handoff' && m.createdAt > ctx.startedAt + (ctx.round - 1) * 60000
                )
            },
            {
                phase: 'review',
                allowedMessageTypes: ['approval', 'rejection', 'suggestion'],
                requiredParticipants: ['reviewer'],
                nextPhase: 'complete',
                transitionCondition: (ctx) => ctx.history.some(m => m.messageType === 'approval')
            }
        ]
    }

    /**
     * 设置 Driver 和 Navigator
     */
    setRoles(driverProfileId: string, navigatorProfileId: string): void {
        this.driverProfileId = driverProfileId
        this.navigatorProfileId = navigatorProfileId
    }

    /**
     * 交换角色
     */
    swapRoles(): void {
        const temp = this.driverProfileId
        this.driverProfileId = this.navigatorProfileId
        this.navigatorProfileId = temp
    }

    async generatePrompt(forProfileId: string): Promise<string> {
        if (!this.context) return ''

        const isDriver = forProfileId === this.driverProfileId
        const role = isDriver ? 'Driver' : 'Navigator'
        const partnerRole = isDriver ? 'Navigator' : 'Driver'

        const driverProfile = this.driverProfileId ? await this.store.getAIProfile(this.driverProfileId) : null
        const navigatorProfile = this.navigatorProfileId ? await this.store.getAIProfile(this.navigatorProfileId) : null

        return `
## 结对编程协议

**当前阶段**: ${this.context.currentPhase}
**轮次**: ${this.context.round}/${this.config.maxRounds}

**你的角色**: ${role}
${isDriver
    ? `作为 Driver，你负责：
    - 编写代码
    - 解释你的思路
    - 响应 Navigator 的建议`
    : `作为 Navigator，你负责：
    - 审查 Driver 的代码
    - 提出改进建议
    - 思考整体架构和潜在问题`
}

**你的搭档**: ${isDriver ? navigatorProfile?.name ?? 'Navigator' : driverProfile?.name ?? 'Driver'} (${partnerRole})

**协作规则**:
1. 每完成一个小功能，可以考虑交换角色
2. Navigator 发现问题应立即提出
3. Driver 应解释代码意图
4. 双方都可以提出设计建议

${this.context.history.length > 0 ? `
**最近消息**:
${this.context.history.slice(-5).map(m => `- [${m.messageType}] ${m.content.substring(0, 100)}...`).join('\n')}
` : ''}
`.trim()
    }
}

/**
 * 代码审查协议
 */
export class CodeReviewProtocol extends CollaborationProtocol {
    private authorProfileId: string | null = null
    private reviewerProfileIds: string[] = []

    get type(): CollaborationProtocolType {
        return 'code-review'
    }

    get description(): string {
        return '代码审查：Author 提交代码，Reviewers 进行审查和反馈'
    }

    constructor(store: IStore, config?: Partial<ProtocolConfig>) {
        super(store, {
            maxRounds: 10,
            timeoutMinutes: 60,
            requireApproval: true,
            autoHandoff: false,
            ...config
        })

        this.rules = [
            {
                phase: 'setup',
                allowedMessageTypes: ['instruction', 'code'],
                requiredParticipants: ['worker'],
                nextPhase: 'review',
                transitionCondition: (ctx) => ctx.history.some(m => m.messageType === 'code')
            },
            {
                phase: 'review',
                allowedMessageTypes: ['question', 'suggestion', 'approval', 'rejection'],
                requiredParticipants: ['reviewer'],
                nextPhase: 'active',
                transitionCondition: (ctx) => ctx.history.some(
                    m => m.messageType === 'rejection' || m.messageType === 'suggestion'
                )
            },
            {
                phase: 'active',
                allowedMessageTypes: ['code', 'answer'],
                requiredParticipants: ['worker'],
                nextPhase: 'review',
                transitionCondition: (ctx) => ctx.history.filter(m => m.messageType === 'code').length > 1
            },
            {
                phase: 'complete',
                allowedMessageTypes: [],
                requiredParticipants: []
            }
        ]
    }

    /**
     * 设置作者和审查者
     */
    setParticipants(authorProfileId: string, reviewerProfileIds: string[]): void {
        this.authorProfileId = authorProfileId
        this.reviewerProfileIds = reviewerProfileIds
    }

    /**
     * 检查是否所有审查者都已批准
     */
    isFullyApproved(): boolean {
        if (!this.context || this.reviewerProfileIds.length === 0) return false

        const approvals = this.context.history.filter(m => m.messageType === 'approval')
        const approvedReviewers = new Set(approvals.map(m => m.senderProfileId))

        return this.reviewerProfileIds.every(id => approvedReviewers.has(id))
    }

    async generatePrompt(forProfileId: string): Promise<string> {
        if (!this.context) return ''

        const isAuthor = forProfileId === this.authorProfileId
        const authorProfile = this.authorProfileId ? await this.store.getAIProfile(this.authorProfileId) : null

        // Pre-fetch reviewer profiles
        const reviewerProfiles = await Promise.all(
            this.reviewerProfileIds.map(id => this.store.getAIProfile(id))
        )
        const reviewerNames = reviewerProfiles.map((p, i) => p?.name ?? this.reviewerProfileIds[i]).join(', ')

        if (isAuthor) {
            const reviewStatus = await this.getReviewStatus()
            const recentHistory = await this.getRecentHistory()
            return `
## 代码审查协议 - Author 视角

**当前阶段**: ${this.context.currentPhase}
**审查者**: ${reviewerNames}

**你的职责**:
1. 提交需要审查的代码
2. 回答审查者的问题
3. 根据反馈修改代码
4. 解释设计决策

**审查状态**:
${reviewStatus}

${recentHistory}
`.trim()
        } else {
            const recentHistory = await this.getRecentHistory()
            return `
## 代码审查协议 - Reviewer 视角

**当前阶段**: ${this.context.currentPhase}
**代码作者**: ${authorProfile?.name ?? 'Author'}

**你的职责**:
1. 仔细审查代码质量
2. 检查潜在的 bug 和安全问题
3. 验证是否符合编码规范
4. 提出改进建议
5. 决定是否批准

**审查清单**:
- [ ] 代码逻辑正确
- [ ] 没有明显的 bug
- [ ] 符合编码规范
- [ ] 没有安全漏洞
- [ ] 性能可接受
- [ ] 有适当的注释

${recentHistory}
`.trim()
        }
    }

    private async getReviewStatus(): Promise<string> {
        if (!this.context) return ''

        const approvals = this.context.history.filter(m => m.messageType === 'approval')
        const rejections = this.context.history.filter(m => m.messageType === 'rejection')

        const statusLines: string[] = []
        for (const id of this.reviewerProfileIds) {
            const profile = await this.store.getAIProfile(id)
            const name = profile?.name ?? id
            const approved = approvals.some(m => m.senderProfileId === id)
            const rejected = rejections.some(m => m.senderProfileId === id)

            if (approved) statusLines.push(`✅ ${name}: 已批准`)
            else if (rejected) statusLines.push(`❌ ${name}: 需要修改`)
            else statusLines.push(`⏳ ${name}: 待审查`)
        }
        return statusLines.join('\n')
    }

    private async getRecentHistory(): Promise<string> {
        if (!this.context || this.context.history.length === 0) return ''

        const lines: string[] = []
        for (const m of this.context.history.slice(-5)) {
            const profile = await this.store.getAIProfile(m.senderProfileId)
            const sender = profile?.name ?? 'Unknown'
            lines.push(`- [${sender}/${m.messageType}] ${m.content.substring(0, 80)}...`)
        }

        return `
**最近消息**:
${lines.join('\n')}`
    }
}

/**
 * 知识共享协议
 */
export class KnowledgeSharingProtocol extends CollaborationProtocol {
    private teamId: string | null = null

    get type(): CollaborationProtocolType {
        return 'knowledge-sharing'
    }

    get description(): string {
        return '知识共享：团队成员分享和学习知识'
    }

    constructor(store: IStore, config?: Partial<ProtocolConfig>) {
        super(store, {
            maxRounds: 50,
            timeoutMinutes: 180,
            requireApproval: false,
            autoHandoff: false,
            ...config
        })

        this.rules = [
            {
                phase: 'active',
                allowedMessageTypes: ['instruction', 'question', 'answer', 'suggestion'],
                requiredParticipants: ['worker', 'advisor']
            }
        ]
    }

    /**
     * 设置团队 ID
     */
    setTeam(teamId: string): void {
        this.teamId = teamId
    }

    /**
     * 提取知识并保存到团队知识库
     */
    async extractAndSaveKnowledge(
        message: ProtocolMessage,
        category: StoredAITeamKnowledge['category'],
        importance: number = 0.5
    ): Promise<StoredAITeamKnowledge | null> {
        if (!this.teamId || !this.context) return null

        // 生成知识标题
        const title = this.generateKnowledgeTitle(message.content)

        // Get team to retrieve namespace
        const team = await this.store.getAITeam(this.teamId)
        if (!team) return null

        return await this.store.addAITeamKnowledge({
            teamId: this.teamId,
            namespace: team.namespace,
            title,
            content: message.content,
            category,
            contributorProfileId: message.senderProfileId,
            importance
        })
    }

    private generateKnowledgeTitle(content: string): string {
        // 简单的标题生成：取前 50 个字符
        const cleaned = content.replace(/\n/g, ' ').trim()
        if (cleaned.length <= 50) return cleaned
        return cleaned.substring(0, 47) + '...'
    }

    async generatePrompt(forProfileId: string): Promise<string> {
        if (!this.context) return ''

        const profile = await this.store.getAIProfile(forProfileId)
        const team = this.teamId ? await this.store.getAITeam(this.teamId) : null

        // 获取团队知识
        const teamKnowledge = this.teamId
            ? await this.store.getAITeamKnowledgeList(this.teamId, { limit: 10 })
            : []

        // Pre-fetch sender profiles for history
        const historyLines: string[] = []
        if (this.context.history.length > 0) {
            for (const m of this.context.history.slice(-10)) {
                const senderProfile = await this.store.getAIProfile(m.senderProfileId)
                const sender = senderProfile?.name ?? 'Unknown'
                historyLines.push(`- [${sender}] ${m.content.substring(0, 100)}...`)
            }
        }

        return `
## 知识共享协议

**团队**: ${team?.name ?? '未知团队'}
**你的角色**: ${profile?.role ?? 'member'}

**团队知识库** (${teamKnowledge.length} 条):
${teamKnowledge.map(k => `- [${k.category}] ${k.title}`).join('\n') || '暂无知识'}

**协作规则**:
1. 分享你在任务中学到的经验
2. 总结最佳实践和踩坑记录
3. 回答其他成员的问题
4. 提出值得记录的决策

**知识类别**:
- best-practice: 最佳实践
- lesson-learned: 踩坑记录
- decision: 架构决策
- convention: 团队约定

${historyLines.length > 0 ? `
**讨论历史**:
${historyLines.join('\n')}
` : ''}
`.trim()
    }
}

/**
 * 创建协议实例的工厂函数
 */
export function createProtocol(
    type: CollaborationProtocolType,
    store: IStore,
    config?: Partial<ProtocolConfig>
): CollaborationProtocol {
    switch (type) {
        case 'pair-programming':
            return new PairProgrammingProtocol(store, config)
        case 'code-review':
            return new CodeReviewProtocol(store, config)
        case 'knowledge-sharing':
            return new KnowledgeSharingProtocol(store, config)
        default:
            throw new Error(`Unknown protocol type: ${type}`)
    }
}

/**
 * 协议管理器
 */
export class ProtocolManager {
    private store: IStore
    private activeProtocols: Map<string, CollaborationProtocol> = new Map()

    constructor(store: IStore) {
        this.store = store
    }

    /**
     * 启动协议
     */
    startProtocol(
        taskId: string,
        type: CollaborationProtocolType,
        participants: TaskParticipant[],
        teamId?: string,
        config?: Partial<ProtocolConfig>
    ): CollaborationProtocol {
        const protocol = createProtocol(type, this.store, config)
        protocol.initialize(taskId, participants, teamId)
        this.activeProtocols.set(taskId, protocol)

        console.log(`[ProtocolManager] Started ${type} protocol for task ${taskId}`)
        return protocol
    }

    /**
     * 获取任务的协议
     */
    getProtocol(taskId: string): CollaborationProtocol | undefined {
        return this.activeProtocols.get(taskId)
    }

    /**
     * 结束协议
     */
    endProtocol(taskId: string): void {
        this.activeProtocols.delete(taskId)
        console.log(`[ProtocolManager] Ended protocol for task ${taskId}`)
    }

    /**
     * 获取所有活跃协议
     */
    getActiveProtocols(): Array<{ taskId: string; protocol: CollaborationProtocol }> {
        return Array.from(this.activeProtocols.entries()).map(([taskId, protocol]) => ({
            taskId,
            protocol
        }))
    }

    /**
     * 清理超时的协议
     */
    cleanupTimeoutProtocols(): number {
        let cleaned = 0
        for (const [taskId, protocol] of this.activeProtocols) {
            if (protocol.isTimeout()) {
                this.activeProtocols.delete(taskId)
                cleaned++
                console.log(`[ProtocolManager] Cleaned up timeout protocol for task ${taskId}`)
            }
        }
        return cleaned
    }
}
