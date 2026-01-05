/**
 * 自主决策与主动工作能力 (V5)
 *
 * 让 AI 员工具备：
 * 1. 主动任务发现 - 基于上下文识别工作机会
 * 2. 自主决策引擎 - 基于规则和学习的决策
 * 3. 工作优先级调度 - 智能任务排序
 * 4. 自我监控 - 进度追踪和异常处理
 */

import type { IStore } from '../store/interface'
import type { StoredAIProfile, StoredAIProfileMemory } from '../store'

// 任务机会类型
export type TaskOpportunityType =
    | 'code-improvement'      // 代码改进机会
    | 'bug-fix'              // Bug 修复
    | 'performance'          // 性能优化
    | 'documentation'        // 文档补充
    | 'testing'              // 测试补充
    | 'refactoring'          // 重构机会
    | 'dependency-update'    // 依赖更新
    | 'security'             // 安全问题
    | 'follow-up'            // 后续任务

// 决策类型
export type DecisionType =
    | 'accept-task'          // 接受任务
    | 'reject-task'          // 拒绝任务
    | 'defer-task'           // 推迟任务
    | 'delegate-task'        // 委托任务
    | 'request-clarification' // 请求澄清
    | 'escalate'             // 升级处理

// 决策置信度
export type ConfidenceLevel = 'high' | 'medium' | 'low'

// 任务机会
export interface TaskOpportunity {
    id: string
    type: TaskOpportunityType
    title: string
    description: string
    context: {
        sourceSessionId?: string
        relatedFiles?: string[]
        detectedPatterns?: string[]
        urgency: 'low' | 'medium' | 'high' | 'critical'
    }
    estimatedEffort: 'trivial' | 'small' | 'medium' | 'large'
    potentialImpact: 'low' | 'medium' | 'high'
    confidence: number  // 0-1
    discoveredAt: number
    expiresAt?: number
}

// 决策结果
export interface Decision {
    id: string
    opportunityId?: string
    type: DecisionType
    reasoning: string
    confidence: ConfidenceLevel
    conditions?: string[]  // 决策的前提条件
    alternatives?: {
        type: DecisionType
        reasoning: string
    }[]
    madeAt: number
    madeBy: string  // profileId
}

// 决策规则
export interface DecisionRule {
    id: string
    name: string
    description: string
    priority: number  // 越高越优先
    condition: (context: DecisionContext) => boolean
    action: DecisionType
    reasoning: string
}

// 决策上下文
export interface DecisionContext {
    profile: StoredAIProfile
    opportunity?: TaskOpportunity
    currentWorkload: number  // 0-100
    recentDecisions: Decision[]
    memories: StoredAIProfileMemory[]
    teamContext?: {
        activeMembers: number
        pendingTasks: number
    }
}

// 工作项
export interface WorkItem {
    id: string
    title: string
    description: string
    priority: number  // 1-100
    estimatedDuration: number  // 分钟
    deadline?: number
    dependencies?: string[]
    assignedTo?: string  // profileId
    status: 'pending' | 'in_progress' | 'blocked' | 'completed'
    createdAt: number
    startedAt?: number
    completedAt?: number
}

/**
 * 任务机会发现器
 */
export class TaskOpportunityDiscoverer {
    private store: IStore
    private patterns: Map<TaskOpportunityType, RegExp[]> = new Map()

    constructor(store: IStore) {
        this.store = store
        this.initializePatterns()
    }

    /**
     * 初始化模式识别规则
     */
    private initializePatterns(): void {
        this.patterns.set('code-improvement', [
            /TODO:/gi,
            /FIXME:/gi,
            /HACK:/gi,
            /XXX:/gi,
            /可以优化/gi,
            /需要重构/gi
        ])

        this.patterns.set('bug-fix', [
            /bug/gi,
            /error/gi,
            /exception/gi,
            /crash/gi,
            /报错/gi,
            /异常/gi
        ])

        this.patterns.set('performance', [
            /slow/gi,
            /performance/gi,
            /optimize/gi,
            /缓慢/gi,
            /性能/gi,
            /优化/gi
        ])

        this.patterns.set('documentation', [
            /undocumented/gi,
            /missing documentation/gi,
            /缺少文档/gi,
            /需要注释/gi
        ])

        this.patterns.set('testing', [
            /untested/gi,
            /missing test/gi,
            /缺少测试/gi,
            /需要测试/gi
        ])

        this.patterns.set('security', [
            /security/gi,
            /vulnerability/gi,
            /安全/gi,
            /漏洞/gi
        ])
    }

