/**
 * Sync Engine for HAPI Telegram Bot (Direct Connect)
 *
 * In the direct-connect architecture:
 * - hapi-server is the server (Socket.IO + REST)
 * - hapi CLI connects directly to the server (no relay)
 * - No E2E encryption; data is stored as JSON in SQLite
 */

import { z } from 'zod'
import type { Server } from 'socket.io'
import type { Store } from '../store'
import type { RpcRegistry } from '../socket/rpcRegistry'
import type { SSEManager } from '../sse/sseManager'
import { extractTodoWriteTodosFromMessageContent, TodosSchema, type TodoItem } from './todos'
import { getWebPushService } from '../services/webPush'

export type ConnectionStatus = 'disconnected' | 'connected'

export const MetadataSchema = z.object({
    path: z.string(),
    host: z.string(),
    version: z.string().optional(),
    name: z.string().optional(),
    os: z.string().optional(),
    summary: z.object({
        text: z.string(),
        updatedAt: z.number()
    }).optional(),
    machineId: z.string().optional(),
    tools: z.array(z.string()).optional(),
    flavor: z.string().nullish(),
    runtimeAgent: z.string().optional(),
    runtimeModel: z.string().optional(),
    runtimeModelReasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    worktree: z.object({
        basePath: z.string(),
        branch: z.string(),
        name: z.string(),
        worktreePath: z.string().optional(),
        createdAt: z.number().optional()
    }).optional()
}).passthrough()

export type Metadata = z.infer<typeof MetadataSchema>

export const AgentStateSchema = z.object({
    controlledByUser: z.boolean().nullish(),
    requests: z.record(z.string(), z.object({
        tool: z.string(),
        arguments: z.unknown(),
        createdAt: z.number().nullish()
    }).passthrough()).nullish(),
    completedRequests: z.record(z.string(), z.object({
        tool: z.string(),
        arguments: z.unknown(),
        createdAt: z.number().nullish(),
        completedAt: z.number().nullish(),
        status: z.enum(['canceled', 'denied', 'approved']),
        reason: z.string().optional(),
        mode: z.string().optional(),
        decision: z.enum(['approved', 'approved_for_session', 'denied', 'abort']).optional(),
        allowTools: z.array(z.string()).optional(),
        answers: z.record(z.string(), z.array(z.string())).optional()
    }).passthrough()).nullish()
}).passthrough()

export type AgentState = z.infer<typeof AgentStateSchema>

const machineMetadataSchema = z.object({
    host: z.string().optional(),
    platform: z.string().optional(),
    happyCliVersion: z.string().optional(),
    displayName: z.string().optional()
}).passthrough()

export interface Session {
    id: string
    namespace: string
    seq: number
    createdAt: number
    updatedAt: number
    active: boolean
    activeAt: number
    metadata: Metadata | null
    metadataVersion: number
    agentState: AgentState | null
    agentStateVersion: number
    thinking: boolean
    thinkingAt: number
    todos?: TodoItem[]
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'read-only' | 'safe-yolo' | 'yolo'
    modelMode?: 'default' | 'sonnet' | 'opus' | 'gpt-5.2-codex' | 'gpt-5.1-codex-max' | 'gpt-5.1-codex-mini' | 'gpt-5.2'
    modelReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
    advisorTaskId?: string | null  // Advisor 创建的会话的任务 ID
}

export interface Machine {
    id: string
    namespace: string
    seq: number
    createdAt: number
    updatedAt: number
    active: boolean
    activeAt: number
    metadata: {
        host: string
        platform: string
        happyCliVersion: string
        displayName?: string
        [key: string]: unknown
    } | null
    metadataVersion: number
    daemonState: unknown | null
    daemonStateVersion: number
}

export interface DecryptedMessage {
    id: string
    seq: number
    localId: string | null
    content: unknown
    createdAt: number
}

export type FetchMessagesResult =
    | { ok: true; messages: DecryptedMessage[] }
    | { ok: false; status: number | null; error: string }

export type RpcCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type RpcReadFileResponse = {
    success: boolean
    content?: string
    error?: string
}

export type RpcWriteFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type RpcPathExistsResponse = {
    exists: Record<string, boolean>
}

export type SyncEventType =
    | 'session-added'
    | 'session-updated'
    | 'session-removed'
    | 'message-received'
    | 'messages-cleared'
    | 'machine-updated'
    | 'connection-changed'
    | 'online-users-changed'
    | 'typing-changed'
    | 'advisor-alert'
    | 'advisor-idle-suggestion'
    | 'advisor-minimax-start'
    | 'advisor-minimax-complete'
    | 'advisor-minimax-error'
    | 'group-message'

export type OnlineUser = {
    email: string
    clientId: string
    deviceType?: string
    sessionId: string | null
}

export type TypingUser = {
    email: string
    clientId: string
    text: string
    updatedAt: number
}

export type AdvisorAlertData = {
    suggestionId: string
    title: string
    detail?: string
    category?: string
    severity: 'critical' | 'high' | 'medium' | 'low'
    sourceSessionId?: string
}

export type SuggestionChip = {
    id: string
    label: string           // 简短标签（如 "继续任务"）
    text: string            // 点击后填入输入框的完整文本
    category: 'todo_check' | 'error_analysis' | 'code_review' | 'general'
    icon?: string           // 可选图标（emoji）
}

