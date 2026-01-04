/**
 * 自动迭代功能 - 执行引擎
 */

import type { ActionRequest, ActionStep, AutoIterationLog } from './types'
import type { AuditLogger } from './auditLogger'

// SyncEngine 的简化接口
interface SyncEngineInterface {
    getSession(sessionId: string): { id: string; active: boolean; metadata: { path?: string } | null } | undefined
    getActiveSessions(namespace: string): Array<{ id: string; active: boolean; metadata: { path?: string } | null }>
    sendMessage(sessionId: string, payload: { text: string; sentFrom?: string }): Promise<void>
}

export interface ExecutionResult {
    success: boolean
    result?: unknown
    error?: string
    rollbackData?: RollbackData
}

export interface RollbackData {
    timestamp: number
    sessionId: string
    steps: Array<{
        type: ActionStep['type']
        originalState: unknown
    }>
}

/**
 * 执行引擎 - 负责实际执行操作
 */
export class ExecutionEngine {
    constructor(
        private syncEngine: SyncEngineInterface,
        private auditLogger: AuditLogger,
        private namespace: string = 'default'
    ) {}

    /**
     * 执行 ActionRequest
     */
    async execute(request: ActionRequest, log: AutoIterationLog): Promise<ExecutionResult> {
        console.log(`[AutoIteration] Executing action ${request.actionType} for log ${log.id}`)

        // 1. 选择目标会话
        const targetSession = await this.selectTargetSession(request)
        if (!targetSession) {
            return {
                success: false,
                error: '未找到合适的活跃会话来执行操作'
            }
        }

        console.log(`[AutoIteration] Using session ${targetSession.id}`)

        // 2. 创建回滚点（如果可能）
        let rollbackData: RollbackData | undefined
        if (request.reversible) {
            rollbackData = await this.createRollbackPoint(request, targetSession.id)
        }

        // 3. 标记为执行中
        this.auditLogger.markExecuting(log.id)

        // 4. 构建执行消息
        const message = this.buildExecutionMessage(request)

        // 5. 发送到会话执行
        try {
            await this.syncEngine.sendMessage(targetSession.id, {
                text: message,
                sentFrom: 'advisor'
            })

            console.log(`[AutoIteration] Action sent to session ${targetSession.id}`)

            // 注意：这里只是发送了消息，实际执行结果需要通过会话事件来跟踪
            // 暂时认为发送成功就是执行成功
            return {
                success: true,
                result: {
                    sessionId: targetSession.id,
                    message: 'Action request sent to session'
                },
                rollbackData
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            console.error(`[AutoIteration] Failed to execute: ${errorMessage}`)
            return {
                success: false,
                error: errorMessage,
                rollbackData
            }
        }
    }

    /**
     * 选择目标会话
     */
    private async selectTargetSession(request: ActionRequest): Promise<{
        id: string
        active: boolean
        metadata: { path?: string } | null
    } | null> {
        // 1. 如果指定了目标会话，使用它
        if (request.targetSessionId) {
            const session = this.syncEngine.getSession(request.targetSessionId)
            if (session?.active) {
                return session
            }
        }

        // 2. 如果指定了项目，查找该项目的活跃会话
        if (request.targetProject) {
            const sessions = this.syncEngine.getActiveSessions(this.namespace)
            for (const session of sessions) {
                const workDir = session.metadata?.path
                if (workDir && this.pathMatches(workDir, request.targetProject)) {
                    return session
                }
            }
        }

        // 3. 使用来源会话
        if (request.sourceSessionId) {
            const session = this.syncEngine.getSession(request.sourceSessionId)
            if (session?.active) {
                return session
            }
        }

        // 4. 返回任意活跃会话
        const sessions = this.syncEngine.getActiveSessions(this.namespace)
        if (sessions.length > 0) {
            return sessions[0]
        }

        return null
    }

    /**
     * 检查路径是否匹配
     */
    private pathMatches(sessionPath: string, targetProject: string): boolean {
        const normalizedSession = sessionPath.replace(/\/+$/, '')
        const normalizedTarget = targetProject.replace(/\/+$/, '')

        return normalizedSession === normalizedTarget ||
               normalizedSession.startsWith(normalizedTarget + '/') ||
               normalizedTarget.startsWith(normalizedSession + '/')
    }

    /**
     * 构建执行消息
     */
    private buildExecutionMessage(request: ActionRequest): string {
        const lines: string[] = []

        lines.push(`[Auto-Iteration] 执行操作: ${request.actionType}`)
        lines.push(`原因: ${request.reason}`)
        lines.push(`预期结果: ${request.expectedOutcome}`)
        lines.push('')

        // 添加具体步骤
        for (let i = 0; i < request.steps.length; i++) {
            const step = request.steps[i]
            lines.push(`步骤 ${i + 1}: ${step.description}`)

            switch (step.type) {
                case 'command':
                    lines.push(`请执行命令: ${step.command}`)
                    break
                case 'edit':
                    lines.push(`请编辑文件: ${step.filePath}`)
                    if (step.oldContent && step.newContent) {
                        lines.push(`将 "${step.oldContent.slice(0, 50)}..." 替换为 "${step.newContent.slice(0, 50)}..."`)
                    }
                    break
                case 'create':
                    lines.push(`请创建文件: ${step.filePath}`)
                    break
                case 'delete':
                    lines.push(`请删除文件: ${step.filePath}`)
                    break
                case 'message':
                    lines.push(`消息: ${step.message}`)
                    break
            }
            lines.push('')
        }

        return lines.join('\n')
    }

    /**
     * 创建回滚点
     */
    private async createRollbackPoint(
        request: ActionRequest,
        sessionId: string
    ): Promise<RollbackData> {
        // 记录回滚信息
        // 实际的回滚数据需要在执行前获取文件内容等
        return {
            timestamp: Date.now(),
            sessionId,
            steps: request.steps.map(step => ({
                type: step.type,
                originalState: {
                    // TODO: 实际实现需要获取文件原始内容等
                    filePath: step.filePath,
                    description: step.description
                }
            }))
        }
    }

    /**
     * 回滚操作
     */
    async rollback(rollbackData: RollbackData): Promise<boolean> {
        console.log(`[AutoIteration] Rolling back operation from ${new Date(rollbackData.timestamp).toISOString()}`)

        const session = this.syncEngine.getSession(rollbackData.sessionId)
        if (!session?.active) {
            console.error('[AutoIteration] Session not active, cannot rollback')
            return false
        }

        // 构建回滚消息
        const message = `[Auto-Iteration] 请回滚以下操作:\n\n${
            rollbackData.steps.map((step, i) =>
                `${i + 1}. ${step.type}: ${JSON.stringify(step.originalState)}`
            ).join('\n')
        }`

        try {
            await this.syncEngine.sendMessage(rollbackData.sessionId, {
                text: message,
                sentFrom: 'advisor'
            })

            console.log('[AutoIteration] Rollback request sent')
            return true
        } catch (error) {
            console.error('[AutoIteration] Rollback failed:', error)
            return false
        }
    }

    /**
     * 直接执行命令步骤（不通过会话消息）
     * 注意：这是一个高级功能，需要谨慎使用
     */
    async executeStepDirectly(step: ActionStep, sessionId: string): Promise<{
        success: boolean
        result?: unknown
        error?: string
    }> {
        // 对于大多数操作，我们通过发送消息让 Claude 执行
        // 这里保留接口以便将来实现更直接的执行方式

        const message = `请执行以下操作:\n\n${step.description}\n\n${
            step.type === 'command' ? `命令: ${step.command}` :
            step.type === 'edit' ? `编辑文件: ${step.filePath}` :
            step.type === 'create' ? `创建文件: ${step.filePath}` :
            step.type === 'delete' ? `删除文件: ${step.filePath}` :
            `消息: ${step.message}`
        }`

        try {
            await this.syncEngine.sendMessage(sessionId, {
                text: message,
                sentFrom: 'advisor'
            })
            return { success: true }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            }
        }
    }
}
