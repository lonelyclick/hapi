/**
 * Advisor 任务追踪器
 *
 * 功能：
 * 1. 追踪 Advisor 分发的任务，避免重复开发
 * 2. 记录任务状态（进行中/完成/失败）
 * 3. 提供任务查询接口供 Advisor 使用
 */

import type { IStore } from '../store/interface'

export interface AdvisorTask {
    id: string                        // 任务 ID
    sessionId: string                 // 执行任务的子会话 ID
    advisorSessionId: string          // Advisor 会话 ID
    taskDescription: string           // 任务描述
    reason: string                    // 创建原因
    expectedOutcome?: string          // 预期结果
    workingDir: string                // 工作目录
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    createdAt: number
    updatedAt: number
    completedAt?: number
    result?: string                   // 完成结果或失败原因
    keywords: string[]                // 关键词，用于检测重复
}

export class AdvisorTaskTracker {
    private tasks: Map<string, AdvisorTask> = new Map()
    private sessionToTask: Map<string, string> = new Map()  // sessionId -> taskId
    private store: IStore

    constructor(store: IStore) {
        this.store = store
        this.loadFromStore()
    }

    /**
     * 从数据库加载任务（如果有持久化）
     */
    private loadFromStore(): void {
        // TODO: 从 store 加载任务状态
        // 目前使用内存存储
    }

    /**
     * 创建新任务
     */
    createTask(params: {
        id: string
        sessionId: string
        advisorSessionId: string
        taskDescription: string
        reason: string
        expectedOutcome?: string
        workingDir: string
    }): AdvisorTask {
        const now = Date.now()
        const keywords = this.extractKeywords(params.taskDescription)

        const task: AdvisorTask = {
            ...params,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            keywords
        }

        this.tasks.set(task.id, task)
        this.sessionToTask.set(params.sessionId, task.id)

        console.log(`[TaskTracker] Created task ${task.id} for session ${params.sessionId}`)
        return task
    }

    /**
     * 更新任务状态
     */
    updateTaskStatus(taskId: string, status: AdvisorTask['status'], result?: string): void {
        const task = this.tasks.get(taskId)
        if (!task) return

        task.status = status
        task.updatedAt = Date.now()
        if (result) task.result = result
        if (status === 'completed' || status === 'failed') {
            task.completedAt = Date.now()
        }

        console.log(`[TaskTracker] Task ${taskId} status changed to ${status}`)
    }

    /**
     * 通过会话 ID 更新任务状态
     */
    updateTaskBySessionId(sessionId: string, status: AdvisorTask['status'], result?: string): void {
        const taskId = this.sessionToTask.get(sessionId)
        if (taskId) {
            this.updateTaskStatus(taskId, status, result)
        }
    }

    /**
     * 标记会话开始运行
     */
    markSessionRunning(sessionId: string): void {
        this.updateTaskBySessionId(sessionId, 'running')
    }

    /**
     * 标记会话完成
     */
    markSessionCompleted(sessionId: string, result?: string): void {
        this.updateTaskBySessionId(sessionId, 'completed', result)
    }

    /**
     * 标记会话失败
     */
    markSessionFailed(sessionId: string, reason?: string): void {
        this.updateTaskBySessionId(sessionId, 'failed', reason)
    }

    /**
     * 获取任务
     */
    getTask(taskId: string): AdvisorTask | undefined {
        return this.tasks.get(taskId)
    }

    /**
     * 通过会话 ID 获取任务
     */
    getTaskBySessionId(sessionId: string): AdvisorTask | undefined {
        const taskId = this.sessionToTask.get(sessionId)
        return taskId ? this.tasks.get(taskId) : undefined
    }

    /**
     * 获取所有进行中的任务
     */
    getRunningTasks(): AdvisorTask[] {
        return Array.from(this.tasks.values())
            .filter(t => t.status === 'pending' || t.status === 'running')
    }

    /**
     * 检测是否有类似的进行中任务
     */
    hasSimilarRunningTask(taskDescription: string, threshold: number = 0.5): AdvisorTask | null {
        const newKeywords = this.extractKeywords(taskDescription)
        if (newKeywords.length === 0) return null

        const runningTasks = this.getRunningTasks()

        for (const task of runningTasks) {
            const similarity = this.calculateSimilarity(newKeywords, task.keywords)
            if (similarity >= threshold) {
                console.log(`[TaskTracker] Found similar running task ${task.id} (similarity: ${similarity.toFixed(2)})`)
                return task
            }
        }

        return null
    }

    /**
     * 提取关键词
     */
    private extractKeywords(text: string): string[] {
        // 移除标点符号，转小写，分词
        const words = text
            .toLowerCase()
            .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2)

        // 过滤常见停用词
        const stopWords = new Set([
            'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were',
            '的', '是', '了', '在', '和', '有', '这', '那', '一个', '可以', '需要', '进行',
            'function', 'component', 'file', 'code', 'implement', 'add', 'fix', 'update'
        ])

        return [...new Set(words.filter(w => !stopWords.has(w)))]
    }

    /**
     * 计算关键词相似度（Jaccard 相似度）
     */
    private calculateSimilarity(keywords1: string[], keywords2: string[]): number {
        if (keywords1.length === 0 || keywords2.length === 0) return 0

        const set1 = new Set(keywords1)
        const set2 = new Set(keywords2)

        let intersection = 0
        for (const word of set1) {
            if (set2.has(word)) intersection++
        }

        const union = set1.size + set2.size - intersection
        return intersection / union
    }

    /**
     * 获取任务摘要（供 Advisor 参考）
     */
    getTasksSummary(): string {
        const running = this.getRunningTasks()
        if (running.length === 0) {
            return '当前没有进行中的任务。'
        }

        const lines = ['当前进行中的任务：']
        for (const task of running) {
            const age = Math.floor((Date.now() - task.createdAt) / 60000)
            lines.push(`- [${task.id}] ${task.reason} (已运行 ${age} 分钟)`)
        }

        return lines.join('\n')
    }

    /**
     * 检查是否是 Advisor 创建的会话
     */
    isAdvisorSpawnedSession(sessionId: string): boolean {
        return this.sessionToTask.has(sessionId)
    }

    /**
     * 清理过期任务（超过 24 小时的已完成任务）
     */
    cleanupOldTasks(): void {
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
        for (const [taskId, task] of this.tasks) {
            if ((task.status === 'completed' || task.status === 'failed') &&
                task.completedAt && task.completedAt < oneDayAgo) {
                this.tasks.delete(taskId)
                this.sessionToTask.delete(task.sessionId)
            }
        }
    }
}