export type AdvisorIdleSuggestionData = {
    suggestionId: string
    sessionId: string
    chips: SuggestionChip[]  // 多个建议芯片
    reason: string           // 触发原因
    createdAt: number
}

// MiniMax 审查相关数据
export type AdvisorMinimaxStartData = {
    sessionId: string
}

export type AdvisorMinimaxCompleteData = {
    sessionId: string
    chips: SuggestionChip[]
}

export type AdvisorMinimaxErrorData = {
    sessionId: string
    error: string
}

export type GroupMessageData = {
    id: string
    groupId: string
    sourceSessionId: string | null
    senderType: 'agent' | 'user' | 'system'
    content: string
    messageType: 'chat' | 'task' | 'feedback' | 'decision'
    createdAt: number
    // 可选的发送者信息（用于前端显示）
    senderName?: string
    agentType?: string
}

export interface SyncEvent {
    type: SyncEventType
    namespace?: string
    sessionId?: string
    machineId?: string
    groupId?: string
    data?: unknown
    message?: DecryptedMessage
    users?: OnlineUser[]
    typing?: TypingUser
    alert?: AdvisorAlertData
    idleSuggestion?: AdvisorIdleSuggestionData
    minimaxStart?: AdvisorMinimaxStartData
    minimaxComplete?: AdvisorMinimaxCompleteData
    minimaxError?: AdvisorMinimaxErrorData
    groupMessage?: GroupMessageData
}

export type SyncEventListener = (event: SyncEvent) => void

function clampAliveTime(t: number): number | null {
    if (!Number.isFinite(t)) return null
    const now = Date.now()
    if (t > now) return now
    if (t < now - 1000 * 60 * 10) return null
    return t
}

export class SyncEngine {
    private sessions: Map<string, Session> = new Map()
    private machines: Map<string, Machine> = new Map()
    private sessionMessages: Map<string, DecryptedMessage[]> = new Map()
    private listeners: Set<SyncEventListener> = new Set()
    private connectionStatus: ConnectionStatus = 'connected'

    private readonly lastBroadcastAtBySessionId: Map<string, number> = new Map()
    private readonly lastBroadcastAtByMachineId: Map<string, number> = new Map()
    private readonly todoBackfillAttemptedSessionIds: Set<string> = new Set()
    private readonly deletingSessions: Set<string> = new Set()
    private inactivityTimer: NodeJS.Timeout | null = null

    // 推送频率限制：每个 session 最少间隔 30 秒才能再次发送推送
    private readonly lastPushNotificationAt: Map<string, number> = new Map()
    private readonly PUSH_NOTIFICATION_MIN_INTERVAL_MS = 30_000

    constructor(
        private readonly store: Store,
        private readonly io: Server,
        private readonly rpcRegistry: RpcRegistry,
        private readonly sseManager: SSEManager
    ) {
        this.reloadAll()
        this.inactivityTimer = setInterval(() => this.expireInactive(), 5_000)
    }

    stop(): void {
        if (this.inactivityTimer) {
            clearInterval(this.inactivityTimer)
            this.inactivityTimer = null
        }
    }

    start(): Promise<void> {
        return Promise.resolve()
    }

