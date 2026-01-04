/**
 * 协作任务模型 (V4.1)
 *
 * 支持多 AI 协作完成复杂任务，包括：
 * 1. 多 AI 分配 - 一个任务可以分配给多个 AI Profile
 * 2. 角色分工 - 每个参与者有明确的角色（leader/reviewer/worker）
 * 3. 子任务管理 - 复杂任务可拆分为子任务
 * 4. 依赖编排 - 支持任务间的依赖关系
 * 5. 进度追踪 - 实时追踪各参与者的进度
 */

import type { Store, StoredAIProfile } from '../store'

// 协作任务类型
export type CollaborationTaskType =
    | 'pair-programming'   // 结对编程：两个 AI 一起开发
    | 'code-review'        // 代码审查：一个开发，一个审查
    | 'divide-and-conquer' // 分治：任务拆分给多个 AI 并行执行
    | 'sequential-chain'   // 串行：任务按顺序传递
    | 'discussion'         // 讨论：多 AI 讨论得出结论

// 参与者角色
export type ParticipantRole =
    | 'leader'    // 主导者：负责任务协调和最终决策
    | 'worker'    // 执行者：负责具体实现
    | 'reviewer'  // 审查者：负责代码审查和质量保障
    | 'advisor'   // 顾问：提供建议但不直接参与实现

// 任务状态
export type CollaborationTaskStatus =
    | 'draft'       // 草稿：任务创建中
    | 'pending'     // 待开始：等待参与者就绪
    | 'in_progress' // 进行中：任务执行中
    | 'reviewing'   // 审查中：等待审查完成
    | 'completed'   // 已完成：任务成功完成
    | 'failed'      // 失败：任务执行失败
    | 'cancelled'   // 已取消：任务被取消

// 子任务状态
export type SubtaskStatus =
    | 'pending'     // 待分配
    | 'assigned'    // 已分配
    | 'in_progress' // 进行中
    | 'completed'   // 已完成
    | 'blocked'     // 被阻塞（等待依赖）
    | 'failed'      // 失败

// 参与者信息
export interface TaskParticipant {
    profileId: string         // AI Profile ID
    sessionId?: string        // 执行任务的会话 ID
    role: ParticipantRole     // 参与者角色
    status: 'invited' | 'joined' | 'working' | 'done' | 'left'
    joinedAt?: number
    lastActiveAt?: number
    contribution?: string     // 贡献描述
}

// 子任务
export interface Subtask {
    id: string
    parentTaskId: string
    title: string
    description: string
    assigneeProfileId?: string
    assigneeSessionId?: string
    status: SubtaskStatus
    dependencies: string[]    // 依赖的其他子任务 ID
    priority: number          // 优先级 1-10
    estimatedComplexity: 'low' | 'medium' | 'high'
    result?: string
    createdAt: number
    updatedAt: number
    completedAt?: number
}

// 协作任务
export interface CollaborationTask {
    id: string
    namespace: string
    title: string
    description: string
    type: CollaborationTaskType
    status: CollaborationTaskStatus

    // 参与者
    participants: TaskParticipant[]

    // 子任务
    subtasks: Subtask[]

    // 配置
    config: {
        maxParticipants: number
        requireReview: boolean
        autoAssignSubtasks: boolean
        parallelExecution: boolean
    }

    // 上下文
    context: {
        workingDir?: string
        projectName?: string
        relatedFiles?: string[]
        requirements?: string[]
    }

    // 时间戳
    createdAt: number
    updatedAt: number
    startedAt?: number
    completedAt?: number

    // 结果
    result?: {
        summary: string
        artifacts?: string[]
        lessons?: string[]
    }

    // 元数据
    metadata?: Record<string, unknown>
}

// 协作消息
export interface CollaborationMessage {
    id: string
    taskId: string
    senderProfileId: string
    senderSessionId?: string
    targetProfileIds?: string[]  // 如果为空则广播给所有参与者
    content: string
    messageType: 'chat' | 'code' | 'review' | 'decision' | 'handoff'
    createdAt: number
    metadata?: Record<string, unknown>
}

/**
 * 协作任务管理器
 */
export class CollaborationTaskManager {
    private tasks: Map<string, CollaborationTask> = new Map()
    private messages: Map<string, CollaborationMessage[]> = new Map()
    private store: Store

    constructor(store: Store) {
        this.store = store
    }