    /**
     * 从文本内容中发现任务机会
     */
    discoverFromContent(content: string, sourceSessionId?: string): TaskOpportunity[] {
        const opportunities: TaskOpportunity[] = []
        const now = Date.now()

        for (const [type, patterns] of this.patterns) {
            for (const pattern of patterns) {
                const matches = content.match(pattern)
                if (matches && matches.length > 0) {
                    // 提取上下文
                    const contextMatch = this.extractContext(content, pattern)

                    opportunities.push({
                        id: `opp-${now}-${Math.random().toString(36).substr(2, 6)}`,
                        type,
                        title: this.generateTitle(type, matches[0]),
                        description: contextMatch,
                        context: {
                            sourceSessionId,
                            detectedPatterns: matches.slice(0, 3),
                            urgency: this.estimateUrgency(type)
                        },
                        estimatedEffort: this.estimateEffort(type),
                        potentialImpact: this.estimateImpact(type),
                        confidence: 0.6 + matches.length * 0.1,
                        discoveredAt: now,
                        expiresAt: now + 7 * 24 * 60 * 60 * 1000  // 7 天过期
                    })

                    break  // 每种类型只添加一个机会
                }
            }
        }

        return opportunities
    }

    /**
     * 从会话历史中发现后续任务机会
     */
    discoverFollowUps(sessionSummary: string, profileId: string): TaskOpportunity[] {
        const opportunities: TaskOpportunity[] = []
        const now = Date.now()

        // 检测可能的后续任务
        const followUpPatterns = [
            /之后可以|后续可以|接下来可以|然后可以/gi,
            /TODO|待办|需要|应该/gi,
            /下一步|next step/gi
        ]

        for (const pattern of followUpPatterns) {
            const matches = sessionSummary.match(pattern)
            if (matches) {
                const context = this.extractContext(sessionSummary, pattern)
                opportunities.push({
                    id: `opp-${now}-${Math.random().toString(36).substr(2, 6)}`,
                    type: 'follow-up',
                    title: '后续任务机会',
                    description: context,
                    context: {
                        detectedPatterns: matches.slice(0, 3),
                        urgency: 'medium'
                    },
                    estimatedEffort: 'medium',
                    potentialImpact: 'medium',
                    confidence: 0.5,
                    discoveredAt: now
                })
                break
            }
        }

        return opportunities
    }

    private extractContext(content: string, pattern: RegExp): string {
        const match = pattern.exec(content)
        if (!match) return ''

        const start = Math.max(0, match.index - 100)
        const end = Math.min(content.length, match.index + match[0].length + 100)
        return content.substring(start, end).trim()
    }

    private generateTitle(type: TaskOpportunityType, match: string): string {
        const titles: Record<TaskOpportunityType, string> = {
            'code-improvement': `代码改进: ${match}`,
            'bug-fix': '潜在 Bug 修复',
            'performance': '性能优化机会',
            'documentation': '文档补充需求',
            'testing': '测试覆盖改进',
            'refactoring': '代码重构机会',
            'dependency-update': '依赖更新',
            'security': '安全问题处理',
            'follow-up': '后续任务'
        }
        return titles[type] || '任务机会'
    }

    private estimateUrgency(type: TaskOpportunityType): TaskOpportunity['context']['urgency'] {
        const urgencyMap: Record<TaskOpportunityType, TaskOpportunity['context']['urgency']> = {
            'security': 'critical',
            'bug-fix': 'high',
            'performance': 'medium',
            'code-improvement': 'low',
            'documentation': 'low',
            'testing': 'medium',
            'refactoring': 'low',
            'dependency-update': 'medium',
            'follow-up': 'medium'
        }
        return urgencyMap[type] || 'medium'
    }

    private estimateEffort(type: TaskOpportunityType): TaskOpportunity['estimatedEffort'] {
        const effortMap: Record<TaskOpportunityType, TaskOpportunity['estimatedEffort']> = {
            'security': 'large',
            'bug-fix': 'medium',
            'performance': 'large',
            'code-improvement': 'small',
            'documentation': 'trivial',
            'testing': 'medium',
            'refactoring': 'large',
            'dependency-update': 'small',
            'follow-up': 'medium'
        }
        return effortMap[type] || 'medium'
    }