    subscribe(listener: SyncEventListener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    emit(event: SyncEvent): void {
        const namespace = this.resolveNamespace(event)
        const enrichedEvent = namespace ? { ...event, namespace } : event

        for (const listener of this.listeners) {
            try {
                listener(enrichedEvent)
            } catch (error) {
                console.error('[SyncEngine] Listener error:', error)
            }
        }

        // 同步 agent 消息到群组
        if (event.type === 'message-received' && event.sessionId && event.message) {
            const msgContent = event.message.content as Record<string, unknown> | null
            if (msgContent) {
                const role = msgContent.role as string
                // 只同步 agent 的回复，不同步 user 消息
                if (role === 'agent' || role === 'assistant') {
                    const text = this.extractTextFromMessageContent(msgContent)
                    if (text) {
                        this.syncAgentMessageToGroups(event.sessionId, text)
                    }
                }
            }
        }

        const webappEvent: SyncEvent = event.type === 'message-received'
            ? {
                type: event.type,
                namespace,
                sessionId: event.sessionId,
                machineId: event.machineId,
                message: event.message
            }
            : event.type === 'advisor-idle-suggestion'
            ? {
                type: event.type,
                namespace,
                sessionId: event.sessionId,
                idleSuggestion: event.idleSuggestion
            }
            : {
                type: event.type,
                namespace,
                sessionId: event.sessionId,
                machineId: event.machineId,
                data: event.data,
                alert: event.alert
            }

        this.sseManager.broadcast(webappEvent)
    }

    private resolveNamespace(event: SyncEvent): string | undefined {
        if (event.namespace) {
            return event.namespace
        }
        if (event.sessionId) {
            return this.sessions.get(event.sessionId)?.namespace
        }
        if (event.machineId) {
            return this.machines.get(event.machineId)?.namespace
        }
        return undefined
    }

    /**
     * 同步 agent 消息到群组
     * 当 AI 回复消息时，如果该 session 属于某个活跃群组，自动将回复同步到群组消息表
     * 同时广播 SSE 事件给群组订阅者
     */
    private syncAgentMessageToGroups(sessionId: string, content: string): void {
        try {
            const groups = this.store.getGroupsForSession(sessionId)
            const session = this.sessions.get(sessionId)

            for (const group of groups) {
                // 存储消息到群组
                const message = this.store.addGroupMessage(group.id, sessionId, content, 'agent', 'chat')

                // 广播 SSE 事件给群组订阅者
                const groupMessageData: GroupMessageData = {
                    id: message.id,
                    groupId: message.groupId,
                    sourceSessionId: message.sourceSessionId,
                    senderType: message.senderType,
                    content: message.content,
                    messageType: message.messageType,
                    createdAt: message.createdAt,
                    senderName: session?.metadata?.name || undefined,
                    agentType: (session?.metadata as Record<string, unknown>)?.agent as string | undefined
                }

                this.sseManager.broadcastToGroup(group.id, {
                    type: 'group-message',
                    groupId: group.id,
                    groupMessage: groupMessageData
                })
            }

            if (groups.length > 0) {
                console.log(`[SyncEngine] Synced agent message to ${groups.length} group(s) for session ${sessionId}`)
            }
        } catch (error) {
            // 群组同步失败不应该影响主流程
            console.error('[SyncEngine] Failed to sync to group:', error)
        }
    }

    /**
     * 从消息内容中提取文本
     */
    private extractTextFromMessageContent(content: unknown): string | null {
        if (!content || typeof content !== 'object') return null
        const record = content as Record<string, unknown>

        const innerContent = record.content as Record<string, unknown> | string | null
        if (typeof innerContent === 'string') {
            return innerContent
        }
        if (innerContent && typeof innerContent === 'object') {
            const contentType = (innerContent as Record<string, unknown>).type as string
            if (contentType === 'codex') {
                const data = (innerContent as Record<string, unknown>).data as Record<string, unknown>
                if (data?.type === 'message' && typeof data.message === 'string') {
                    return data.message
                }
            } else if (contentType === 'text') {
                return ((innerContent as Record<string, unknown>).text as string) || null
            }
        }
        return null
    }

    getConnectionStatus(): ConnectionStatus {
        return this.connectionStatus
    }

    getSessions(): Session[] {
        return Array.from(this.sessions.values())
    }

    getSessionsByNamespace(namespace: string): Session[] {
        return this.getSessions().filter((session) => session.namespace === namespace)
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessions.get(sessionId)
    }

    getSessionByNamespace(sessionId: string, namespace: string): Session | undefined {
        const session = this.sessions.get(sessionId)
        if (!session || session.namespace !== namespace) {
            return undefined
        }
        return session
    }

    async deleteSession(sessionId: string, options?: { terminateSession?: boolean; force?: boolean }): Promise<boolean> {
        const session = this.sessions.get(sessionId)
        this.deletingSessions.add(sessionId)
        try {
            if (options?.terminateSession && session?.active) {
                await this.killSession(sessionId)
            }
        } catch (error) {
            this.deletingSessions.delete(sessionId)
            throw error
        }

        const deleted = this.store.deleteSession(sessionId)
        if (!deleted && !options?.force) {
            this.deletingSessions.delete(sessionId)
            return false
        }
        if (!deleted && !session) {
            this.deletingSessions.delete(sessionId)
            return false
        }

        this.sessions.delete(sessionId)
        this.sessionMessages.delete(sessionId)
        this.lastBroadcastAtBySessionId.delete(sessionId)
        this.todoBackfillAttemptedSessionIds.delete(sessionId)
        this.lastPushNotificationAt.delete(sessionId)
        this.deletingSessions.delete(sessionId)
        this.emit({ type: 'session-removed', sessionId })
        return deleted || Boolean(session)
    }

    async killSession(sessionId: string): Promise<void> {
        const result = await this.sessionRpc(sessionId, 'killSession', {})
        if (!result || typeof result !== 'object') {
            throw new Error('Invalid killSession response')
        }

        const payload = result as { success?: boolean; message?: string }
        if (!payload.success) {
            throw new Error(payload.message || 'Failed to kill session')
        }
    }

    getActiveSessions(): Session[] {
        return this.getSessions().filter(s => s.active)
    }

    getMachines(): Machine[] {
        return Array.from(this.machines.values())
    }

    getMachinesByNamespace(namespace: string): Machine[] {
        return this.getMachines().filter((machine) => machine.namespace === namespace)
    }

    getMachine(machineId: string): Machine | undefined {
        return this.machines.get(machineId)
    }

    getMachineByNamespace(machineId: string, namespace: string): Machine | undefined {
        const machine = this.machines.get(machineId)
        if (!machine || machine.namespace !== namespace) {
            return undefined
        }
        return machine
    }

    getOnlineMachines(): Machine[] {
        return this.getMachines().filter(m => m.active)
    }

    getOnlineMachinesByNamespace(namespace: string): Machine[] {
        return this.getMachinesByNamespace(namespace).filter((machine) => machine.active)
    }

    getSessionMessages(sessionId: string): DecryptedMessage[] {
        return this.sessionMessages.get(sessionId) || []
    }

    getMessagesPage(sessionId: string, options: { limit: number; beforeSeq: number | null }): {
        messages: DecryptedMessage[]
        page: {
            limit: number
            beforeSeq: number | null
            nextBeforeSeq: number | null
            hasMore: boolean
        }
    } {
        const stored = this.store.getMessages(sessionId, options.limit, options.beforeSeq ?? undefined)
        const messages: DecryptedMessage[] = stored.map((m) => ({
            id: m.id,
            seq: m.seq,
            localId: m.localId,
            content: m.content,
            createdAt: m.createdAt
        }))

        let oldestSeq: number | null = null
        for (const message of messages) {
            if (typeof message.seq !== 'number') continue
            if (oldestSeq === null || message.seq < oldestSeq) {
                oldestSeq = message.seq
            }
        }

        const nextBeforeSeq = oldestSeq
        const hasMore = nextBeforeSeq !== null && this.store.getMessages(sessionId, 1, nextBeforeSeq).length > 0

        return {
            messages,
            page: {
                limit: options.limit,
                beforeSeq: options.beforeSeq,
                nextBeforeSeq,
                hasMore
            }
        }
    }

    getMessagesAfter(sessionId: string, options: { afterSeq: number; limit: number }): DecryptedMessage[] {
        const stored = this.store.getMessagesAfter(sessionId, options.afterSeq, options.limit)
        return stored.map((m) => ({
            id: m.id,
            seq: m.seq,
            localId: m.localId,
            content: m.content,
            createdAt: m.createdAt
        }))
    }

    getMessageCount(sessionId: string): number {
        return this.store.getMessageCount(sessionId)
    }

    clearSessionMessages(sessionId: string, keepCount: number = 30): { deleted: number; remaining: number } {
        const result = this.store.clearMessages(sessionId, keepCount)

        // Clear the in-memory cache for this session
        this.sessionMessages.delete(sessionId)

        // Emit an event to notify clients
        this.emit({ type: 'messages-cleared', sessionId })

        return result
    }

    handleRealtimeEvent(event: SyncEvent): void {
        if (event.type === 'session-updated' && event.sessionId) {
            this.refreshSession(event.sessionId)
            return
        }

        if (event.type === 'machine-updated' && event.machineId) {
            this.refreshMachine(event.machineId)
            return
        }

        if (event.type === 'message-received' && event.sessionId) {
            if (!this.sessions.has(event.sessionId)) {
                this.refreshSession(event.sessionId)
            }
        }

        this.emit(event)
    }

    handleSessionAlive(payload: {
        sid: string
        time: number
        thinking?: boolean
        mode?: 'local' | 'remote'
        permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'read-only' | 'safe-yolo' | 'yolo'
        modelMode?: 'default' | 'sonnet' | 'opus' | 'gpt-5.2-codex' | 'gpt-5.1-codex-max' | 'gpt-5.1-codex-mini' | 'gpt-5.2'
        modelReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
    }): void {
        if (this.deletingSessions.has(payload.sid)) {
            return
        }
        const t = clampAliveTime(payload.time)
        if (!t) return

        const session = this.sessions.get(payload.sid) ?? this.refreshSession(payload.sid)
        if (!session) return

        const wasActive = session.active
        const wasThinking = session.thinking
        const previousPermissionMode = session.permissionMode
        const previousModelMode = session.modelMode
        const previousReasoningEffort = session.modelReasoningEffort

        session.active = true
        session.activeAt = Math.max(session.activeAt, t)
        session.thinking = Boolean(payload.thinking)
        session.thinkingAt = t
        if (payload.permissionMode !== undefined) {
            session.permissionMode = payload.permissionMode
        }
        if (payload.modelMode !== undefined) {
            session.modelMode = payload.modelMode
        }
        if (payload.modelReasoningEffort !== undefined) {
            session.modelReasoningEffort = payload.modelReasoningEffort
        }

        const now = Date.now()
        const lastBroadcastAt = this.lastBroadcastAtBySessionId.get(session.id) ?? 0
        const modeChanged = previousPermissionMode !== session.permissionMode
            || previousModelMode !== session.modelMode
            || previousReasoningEffort !== session.modelReasoningEffort
        const shouldBroadcast = (!wasActive && session.active)
            || (wasThinking !== session.thinking)
            || modeChanged
            || (now - lastBroadcastAt > 10_000)

        if (shouldBroadcast) {
            this.lastBroadcastAtBySessionId.set(session.id, now)
            const taskJustCompleted = wasThinking && !session.thinking
            this.emit({
                type: 'session-updated',
                sessionId: session.id,
                data: {
                    activeAt: session.activeAt,
                    thinking: session.thinking,
                    wasThinking: taskJustCompleted,
                    permissionMode: session.permissionMode,
                    modelMode: session.modelMode,
                    modelReasoningEffort: session.modelReasoningEffort
                }
            })

            // Send push notification when task completes (thinking: true -> false)
            if (taskJustCompleted) {
                this.sendTaskCompletePushNotification(session)
            }
        }
    }

    /**
     * Send push notification when a task completes
     * Sends to session owner and subscribers
     *
     * 支持两种订阅方式：
     * 1. 通过 chatId（Telegram 用户）
     * 2. 通过 clientId（非 Telegram 用户）
     */
    private sendTaskCompletePushNotification(session: Session): void {
        const webPush = getWebPushService()
        if (!webPush || !webPush.isConfigured()) {
            return
        }

        // 频率限制：同一 session 30 秒内最多发送一次推送
        const now = Date.now()
        const lastPushAt = this.lastPushNotificationAt.get(session.id) ?? 0
        if (now - lastPushAt < this.PUSH_NOTIFICATION_MIN_INTERVAL_MS) {
            console.log('[webpush] rate limited for session:', session.id,
                `(last push ${Math.round((now - lastPushAt) / 1000)}s ago)`)
            return
        }
        this.lastPushNotificationAt.set(session.id, now)

        const title = session.metadata?.summary?.text || session.metadata?.name || 'Task completed'
        const projectName = session.metadata?.path?.split('/').pop() || 'Session'

        // 获取应该接收通知的 chatIds（Telegram 用户）
        const recipientChatIds = this.store.getSessionNotificationRecipients(session.id)
        // 获取应该接收通知的 clientIds（非 Telegram 用户）
        const recipientClientIds = this.store.getSessionNotificationRecipientClientIds(session.id)

        if (recipientChatIds.length === 0 && recipientClientIds.length === 0) {
            console.log('[webpush] no recipients for session:', session.id)
            return
        }

        const payload = {
            title: `${projectName}: Task completed`,
            body: title,
            icon: '/pwa-192x192.png',
            badge: '/pwa-64x64.png',
            tag: `task-complete-${session.id}`,
            data: {
                type: 'task-complete',
                sessionId: session.id,
                url: `/sessions/${session.id}`
            }
        }

        // 发送给 Telegram 用户（通过 chatId）
        if (recipientChatIds.length > 0) {
            console.log('[webpush] sending to chatIds:', recipientChatIds)
            webPush.sendToChatIds(session.namespace, recipientChatIds, payload).catch(error => {
                console.error('[webpush] failed to send to chatIds:', recipientChatIds, error)
            })
        }

        // 发送给非 Telegram 用户（通过 clientId）
        if (recipientClientIds.length > 0) {
            console.log('[webpush] sending to clientIds:', recipientClientIds)
            for (const clientId of recipientClientIds) {
                webPush.sendToClient(session.namespace, clientId, payload).catch(error => {
                    console.error('[webpush] failed to send to clientId:', clientId, error)
                })
            }
        }
    }

    handleSessionEnd(payload: { sid: string; time: number }): void {
        if (this.deletingSessions.has(payload.sid)) {
            return
        }
        const t = clampAliveTime(payload.time) ?? Date.now()

        const session = this.sessions.get(payload.sid) ?? this.refreshSession(payload.sid)
        if (!session) return

        if (!session.active && !session.thinking) {
            return
        }

        const wasThinking = session.thinking
        session.active = false
        session.thinking = false
        session.thinkingAt = t

        this.emit({ type: 'session-updated', sessionId: session.id, data: { active: false, thinking: false, wasThinking } })
    }

    handleMachineAlive(payload: { machineId: string; time: number }): void {
        const t = clampAliveTime(payload.time)
        if (!t) return

        const machine = this.machines.get(payload.machineId) ?? this.refreshMachine(payload.machineId)
        if (!machine) return

        const wasActive = machine.active
        machine.active = true
        machine.activeAt = Math.max(machine.activeAt, t)

        const now = Date.now()
        const lastBroadcastAt = this.lastBroadcastAtByMachineId.get(machine.id) ?? 0
        const shouldBroadcast = (!wasActive && machine.active) || (now - lastBroadcastAt > 10_000)
        if (shouldBroadcast) {
            this.lastBroadcastAtByMachineId.set(machine.id, now)
            this.emit({ type: 'machine-updated', machineId: machine.id, data: { activeAt: machine.activeAt } })
        }
    }

    private expireInactive(): void {
        const now = Date.now()
        const sessionTimeoutMs = 30_000
        const machineTimeoutMs = 45_000

        for (const session of this.sessions.values()) {
            if (!session.active) continue
            if (now - session.activeAt <= sessionTimeoutMs) continue
            session.active = false
            session.thinking = false
            this.emit({ type: 'session-updated', sessionId: session.id, data: { active: false } })
        }

        for (const machine of this.machines.values()) {
            if (!machine.active) continue
            if (now - machine.activeAt <= machineTimeoutMs) continue
            machine.active = false
            this.emit({ type: 'machine-updated', machineId: machine.id, data: { active: false } })
        }
    }

    private refreshSession(sessionId: string): Session | null {
        let stored = this.store.getSession(sessionId)
        if (!stored) {
            const existed = this.sessions.delete(sessionId)
            if (existed) {
                this.emit({ type: 'session-removed', sessionId })
            }
            return null
        }

        const existing = this.sessions.get(sessionId)

        if (stored.todos === null && !this.todoBackfillAttemptedSessionIds.has(sessionId)) {
            this.todoBackfillAttemptedSessionIds.add(sessionId)
            const messages = this.store.getMessages(sessionId, 200)
            for (let i = messages.length - 1; i >= 0; i -= 1) {
                const message = messages[i]
                const todos = extractTodoWriteTodosFromMessageContent(message.content)
                if (todos) {
                    const updated = this.store.setSessionTodos(sessionId, todos, message.createdAt, stored.namespace)
                    if (updated) {
                        stored = this.store.getSession(sessionId) ?? stored
                    }
                    break
                }
            }
        }

        const metadata = (() => {
            const parsed = MetadataSchema.safeParse(stored.metadata)
            return parsed.success ? parsed.data : null
        })()

        const agentState = (() => {
            const parsed = AgentStateSchema.safeParse(stored.agentState)
            return parsed.success ? parsed.data : null
        })()

        const todos = (() => {
            if (stored.todos === null) return undefined
            const parsed = TodosSchema.safeParse(stored.todos)
            return parsed.success ? parsed.data : undefined
        })()

        const session: Session = {
            id: stored.id,
            namespace: stored.namespace,
            seq: stored.seq,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            active: existing?.active ?? stored.active,
            activeAt: existing?.activeAt ?? (stored.activeAt ?? stored.createdAt),
            metadata,
            metadataVersion: stored.metadataVersion,
            agentState,
            agentStateVersion: stored.agentStateVersion,
            thinking: existing?.thinking ?? false,
            thinkingAt: existing?.thinkingAt ?? 0,
            todos,
            permissionMode: existing?.permissionMode,
            modelMode: existing?.modelMode,
            modelReasoningEffort: existing?.modelReasoningEffort,
            advisorTaskId: stored.advisorTaskId
        }

        this.sessions.set(sessionId, session)
        this.emit({ type: existing ? 'session-updated' : 'session-added', sessionId, data: session })
        return session
    }

    private refreshMachine(machineId: string): Machine | null {
        const stored = this.store.getMachine(machineId)
        if (!stored) {
            const existed = this.machines.delete(machineId)
            if (existed) {
                this.emit({ type: 'machine-updated', machineId, data: null })
            }
            return null
        }

        const existing = this.machines.get(machineId)

        const metadata = (() => {
            const parsed = machineMetadataSchema.safeParse(stored.metadata)
            if (!parsed.success) return null
            const data = parsed.data as Record<string, unknown>
            const host = typeof data.host === 'string' ? data.host : 'unknown'
            const platform = typeof data.platform === 'string' ? data.platform : 'unknown'
            const happyCliVersion = typeof data.happyCliVersion === 'string' ? data.happyCliVersion : 'unknown'
            const displayName = typeof data.displayName === 'string' ? data.displayName : undefined
            return { host, platform, happyCliVersion, displayName, ...data }
        })()

        const storedActiveAt = stored.activeAt ?? stored.createdAt
        const existingActiveAt = existing?.activeAt ?? 0
        const useStoredActivity = storedActiveAt > existingActiveAt

        const machine: Machine = {
            id: stored.id,
            namespace: stored.namespace,
            seq: stored.seq,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            active: useStoredActivity ? stored.active : (existing?.active ?? stored.active),
            activeAt: useStoredActivity ? storedActiveAt : (existingActiveAt || storedActiveAt),
            metadata,
            metadataVersion: stored.metadataVersion,
            daemonState: stored.daemonState,
            daemonStateVersion: stored.daemonStateVersion
        }

        this.machines.set(machineId, machine)
        this.emit({ type: 'machine-updated', machineId, data: machine })
        return machine
    }

    private reloadAll(): void {
        const sessions = this.store.getSessions()
        for (const s of sessions) {
            this.refreshSession(s.id)
        }

        const machines = this.store.getMachines()
        for (const m of machines) {
            this.refreshMachine(m.id)
        }
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string): Session {
        const stored = this.store.getOrCreateSession(tag, metadata, agentState, namespace)
        return this.refreshSession(stored.id) ?? (() => { throw new Error('Failed to load session') })()
    }

    getOrCreateMachine(id: string, metadata: unknown, daemonState: unknown, namespace: string): Machine {
        const stored = this.store.getOrCreateMachine(id, metadata, daemonState, namespace)
        return this.refreshMachine(stored.id) ?? (() => { throw new Error('Failed to load machine') })()
    }

    async fetchMessages(sessionId: string): Promise<FetchMessagesResult> {
        try {
            const stored = this.store.getMessages(sessionId, 200)
            const messages: DecryptedMessage[] = stored.map((m) => ({
                id: m.id,
                seq: m.seq,
                localId: m.localId,
                content: m.content,
                createdAt: m.createdAt
            }))
            this.sessionMessages.set(sessionId, messages)
            return { ok: true, messages }
        } catch (error) {
            return { ok: false, status: null, error: error instanceof Error ? error.message : 'Failed to load messages' }
        }
    }

    async sendMessage(sessionId: string, payload: { text: string; localId?: string | null; sentFrom?: 'telegram-bot' | 'webapp' | 'advisor' }): Promise<void> {
        const sentFrom = payload.sentFrom ?? 'webapp'

        // 自动上下文压缩：对于 advisor/CTO 会话，消息数超过阈值时自动发送 /compact
        const AUTO_COMPACT_THRESHOLD = 50  // 消息数阈值
        const session = this.sessions.get(sessionId)
        const metadata = session?.metadata as Record<string, unknown> | null
        const isAdvisorSession = metadata?.claudeAgent === 'advisor' || metadata?.claudeAgent === 'cto' ||
            metadata?.isAdvisor === true || metadata?.isCTO === true ||
            session?.metadata?.name?.toLowerCase().includes('advisor') ||
            session?.metadata?.name?.toLowerCase().includes('cto')

        if (isAdvisorSession && !payload.text.startsWith('/compact') && !payload.text.startsWith('/clear')) {
            const messageCount = this.store.getMessageCount(sessionId)
            if (messageCount >= AUTO_COMPACT_THRESHOLD) {
                console.log(`[SyncEngine] Advisor session ${sessionId} has ${messageCount} messages, auto-compacting...`)
                // 先发送 /compact 命令
                const compactContent = {
                    role: 'user',
                    content: { type: 'text', text: '/compact' },
                    meta: { sentFrom: 'advisor' as const }
                }
                const compactMsg = this.store.addMessage(sessionId, compactContent)
                const compactUpdate = {
                    id: compactMsg.id,
                    seq: Date.now(),
                    createdAt: compactMsg.createdAt,
                    body: {
                        t: 'new-message' as const,
                        sid: sessionId,
                        message: {
                            id: compactMsg.id,
                            seq: compactMsg.seq,
                            createdAt: compactMsg.createdAt,
                            localId: compactMsg.localId,
                            content: compactMsg.content
                        }
                    }
                }
                this.io.of('/cli').to(`session:${sessionId}`).emit('update', compactUpdate)
                console.log(`[SyncEngine] Sent /compact command to advisor session ${sessionId}`)
            }
        }

        const content = {
            role: 'user',
            content: {
                type: 'text',
                text: payload.text
            },
            meta: {
                sentFrom
            }
        }

        const msg = this.store.addMessage(sessionId, content, payload.localId ?? undefined)

        const update = {
            id: msg.id,
            seq: Date.now(),
            createdAt: msg.createdAt,
            body: {
                t: 'new-message' as const,
                sid: sessionId,
                message: {
                    id: msg.id,
                    seq: msg.seq,
                    createdAt: msg.createdAt,
                    localId: msg.localId,
                    content: msg.content
                }
            }
        }
        this.io.of('/cli').to(`session:${sessionId}`).emit('update', update)

        // Keep a small in-memory cache for Telegram rendering.
        const cached = this.sessionMessages.get(sessionId) ?? []
        cached.push({ id: msg.id, seq: msg.seq, localId: msg.localId, content: msg.content, createdAt: msg.createdAt })
        this.sessionMessages.set(sessionId, cached.slice(-200))

        this.emit({
            type: 'message-received',
            sessionId,
            message: {
                id: msg.id,
                seq: msg.seq,
                localId: msg.localId,
                content: msg.content,
                createdAt: msg.createdAt
            }
        })
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan',
        allowTools?: string[],
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        answers?: Record<string, string[]>
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: true,
            mode,
            allowTools,
            decision,
            answers
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: false,
            decision
        })
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'abort', { reason: 'User aborted via Telegram Bot' })
    }

    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.sessionRpc(sessionId, 'switch', { to })
    }

    async setPermissionMode(
        sessionId: string,
        mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'read-only' | 'safe-yolo' | 'yolo'
    ): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (session) {
            session.permissionMode = mode
            this.emit({ type: 'session-updated', sessionId, data: session })
        }
    }

    async setModelMode(
        sessionId: string,
        model: 'default' | 'sonnet' | 'opus' | 'gpt-5.2-codex' | 'gpt-5.1-codex-max' | 'gpt-5.1-codex-mini' | 'gpt-5.2',
        modelReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
    ): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (session) {
            session.modelMode = model
            if (modelReasoningEffort !== undefined) {
                session.modelReasoningEffort = modelReasoningEffort
            }
            this.emit({ type: 'session-updated', sessionId, data: session })
        }
    }

    async applySessionConfig(
        sessionId: string,
        config: {
            permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'read-only' | 'safe-yolo' | 'yolo'
            modelMode?: 'default' | 'sonnet' | 'opus' | 'gpt-5.2-codex' | 'gpt-5.1-codex-max' | 'gpt-5.1-codex-mini' | 'gpt-5.2'
            modelReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
        }
    ): Promise<{
        permissionMode?: Session['permissionMode']
        modelMode?: Session['modelMode']
        modelReasoningEffort?: Session['modelReasoningEffort']
    }> {
        const result = await this.sessionRpc(sessionId, 'set-session-config', config)
        if (!result || typeof result !== 'object') {
            throw new Error('Invalid response from session config RPC')
        }
        const obj = result as { applied?: { permissionMode?: Session['permissionMode']; modelMode?: Session['modelMode']; modelReasoningEffort?: Session['modelReasoningEffort'] } }
        const applied = obj.applied
        if (!applied || typeof applied !== 'object') {
            throw new Error('Missing applied session config')
        }

        const session = this.sessions.get(sessionId) ?? this.refreshSession(sessionId)
        if (session) {
            if (applied.permissionMode !== undefined) {
                session.permissionMode = applied.permissionMode
            }
            if (applied.modelMode !== undefined) {
                session.modelMode = applied.modelMode
            }
            if (applied.modelReasoningEffort !== undefined) {
                session.modelReasoningEffort = applied.modelReasoningEffort
            }
            if (applied.modelMode === undefined && config.modelMode !== undefined) {
                session.modelMode = config.modelMode
            }
            if (applied.modelReasoningEffort === undefined && config.modelReasoningEffort !== undefined) {
                session.modelReasoningEffort = config.modelReasoningEffort
            }
            this.emit({ type: 'session-updated', sessionId, data: session })
            return {
                permissionMode: session.permissionMode,
                modelMode: session.modelMode,
                modelReasoningEffort: session.modelReasoningEffort
            }
        }
        return applied
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent: 'claude' | 'codex' | 'gemini' | 'glm' | 'minimax' | 'grok' | 'openrouter' | 'aider-cli' = 'claude',
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        options?: {
            sessionId?: string
            resumeSessionId?: string
            token?: string
            claudeAgent?: string
            openrouterModel?: string
            permissionMode?: Session['permissionMode']
            modelMode?: Session['modelMode']
            modelReasoningEffort?: Session['modelReasoningEffort']
        }
    ): Promise<{ type: 'success'; sessionId: string; logs?: unknown[] } | { type: 'error'; message: string; logs?: unknown[] }> {
        try {
            const result = await this.machineRpc(
                machineId,
                'spawn-happy-session',
                {
                    type: 'spawn-in-directory',
                    directory,
                    agent,
                    yolo,
                    sessionType,
                    worktreeName,
                    sessionId: options?.sessionId,
                    resumeSessionId: options?.resumeSessionId,
                    token: options?.token,
                    claudeAgent: options?.claudeAgent,
                    openrouterModel: options?.openrouterModel,
                    permissionMode: options?.permissionMode,
                    modelMode: options?.modelMode,
                    modelReasoningEffort: options?.modelReasoningEffort
                }
            )
            if (result && typeof result === 'object') {
                const obj = result as Record<string, unknown>
                const logs = Array.isArray(obj.logs) ? obj.logs : undefined
                if (obj.type === 'success' && typeof obj.sessionId === 'string') {
                    return { type: 'success', sessionId: obj.sessionId, logs }
                }
                if (obj.type === 'error' && typeof obj.errorMessage === 'string') {
                    return { type: 'error', message: obj.errorMessage, logs }
                }
            }
            return { type: 'error', message: 'Unexpected spawn result' }
        } catch (error) {
            return { type: 'error', message: error instanceof Error ? error.message : String(error) }
        }
    }

    async checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>> {
        const result = await this.machineRpc(machineId, 'path-exists', { paths }) as RpcPathExistsResponse | unknown
        if (!result || typeof result !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const existsValue = (result as RpcPathExistsResponse).exists
        if (!existsValue || typeof existsValue !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const exists: Record<string, boolean> = {}
        for (const [key, value] of Object.entries(existsValue)) {
            exists[key] = value === true
        }
        return exists
    }

    async getGitStatus(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-status', { cwd }) as RpcCommandResponse
    }

    async getGitDiffNumstat(sessionId: string, options: { cwd?: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-numstat', options) as RpcCommandResponse
    }

    async getGitDiffFile(sessionId: string, options: { cwd?: string; filePath: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-file', options) as RpcCommandResponse
    }

    async readSessionFile(sessionId: string, path: string): Promise<RpcReadFileResponse> {
        return await this.sessionRpc(sessionId, 'readFile', { path }) as RpcReadFileResponse
    }

    async runRipgrep(sessionId: string, args: string[], cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'ripgrep', { args, cwd }) as RpcCommandResponse
    }

    async uploadImage(sessionId: string, filename: string, content: string, mimeType: string): Promise<RpcWriteFileResponse> {
        return await this.sessionRpc(sessionId, 'uploadImage', { filename, content, mimeType }) as RpcWriteFileResponse
    }

    async listSlashCommands(sessionId: string, agent: string): Promise<{
        success: boolean
        commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' }>
        error?: string
    }> {
        return await this.sessionRpc(sessionId, 'listSlashCommands', { agent }) as {
            success: boolean
            commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' }>
            error?: string
        }
    }

    async getUsage(machineId: string): Promise<{
        claude: {
            fiveHour: { utilization: number; resetsAt: string } | null
            sevenDay: { utilization: number; resetsAt: string } | null
            error?: string
        } | null
        codex: {
            model?: string
            approvalPolicy?: string
            writableRoots?: string[]
            tokenUsage?: { used?: number; remaining?: number }
            error?: string
        } | null
        timestamp: number
    }> {
        return await this.machineRpc(machineId, 'get-usage', {}) as {
            claude: {
                fiveHour: { utilization: number; resetsAt: string } | null
                sevenDay: { utilization: number; resetsAt: string } | null
                error?: string
            } | null
            codex: {
                model?: string
                approvalPolicy?: string
                writableRoots?: string[]
                tokenUsage?: { used?: number; remaining?: number }
                error?: string
            } | null
            timestamp: number
        }
    }

    private async sessionRpc(sessionId: string, method: string, params: unknown): Promise<unknown> {
        return await this.rpcCall(`${sessionId}:${method}`, params)
    }

    private async machineRpc(machineId: string, method: string, params: unknown): Promise<unknown> {
        return await this.rpcCall(`${machineId}:${method}`, params)
    }

    private async rpcCall(method: string, params: unknown): Promise<unknown> {
        const socketId = this.rpcRegistry.getSocketIdForMethod(method)
        if (!socketId) {
            throw new Error(`RPC handler not registered: ${method}`)
        }

        const socket = this.io.of('/cli').sockets.get(socketId)
        if (!socket) {
            throw new Error(`RPC socket disconnected: ${method}`)
        }

        const response = await socket.timeout(30_000).emitWithAck('rpc-request', {
            method,
            params: JSON.stringify(params)
        }) as unknown

        if (typeof response !== 'string') {
            return response
        }

        try {
            return JSON.parse(response) as unknown
        } catch {
            return response
        }
    }
}