    /**
     * 创建协作任务
     */
    createTask(params: {
        namespace: string
        title: string
        description: string
        type: CollaborationTaskType
        leaderProfileId: string
        config?: Partial<CollaborationTask['config']>
        context?: Partial<CollaborationTask['context']>
    }): CollaborationTask {
        const now = Date.now()
        const id = `collab-${now}-${Math.random().toString(36).substr(2, 9)}`

        const task: CollaborationTask = {
            id,
            namespace: params.namespace,
            title: params.title,
            description: params.description,
            type: params.type,
            status: 'draft',
            participants: [{
                profileId: params.leaderProfileId,
                role: 'leader',
                status: 'joined',
                joinedAt: now
            }],
            subtasks: [],
            config: {
                maxParticipants: params.config?.maxParticipants ?? 5,
                requireReview: params.config?.requireReview ?? true,
                autoAssignSubtasks: params.config?.autoAssignSubtasks ?? true,
                parallelExecution: params.config?.parallelExecution ?? false,
                ...params.config
            },
            context: params.context ?? {},
            createdAt: now,
            updatedAt: now
        }

        this.tasks.set(id, task)
        this.messages.set(id, [])

        console.log(`[CollaborationTask] Created task ${id}: ${params.title}`)
        return task
    }

    /**
     * 添加参与者
     */
    addParticipant(taskId: string, profileId: string, role: ParticipantRole): boolean {
        const task = this.tasks.get(taskId)
        if (!task) return false

        // 检查是否已经是参与者
        if (task.participants.some(p => p.profileId === profileId)) {
            console.log(`[CollaborationTask] Profile ${profileId} is already a participant`)
            return false
        }

        // 检查参与者数量限制
        if (task.participants.length >= task.config.maxParticipants) {
            console.log(`[CollaborationTask] Task ${taskId} has reached max participants`)
            return false
        }

        // 检查角色限制（只能有一个 leader）
        if (role === 'leader' && task.participants.some(p => p.role === 'leader')) {
            console.log(`[CollaborationTask] Task ${taskId} already has a leader`)
            return false
        }

        const now = Date.now()
        task.participants.push({
            profileId,
            role,
            status: 'invited',
            joinedAt: now
        })
        task.updatedAt = now

        console.log(`[CollaborationTask] Added participant ${profileId} as ${role} to task ${taskId}`)
        return true
    }

    /**
     * 参与者加入任务（接受邀请）
     */
    joinTask(taskId: string, profileId: string, sessionId: string): boolean {
        const task = this.tasks.get(taskId)
        if (!task) return false

        const participant = task.participants.find(p => p.profileId === profileId)
        if (!participant) return false

        const now = Date.now()
        participant.sessionId = sessionId
        participant.status = 'joined'
        participant.joinedAt = now
        participant.lastActiveAt = now
        task.updatedAt = now

        console.log(`[CollaborationTask] Profile ${profileId} joined task ${taskId}`)
        return true
    }

    /**
     * 添加子任务
     */
    addSubtask(taskId: string, params: {
        title: string
        description: string
        dependencies?: string[]
        priority?: number
        estimatedComplexity?: 'low' | 'medium' | 'high'
    }): Subtask | null {
        const task = this.tasks.get(taskId)
        if (!task) return null

        const now = Date.now()
        const subtask: Subtask = {
            id: `subtask-${now}-${Math.random().toString(36).substr(2, 6)}`,
            parentTaskId: taskId,
            title: params.title,
            description: params.description,
            status: 'pending',
            dependencies: params.dependencies ?? [],
            priority: params.priority ?? 5,
            estimatedComplexity: params.estimatedComplexity ?? 'medium',
            createdAt: now,
            updatedAt: now
        }

        task.subtasks.push(subtask)
        task.updatedAt = now

        console.log(`[CollaborationTask] Added subtask ${subtask.id} to task ${taskId}`)
        return subtask
    }

    /**
     * 分配子任务给参与者
     */
    assignSubtask(taskId: string, subtaskId: string, profileId: string, sessionId?: string): boolean {
        const task = this.tasks.get(taskId)
        if (!task) return false

        const subtask = task.subtasks.find(s => s.id === subtaskId)
        if (!subtask) return false

        // 验证参与者存在
        const participant = task.participants.find(p => p.profileId === profileId)
        if (!participant) return false

        const now = Date.now()
        subtask.assigneeProfileId = profileId
        subtask.assigneeSessionId = sessionId
        subtask.status = 'assigned'
        subtask.updatedAt = now
        task.updatedAt = now

        console.log(`[CollaborationTask] Assigned subtask ${subtaskId} to profile ${profileId}`)
        return true
    }