    private estimateImpact(type: TaskOpportunityType): TaskOpportunity['potentialImpact'] {
        const impactMap: Record<TaskOpportunityType, TaskOpportunity['potentialImpact']> = {
            'security': 'high',
            'bug-fix': 'high',
            'performance': 'high',
            'code-improvement': 'medium',
            'documentation': 'low',
            'testing': 'medium',
            'refactoring': 'medium',
            'dependency-update': 'medium',
            'follow-up': 'medium'
        }
        return impactMap[type] || 'medium'
    }
}

/**
 * 自主决策引擎
 */
export class AutonomousDecisionEngine {
    private store: IStore
    private rules: DecisionRule[] = []
    private decisionHistory: Decision[] = []

    constructor(store: IStore) {
        this.store = store
        this.initializeDefaultRules()
    }

    /**
     * 初始化默认决策规则
     */
    private initializeDefaultRules(): void {
        this.rules = [
            // 高优先级规则：安全问题必须处理
            {
                id: 'security-critical',
                name: '安全问题优先',
                description: '安全相关的任务必须优先处理',
                priority: 100,
                condition: (ctx) =>
                    ctx.opportunity?.type === 'security' &&
                    ctx.opportunity?.context.urgency === 'critical',
                action: 'accept-task',
                reasoning: '安全问题具有最高优先级，必须立即处理'
            },
            // 工作负载规则：超载时拒绝新任务
            {
                id: 'overload-protection',
                name: '过载保护',
                description: '工作负载过高时拒绝新任务',
                priority: 90,
                condition: (ctx) => ctx.currentWorkload > 80,
                action: 'defer-task',
                reasoning: '当前工作负载过高，需要等待现有任务完成'
            },
            // 专长匹配规则
            {
                id: 'specialty-match',
                name: '专长匹配',
                description: '任务与 AI 专长匹配时接受',
                priority: 70,
                condition: (ctx) => {
                    if (!ctx.opportunity) return false
                    const specialties = ctx.profile.specialties.map(s => s.toLowerCase())
                    const taskType = ctx.opportunity.type.toLowerCase()
                    return specialties.some(s =>
                        taskType.includes(s) || s.includes(taskType.split('-')[0])
                    )
                },
                action: 'accept-task',
                reasoning: '任务类型与我的专长匹配'
            },
            // 低影响任务规则
            {
                id: 'low-impact-accept',
                name: '低影响快速接受',
                description: '低影响、低工作量的任务直接接受',
                priority: 60,
                condition: (ctx) =>
                    ctx.opportunity?.potentialImpact === 'low' &&
                    ctx.opportunity?.estimatedEffort === 'trivial' &&
                    ctx.currentWorkload < 50,
                action: 'accept-task',
                reasoning: '这是一个简单的任务，可以快速完成'
            },
            // 团队协作规则
            {
                id: 'team-delegation',
                name: '团队委托',
                description: '不在专长范围内的任务委托给合适的队友',
                priority: 50,
                condition: (ctx) => {
                    if (!ctx.teamContext || ctx.teamContext.activeMembers <= 1) return false
                    // 如果不是自己的专长且有其他成员
                    const specialties = ctx.profile.specialties.map(s => s.toLowerCase())
                    const taskType = ctx.opportunity?.type.toLowerCase() ?? ''
                    return !specialties.some(s => taskType.includes(s))
                },
                action: 'delegate-task',
                reasoning: '这个任务可能更适合其他团队成员'
            },
            // 需要澄清规则
            {
                id: 'low-confidence-clarify',
                name: '低置信度澄清',
                description: '任务描述不清晰时请求澄清',
                priority: 40,
                condition: (ctx) =>
                    ctx.opportunity !== undefined && ctx.opportunity.confidence < 0.4,
                action: 'request-clarification',
                reasoning: '任务描述不够清晰，需要更多信息'
            },
            // 默认规则
            {
                id: 'default-accept',
                name: '默认接受',
                description: '无特殊情况时接受任务',
                priority: 10,
                condition: (ctx) => ctx.currentWorkload < 70,
                action: 'accept-task',
                reasoning: '任务在可接受范围内'
            },
            {
                id: 'default-defer',
                name: '默认推迟',
                description: '工作量较高时推迟',
                priority: 5,
                condition: () => true,
                action: 'defer-task',
                reasoning: '当前资源有限，稍后处理'
            }
        ]
    }

    /**
     * 添加自定义规则
     */
    addRule(rule: DecisionRule): void {
        this.rules.push(rule)
        this.rules.sort((a, b) => b.priority - a.priority)
    }

    /**
     * 做出决策
     */
    makeDecision(context: DecisionContext): Decision {
        const now = Date.now()

        // 按优先级评估规则
        for (const rule of this.rules) {
            if (rule.condition(context)) {
                const decision: Decision = {
                    id: `dec-${now}-${Math.random().toString(36).substr(2, 6)}`,
                    opportunityId: context.opportunity?.id,
                    type: rule.action,
                    reasoning: rule.reasoning,
                    confidence: this.calculateConfidence(context, rule),
                    madeAt: now,
                    madeBy: context.profile.id
                }

                // 记录决策历史
                this.decisionHistory.push(decision)
                if (this.decisionHistory.length > 100) {
                    this.decisionHistory = this.decisionHistory.slice(-50)
                }

                console.log(`[DecisionEngine] Made decision: ${decision.type} for ${context.opportunity?.title ?? 'unknown'} with confidence ${decision.confidence}`)
                return decision
            }
        }

        // 不应该到达这里，因为有默认规则
        return {
            id: `dec-${now}-fallback`,
            type: 'defer-task',
            reasoning: '无匹配规则，默认推迟',
            confidence: 'low',
            madeAt: now,
            madeBy: context.profile.id
        }
    }

    /**
     * 计算决策置信度
     */
    private calculateConfidence(context: DecisionContext, rule: DecisionRule): ConfidenceLevel {
        let score = 0

        // 规则优先级影响置信度
        if (rule.priority >= 80) score += 2
        else if (rule.priority >= 50) score += 1

        // 机会置信度影响
        if (context.opportunity) {
            if (context.opportunity.confidence >= 0.8) score += 2
            else if (context.opportunity.confidence >= 0.5) score += 1
        }

        // 历史决策一致性
        const similarDecisions = this.decisionHistory.filter(
            d => d.type === rule.action
        ).length
        if (similarDecisions >= 5) score += 1

        if (score >= 4) return 'high'
        if (score >= 2) return 'medium'
        return 'low'
    }

    /**
     * 获取决策历史
     */
    getDecisionHistory(limit: number = 20): Decision[] {
        return this.decisionHistory.slice(-limit)
    }

    /**
     * 学习并调整规则权重
     */
    learnFromFeedback(decisionId: string, wasSuccessful: boolean): void {
        const decision = this.decisionHistory.find(d => d.id === decisionId)
        if (!decision) return

        // 找到对应的规则
        const rule = this.rules.find(r => r.action === decision.type)
        if (!rule) return

        // 简单的权重调整
        if (wasSuccessful) {
            rule.priority = Math.min(100, rule.priority + 1)
        } else {
            rule.priority = Math.max(1, rule.priority - 2)
        }

        console.log(`[DecisionEngine] Learned from feedback: rule ${rule.id} priority adjusted to ${rule.priority}`)
    }
}

/**
 * 工作优先级调度器
 */
export class WorkPriorityScheduler {
    private store: IStore
    private workQueue: WorkItem[] = []

    constructor(store: IStore) {
        this.store = store
    }

    /**
     * 添加工作项
     */
    addWorkItem(item: Omit<WorkItem, 'id' | 'createdAt' | 'status'>): WorkItem {
        const now = Date.now()
        const workItem: WorkItem = {
            id: `work-${now}-${Math.random().toString(36).substr(2, 6)}`,
            ...item,
            status: 'pending',
            createdAt: now
        }

        this.workQueue.push(workItem)
        this.sortQueue()

        return workItem
    }