    /**
     * 更新子任务状态
     */
    updateSubtaskStatus(taskId: string, subtaskId: string, status: SubtaskStatus, result?: string): boolean {
        const task = this.tasks.get(taskId)
        if (!task) return false

        const subtask = task.subtasks.find(s => s.id === subtaskId)
        if (!subtask) return false

        const now = Date.now()
        subtask.status = status
        subtask.updatedAt = now
        if (result) subtask.result = result
        if (status === 'completed') subtask.completedAt = now
        task.updatedAt = now

        // 检查依赖此子任务的其他子任务，更新其状态
        if (status === 'completed') {
            this.unblockDependentSubtasks(task, subtaskId)
        }

        // 检查是否所有子任务都完成
        this.checkTaskCompletion(task)

        console.log(`[CollaborationTask] Subtask ${subtaskId} status changed to ${status}`)
        return true
    }

    /**
     * 解锁依赖此子任务的其他子任务
     */
    private unblockDependentSubtasks(task: CollaborationTask, completedSubtaskId: string): void {
        for (const subtask of task.subtasks) {
            if (subtask.status === 'blocked' && subtask.dependencies.includes(completedSubtaskId)) {
                // 检查是否所有依赖都已完成
                const allDepsCompleted = subtask.dependencies.every(depId => {
                    const dep = task.subtasks.find(s => s.id === depId)
                    return dep?.status === 'completed'
                })

                if (allDepsCompleted) {
                    subtask.status = subtask.assigneeProfileId ? 'assigned' : 'pending'
                    subtask.updatedAt = Date.now()
                    console.log(`[CollaborationTask] Subtask ${subtask.id} unblocked`)
                }
            }
        }
    }

    /**
     * 检查任务是否完成
     */
    private checkTaskCompletion(task: CollaborationTask): void {
        if (task.status !== 'in_progress') return

        const allCompleted = task.subtasks.every(s => s.status === 'completed')
        const anyFailed = task.subtasks.some(s => s.status === 'failed')

        if (anyFailed) {
            task.status = 'failed'
            task.updatedAt = Date.now()
            console.log(`[CollaborationTask] Task ${task.id} failed due to subtask failure`)
        } else if (allCompleted && task.subtasks.length > 0) {
            if (task.config.requireReview) {
                task.status = 'reviewing'
            } else {
                task.status = 'completed'
                task.completedAt = Date.now()
            }
            task.updatedAt = Date.now()
            console.log(`[CollaborationTask] Task ${task.id} status changed to ${task.status}`)
        }
    }

    /**
     * 开始任务
     */
    startTask(taskId: string): boolean {
        const task = this.tasks.get(taskId)
        if (!task) return false
        if (task.status !== 'draft' && task.status !== 'pending') return false

        // 验证至少有一个参与者已加入
        const joinedParticipants = task.participants.filter(p => p.status === 'joined')
        if (joinedParticipants.length === 0) {
            console.log(`[CollaborationTask] Cannot start task ${taskId}: no joined participants`)
            return false
        }

        const now = Date.now()
        task.status = 'in_progress'
        task.startedAt = now
        task.updatedAt = now

        // 自动分配子任务
        if (task.config.autoAssignSubtasks) {
            this.autoAssignSubtasks(task)
        }

        console.log(`[CollaborationTask] Task ${taskId} started`)
        return true
    }

    /**
     * 自动分配子任务
     */
    private autoAssignSubtasks(task: CollaborationTask): void {
        const workers = task.participants.filter(
            p => (p.role === 'worker' || p.role === 'leader') && p.status === 'joined'
        )

        if (workers.length === 0) return

        const pendingSubtasks = task.subtasks.filter(s => s.status === 'pending')

        // 简单的轮询分配
        let workerIndex = 0
        for (const subtask of pendingSubtasks) {
            // 检查依赖是否满足
            const depsCompleted = subtask.dependencies.every(depId => {
                const dep = task.subtasks.find(s => s.id === depId)
                return dep?.status === 'completed'
            })

            if (!depsCompleted) {
                subtask.status = 'blocked'
                continue
            }

            const worker = workers[workerIndex % workers.length]
            subtask.assigneeProfileId = worker.profileId
            subtask.assigneeSessionId = worker.sessionId
            subtask.status = 'assigned'
            subtask.updatedAt = Date.now()

            workerIndex++
        }
    }