    /**
     * 获取下一个工作项
     */
    getNextWorkItem(profileId?: string): WorkItem | null {
        const available = this.workQueue.filter(item => {
            // 状态检查
            if (item.status !== 'pending') return false

            // 如果指定了 profileId，检查分配
            if (profileId && item.assignedTo && item.assignedTo !== profileId) {
                return false
            }

            // 检查依赖
            if (item.dependencies && item.dependencies.length > 0) {
                const allDepsCompleted = item.dependencies.every(depId => {
                    const dep = this.workQueue.find(w => w.id === depId)
                    return dep?.status === 'completed'
                })
                if (!allDepsCompleted) return false
            }

            return true
        })

        return available[0] ?? null
    }

    /**
     * 更新工作项状态
     */
    updateWorkItemStatus(itemId: string, status: WorkItem['status']): void {
        const item = this.workQueue.find(w => w.id === itemId)
        if (!item) return

        const now = Date.now()
        item.status = status

        if (status === 'in_progress') {
            item.startedAt = now
        } else if (status === 'completed') {
            item.completedAt = now
        }

        // 如果完成了，检查是否有依赖项可以解锁
        if (status === 'completed') {
            this.sortQueue()
        }
    }

    /**
     * 排序工作队列
     */
    private sortQueue(): void {
        this.workQueue.sort((a, b) => {
            // 优先级优先
            if (a.priority !== b.priority) {
                return b.priority - a.priority
            }

            // 然后是截止时间
            if (a.deadline && b.deadline) {
                return a.deadline - b.deadline
            }
            if (a.deadline) return -1
            if (b.deadline) return 1

            // 最后是创建时间
            return a.createdAt - b.createdAt
        })
    }

    /**
     * 获取队列状态
     */
    getQueueStats(): {
        total: number
        pending: number
        inProgress: number
        completed: number
        blocked: number
    } {
        return {
            total: this.workQueue.length,
            pending: this.workQueue.filter(w => w.status === 'pending').length,
            inProgress: this.workQueue.filter(w => w.status === 'in_progress').length,
            completed: this.workQueue.filter(w => w.status === 'completed').length,
            blocked: this.workQueue.filter(w => w.status === 'blocked').length
        }
    }

    /**
     * 计算当前工作负载
     */
    calculateWorkload(profileId: string): number {
        const assignedItems = this.workQueue.filter(
            w => w.assignedTo === profileId && w.status === 'in_progress'
        )

        // 基于预估时长计算负载
        const totalDuration = assignedItems.reduce(
            (sum, item) => sum + item.estimatedDuration,
            0
        )

        // 假设 8 小时是 100% 负载
        const maxDuration = 8 * 60  // 480 分钟
        return Math.min(100, (totalDuration / maxDuration) * 100)
    }

    /**
     * 获取 Profile 的工作队列
     */
    getWorkQueueForProfile(profileId: string): WorkItem[] {
        return this.workQueue.filter(
            w => w.assignedTo === profileId || !w.assignedTo
        ).filter(
            w => w.status === 'pending' || w.status === 'in_progress'
        )
    }

    /**
     * 清理已完成的旧工作项
     */
    cleanupCompleted(maxAgeDays: number = 7): number {
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
        const before = this.workQueue.length

        this.workQueue = this.workQueue.filter(
            w => w.status !== 'completed' || (w.completedAt && w.completedAt > cutoff)
        )

        return before - this.workQueue.length
    }
}

/**
 * 自主代理管理器
 * 整合任务发现、决策引擎和调度器
 */
export class AutonomousAgentManager {
    private store: IStore
    private discoverer: TaskOpportunityDiscoverer
    private decisionEngine: AutonomousDecisionEngine
    private scheduler: WorkPriorityScheduler
    private opportunities: Map<string, TaskOpportunity> = new Map()

    constructor(store: IStore) {
        this.store = store
        this.discoverer = new TaskOpportunityDiscoverer(store)
        this.decisionEngine = new AutonomousDecisionEngine(store)
        this.scheduler = new WorkPriorityScheduler(store)
    }

    /**
     * 处理会话内容，发现任务机会
     */
    processContent(content: string, profileId: string, sessionId?: string): TaskOpportunity[] {
        const newOpportunities = this.discoverer.discoverFromContent(content, sessionId)

        for (const opp of newOpportunities) {
            this.opportunities.set(opp.id, opp)
        }

        console.log(`[AutonomousAgent] Discovered ${newOpportunities.length} opportunities`)
        return newOpportunities
    }

    /**
     * 评估机会并做出决策
     */
    async evaluateOpportunity(
        opportunityId: string,
        profileId: string,
        teamContext?: DecisionContext['teamContext']
    ): Promise<Decision | null> {
        const opportunity = this.opportunities.get(opportunityId)
        if (!opportunity) return null

        const profile = await this.store.getAIProfile(profileId)
        if (!profile) return null

        const workload = this.scheduler.calculateWorkload(profileId)
        const memories = await this.store.getProfileMemories({ namespace: profile.namespace, profileId, limit: 20 })
        const recentDecisions = this.decisionEngine.getDecisionHistory(10)

        const context: DecisionContext = {
            profile,
            opportunity,
            currentWorkload: workload,
            recentDecisions,
            memories,
            teamContext
        }

        const decision = this.decisionEngine.makeDecision(context)

        // 如果决策是接受任务，添加到工作队列
        if (decision.type === 'accept-task') {
            this.scheduler.addWorkItem({
                title: opportunity.title,
                description: opportunity.description,
                priority: this.calculatePriority(opportunity),
                estimatedDuration: this.estimateDuration(opportunity),
                assignedTo: profileId
            })
        }

        return decision
    }

    /**
     * 获取 Profile 的下一个工作
     */
    getNextWork(profileId: string): WorkItem | null {
        return this.scheduler.getNextWorkItem(profileId)
    }

    /**
     * 获取 Profile 的工作状态摘要
     */
    getWorkSummary(profileId: string): {
        opportunities: TaskOpportunity[]
        workQueue: WorkItem[]
        workload: number
        queueStats: ReturnType<WorkPriorityScheduler['getQueueStats']>
    } {
        const opportunities = Array.from(this.opportunities.values())
            .filter(o => !o.expiresAt || o.expiresAt > Date.now())
            .slice(0, 10)

        return {
            opportunities,
            workQueue: this.scheduler.getWorkQueueForProfile(profileId),
            workload: this.scheduler.calculateWorkload(profileId),
            queueStats: this.scheduler.getQueueStats()
        }
    }

    /**
     * 生成自主工作 Prompt
     */
    async generateAutonomousPrompt(profileId: string): Promise<string> {
        const profile = await this.store.getAIProfile(profileId)
        if (!profile) return ''

        const summary = this.getWorkSummary(profileId)
        const nextWork = this.getNextWork(profileId)

        return `
## 自主工作模式

**当前状态**:
- 工作负载: ${summary.workload.toFixed(0)}%
- 待处理任务: ${summary.queueStats.pending}
- 进行中: ${summary.queueStats.inProgress}

**发现的机会** (${summary.opportunities.length}):
${summary.opportunities.slice(0, 5).map(o =>
    `- [${o.type}] ${o.title} (紧急度: ${o.context.urgency})`
).join('\n') || '暂无'}

${nextWork ? `
**下一个任务**:
- ${nextWork.title}
- 优先级: ${nextWork.priority}
- 预计时长: ${nextWork.estimatedDuration} 分钟
` : ''}

**自主决策原则**:
1. 安全问题优先处理
2. 高影响任务优先于低影响任务
3. 工作负载超过 80% 时暂缓新任务
4. 不确定时请求澄清
5. 非专长任务可委托给队友
`.trim()
    }

    private calculatePriority(opportunity: TaskOpportunity): number {
        let priority = 50

        // 紧急度
        const urgencyBonus = { critical: 40, high: 25, medium: 10, low: 0 }
        priority += urgencyBonus[opportunity.context.urgency] ?? 0

        // 影响度
        const impactBonus = { high: 15, medium: 8, low: 3 }
        priority += impactBonus[opportunity.potentialImpact] ?? 0

        // 置信度
        priority += Math.round(opportunity.confidence * 10)

        return Math.min(100, priority)
    }

    private estimateDuration(opportunity: TaskOpportunity): number {
        const durationMap = {
            trivial: 15,
            small: 30,
            medium: 60,
            large: 180
        }
        return durationMap[opportunity.estimatedEffort] ?? 60
    }

    /**
     * 清理过期数据
     */
    cleanup(): void {
        const now = Date.now()

        // 清理过期机会
        for (const [id, opp] of this.opportunities) {
            if (opp.expiresAt && opp.expiresAt < now) {
                this.opportunities.delete(id)
            }
        }

        // 清理完成的工作项
        this.scheduler.cleanupCompleted()
    }
}