    /**
     * 发送协作消息
     */
    sendMessage(params: {
        taskId: string
        senderProfileId: string
        senderSessionId?: string
        targetProfileIds?: string[]
        content: string
        messageType: CollaborationMessage['messageType']
        metadata?: Record<string, unknown>
    }): CollaborationMessage | null {
        const task = this.tasks.get(params.taskId)
        if (!task) return null

        // 验证发送者是参与者
        if (!task.participants.some(p => p.profileId === params.senderProfileId)) {
            return null
        }

        const now = Date.now()
        const message: CollaborationMessage = {
            id: `msg-${now}-${Math.random().toString(36).substr(2, 6)}`,
            taskId: params.taskId,
            senderProfileId: params.senderProfileId,
            senderSessionId: params.senderSessionId,
            targetProfileIds: params.targetProfileIds,
            content: params.content,
            messageType: params.messageType,
            createdAt: now,
            metadata: params.metadata
        }

        const taskMessages = this.messages.get(params.taskId) ?? []
        taskMessages.push(message)
        this.messages.set(params.taskId, taskMessages)

        // 更新发送者的最后活跃时间
        const sender = task.participants.find(p => p.profileId === params.senderProfileId)
        if (sender) {
            sender.lastActiveAt = now
        }

        return message
    }

    /**
     * 获取任务消息
     */
    getMessages(taskId: string, limit: number = 50, since?: number): CollaborationMessage[] {
        const messages = this.messages.get(taskId) ?? []

        let filtered = messages
        if (since) {
            filtered = messages.filter(m => m.createdAt > since)
        }

        return filtered.slice(-limit)
    }

    /**
     * 完成任务审查
     */
    completeReview(taskId: string, approved: boolean, reviewerProfileId: string, comments?: string): boolean {
        const task = this.tasks.get(taskId)
        if (!task) return false
        if (task.status !== 'reviewing') return false

        // 验证审查者权限
        const reviewer = task.participants.find(p => p.profileId === reviewerProfileId)
        if (!reviewer || (reviewer.role !== 'reviewer' && reviewer.role !== 'leader')) {
            return false
        }

        const now = Date.now()

        if (approved) {
            task.status = 'completed'
            task.completedAt = now
        } else {
            // 需要修改，回到进行中状态
            task.status = 'in_progress'
        }

        task.updatedAt = now

        // 记录审查消息
        this.sendMessage({
            taskId,
            senderProfileId: reviewerProfileId,
            content: approved
                ? `审查通过${comments ? ': ' + comments : ''}`
                : `审查未通过: ${comments ?? '需要修改'}`,
            messageType: 'review'
        })

        console.log(`[CollaborationTask] Task ${taskId} review ${approved ? 'approved' : 'rejected'}`)
        return true
    }

    /**
     * 获取任务
     */
    getTask(taskId: string): CollaborationTask | undefined {
        return this.tasks.get(taskId)
    }

    /**
     * 获取命名空间下的所有任务
     */
    getTasksByNamespace(namespace: string): CollaborationTask[] {
        return Array.from(this.tasks.values()).filter(t => t.namespace === namespace)
    }

    /**
     * 获取参与者的所有任务
     */
    getTasksByParticipant(profileId: string): CollaborationTask[] {
        return Array.from(this.tasks.values()).filter(
            t => t.participants.some(p => p.profileId === profileId)
        )
    }

    /**
     * 获取进行中的任务
     */
    getActiveTasks(namespace?: string): CollaborationTask[] {
        return Array.from(this.tasks.values()).filter(t =>
            (t.status === 'in_progress' || t.status === 'reviewing') &&
            (!namespace || t.namespace === namespace)
        )
    }

    /**
     * 根据任务类型推荐参与者配置
     */
    suggestParticipants(type: CollaborationTaskType, profiles: StoredAIProfile[]): {
        profileId: string
        suggestedRole: ParticipantRole
        matchScore: number
    }[] {
        const suggestions: { profileId: string; suggestedRole: ParticipantRole; matchScore: number }[] = []

        for (const profile of profiles) {
            let role: ParticipantRole = 'worker'
            let score = 0

            switch (type) {
                case 'code-review':
                    if (profile.role === 'reviewer') {
                        role = 'reviewer'
                        score = 100
                    } else if (profile.role === 'architect') {
                        role = 'reviewer'
                        score = 80
                    } else if (profile.role === 'developer') {
                        role = 'worker'
                        score = 70
                    }
                    break

                case 'pair-programming':
                    if (profile.role === 'developer') {
                        role = 'worker'
                        score = 90
                    } else if (profile.role === 'architect') {
                        role = 'advisor'
                        score = 70
                    }
                    break

                case 'divide-and-conquer':
                    if (profile.role === 'architect') {
                        role = 'leader'
                        score = 90
                    } else if (profile.role === 'developer') {
                        role = 'worker'
                        score = 80
                    }
                    break

                case 'discussion':
                    score = 50 // 所有 AI 都可以参与讨论
                    role = 'worker'
                    if (profile.role === 'architect' || profile.role === 'pm') {
                        role = 'leader'
                        score = 70
                    }
                    break

                case 'sequential-chain':
                    if (profile.role === 'developer') {
                        role = 'worker'
                        score = 80
                    } else if (profile.role === 'tester') {
                        role = 'reviewer'
                        score = 85
                    }
                    break
            }

            if (score > 0) {
                suggestions.push({ profileId: profile.id, suggestedRole: role, matchScore: score })
            }
        }

        return suggestions.sort((a, b) => b.matchScore - a.matchScore)
    }

    /**
     * 获取任务进度摘要
     */
    getTaskProgress(taskId: string): {
        total: number
        completed: number
        inProgress: number
        blocked: number
        failed: number
        percentage: number
    } | null {
        const task = this.tasks.get(taskId)
        if (!task) return null

        const total = task.subtasks.length
        const completed = task.subtasks.filter(s => s.status === 'completed').length
        const inProgress = task.subtasks.filter(s => s.status === 'in_progress' || s.status === 'assigned').length
        const blocked = task.subtasks.filter(s => s.status === 'blocked').length
        const failed = task.subtasks.filter(s => s.status === 'failed').length

        return {
            total,
            completed,
            inProgress,
            blocked,
            failed,
            percentage: total > 0 ? Math.round((completed / total) * 100) : 0
        }
    }

    /**
     * 生成协作任务的 Prompt 片段
     * 用于注入到 AI 会话中，让 AI 了解当前协作上下文
     */
    generateCollaborationPrompt(taskId: string, forProfileId: string): string {
        const task = this.tasks.get(taskId)
        if (!task) return ''

        const participant = task.participants.find(p => p.profileId === forProfileId)
        if (!participant) return ''

        const profile = this.store.getAIProfile(forProfileId)
        const otherParticipants = task.participants
            .filter(p => p.profileId !== forProfileId)
            .map(p => {
                const pProfile = this.store.getAIProfile(p.profileId)
                return `- ${pProfile?.name ?? p.profileId} (${p.role})`
            })
            .join('\n')

        const mySubtasks = task.subtasks
            .filter(s => s.assigneeProfileId === forProfileId)
            .map(s => `- [${s.status}] ${s.title}`)
            .join('\n')

        const progress = this.getTaskProgress(taskId)

        let prompt = `
## 当前协作任务

**任务**: ${task.title}
**类型**: ${task.type}
**状态**: ${task.status}
**进度**: ${progress?.percentage ?? 0}% (${progress?.completed ?? 0}/${progress?.total ?? 0} 子任务完成)

**你的角色**: ${participant.role}
${profile ? `**你是**: ${profile.name} (${profile.role})` : ''}

**其他参与者**:
${otherParticipants || '无'}

**你负责的子任务**:
${mySubtasks || '暂无分配'}

**任务上下文**:
- 工作目录: ${task.context.workingDir ?? '未指定'}
- 项目: ${task.context.projectName ?? '未指定'}

**协作规则**:
1. 你可以通过消息与其他参与者沟通
2. 完成子任务后请及时更新状态
3. ${participant.role === 'reviewer' ? '请审查其他成员的工作' : '遇到问题请向 reviewer 或 leader 求助'}
`.trim()

        return prompt
    }

    /**
     * 取消任务
     */
    cancelTask(taskId: string, reason?: string): boolean {
        const task = this.tasks.get(taskId)
        if (!task) return false
        if (task.status === 'completed' || task.status === 'cancelled') return false

        task.status = 'cancelled'
        task.updatedAt = Date.now()

        // 发送取消消息
        const leader = task.participants.find(p => p.role === 'leader')
        if (leader) {
            this.sendMessage({
                taskId,
                senderProfileId: leader.profileId,
                content: `任务已取消${reason ? ': ' + reason : ''}`,
                messageType: 'decision'
            })
        }

        console.log(`[CollaborationTask] Task ${taskId} cancelled`)
        return true
    }

    /**
     * 清理完成的旧任务
     */
    cleanupOldTasks(maxAgeDays: number = 7): number {
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
        let cleaned = 0

        for (const [taskId, task] of this.tasks) {
            if ((task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed') &&
                task.updatedAt < cutoff) {
                this.tasks.delete(taskId)
                this.messages.delete(taskId)
                cleaned++
            }
        }

        if (cleaned > 0) {
            console.log(`[CollaborationTask] Cleaned up ${cleaned} old tasks`)
        }

        return cleaned
    }
}
