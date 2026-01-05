// SQLite Store 实现 - 包装同步 API 为异步
// 保留原有的 Store 类实现，只做异步包装

import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IStore } from './interface'
import type {
    StoredSession,
    StoredMachine,
    StoredMessage,
    StoredUser,
    StoredPushSubscription,
    StoredAdvisorState,
    StoredAgentSessionState,
    StoredAgentMemory,
    StoredAgentSuggestion,
    StoredAgentFeedback,
    StoredAutoIterationConfig,
    StoredAutoIterationLog,
    StoredSessionAutoIterConfig,
    StoredAgentGroup,
    StoredAgentGroupWithLastMessage,
    StoredAgentGroupMember,
    StoredAgentGroupMessage,
    StoredSessionNotificationSubscription,
    StoredAIProfile,
    StoredAIProfileMemory,
    StoredAITeam,
    StoredAITeamMember,
    StoredAITeamKnowledge,
    StoredProject,
    StoredRolePrompt,
    StoredInputPreset,
    StoredAllowedEmail,
    UserRole,
    VersionedUpdateResult,
    SuggestionStatus,
    MemoryType,
    AgentGroupType,
    AgentGroupStatus,
    GroupMemberRole,
    GroupSenderType,
    GroupMessageType,
    AIProfileRole,
    AIProfileStatus,
    AIProfileMemoryType,
    AITeamStatus,
    AITeamMemberRole,
    AutoIterExecutionStatus,
    AdvisorStatus,
    SuggestionCategory,
    SuggestionSeverity,
    SuggestionScope,
    FeedbackSource,
    FeedbackAction,
    AutoIterActionType,
    AutoIterExecutionPolicy,
    AutoIterApprovalMethod,
    AutoIterNotificationLevel,
} from './types'

// ========== 数据库行类型定义 ==========

type DbSessionRow = {
    id: string
    tag: string | null
    namespace: string
    machine_id: string | null
    created_at: number
    updated_at: number
    metadata: string | null
    metadata_version: number
    agent_state: string | null
    agent_state_version: number
    todos: string | null
    todos_updated_at: number | null
    active: number
    active_at: number | null
    seq: number
    advisor_task_id: string | null
    creator_chat_id: string | null
    advisor_mode: number | null
    advisor_prompt_injected: number | null
    role_prompt_sent: number | null
}

type DbMachineRow = {
    id: string
    namespace: string
    created_at: number
    updated_at: number
    metadata: string | null
    metadata_version: number
    daemon_state: string | null
    daemon_state_version: number
    active: number
    active_at: number | null
    seq: number
}

type DbMessageRow = {
    id: string
    session_id: string
    content: string
    created_at: number
    seq: number
    local_id: string | null
}

type DbUserRow = {
    id: number
    platform: string
    platform_user_id: string
    namespace: string
    role: string
    created_at: number
}

type DbAdvisorStateRow = {
    namespace: string
    advisor_session_id: string | null
    machine_id: string | null
    status: string
    last_seen: number | null
    config_json: string | null
    updated_at: number
}

type DbAgentSessionStateRow = {
    session_id: string
    namespace: string
    last_seq: number
    summary: string | null
    context_json: string | null
    updated_at: number
}

type DbAgentMemoryRow = {
    id: number
    namespace: string
    type: string
    content_json: string
    source_ref: string | null
    confidence: number
    expires_at: number | null
    updated_at: number
}

type DbAgentSuggestionRow = {
    id: string
    namespace: string
    session_id: string | null
    source_session_id: string | null
    title: string
    detail: string | null
    category: string | null
    severity: string
    confidence: number
    status: string
    targets: string | null
    scope: string
    created_at: number
    updated_at: number
}

type DbAgentFeedbackRow = {
    id: number
    suggestion_id: string
    source: string
    user_id: string | null
    action: string
    evidence_json: string | null
    comment: string | null
    created_at: number
}

type DbAutoIterationConfigRow = {
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

type DbAutoIterationLogRow = {
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

type DbSessionAutoIterConfigRow = {
    session_id: string
    auto_iter_enabled: number
    updated_at: number
}

type DbAgentGroupRow = {
    id: string
    namespace: string
    name: string
    description: string | null
    type: string
    created_at: number
    updated_at: number
    status: string
}

type DbAgentGroupMemberRow = {
    group_id: string
    session_id: string
    role: string
    agent_type: string | null
    joined_at: number
}

type DbAgentGroupMessageRow = {
    id: string
    group_id: string
    source_session_id: string | null
    sender_type: string
    content: string
    message_type: string
    created_at: number
}

type DbAIProfileRow = {
    id: string
    namespace: string
    name: string
    role: string
    specialties: string | null
    personality: string | null
    greeting_template: string | null
    preferred_projects: string | null
    work_style: string | null
    avatar_emoji: string
    status: string
    stats_json: string | null
    created_at: number
    updated_at: number
}

type DbAIProfileMemoryRow = {
    id: string
    namespace: string
    profile_id: string
    memory_type: string
    content: string
    importance: number
    access_count: number
    last_accessed_at: number | null
    expires_at: number | null
    created_at: number
    updated_at: number
    metadata: string | null
}

type DbAITeamRow = {
    id: string
    namespace: string
    name: string
    description: string | null
    focus: string | null
    status: string
    config_json: string | null
    stats_json: string | null
    created_at: number
    updated_at: number
}

type DbAITeamMemberRow = {
    team_id: string
    profile_id: string
    role: string
    joined_at: number
    contribution: number
    specialization: string | null
}

type DbAITeamKnowledgeRow = {
    id: string
    team_id: string
    namespace: string
    title: string
    content: string
    category: string
    contributor_profile_id: string
    importance: number
    access_count: number
    created_at: number
    updated_at: number
}

type DbPushSubscriptionRow = {
    id: number
    namespace: string
    endpoint: string
    keys_p256dh: string
    keys_auth: string
    user_agent: string | null
    client_id: string | null
    chat_id: string | null
    created_at: number
    updated_at: number
}

type DbSessionNotificationSubscriptionRow = {
    id: number
    session_id: string
    chat_id: string | null
    client_id: string | null
    namespace: string
    subscribed_at: number
}

// ========== 辅助函数 ==========

function safeJsonParse(value: string | null): unknown | null {
    if (value === null) return null
    try {
        return JSON.parse(value) as unknown
    } catch {
        return null
    }
}

function toStoredSession(row: DbSessionRow): StoredSession {
    return {
        id: row.id,
        tag: row.tag,
        namespace: row.namespace,
        machineId: row.machine_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: safeJsonParse(row.metadata),
        metadataVersion: row.metadata_version,
        agentState: safeJsonParse(row.agent_state),
        agentStateVersion: row.agent_state_version,
        todos: safeJsonParse(row.todos),
        todosUpdatedAt: row.todos_updated_at,
        active: row.active === 1,
        activeAt: row.active_at,
        seq: row.seq,
        advisorTaskId: row.advisor_task_id,
        creatorChatId: row.creator_chat_id,
        advisorMode: row.advisor_mode === 1,
        advisorPromptInjected: row.advisor_prompt_injected === 1,
        rolePromptSent: row.role_prompt_sent === 1
    }
}

function toStoredMachine(row: DbMachineRow): StoredMachine {
    return {
        id: row.id,
        namespace: row.namespace,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: safeJsonParse(row.metadata),
        metadataVersion: row.metadata_version,
        daemonState: safeJsonParse(row.daemon_state),
        daemonStateVersion: row.daemon_state_version,
        active: row.active === 1,
        activeAt: row.active_at,
        seq: row.seq
    }
}

function toStoredMessage(row: DbMessageRow): StoredMessage {
    return {
        id: row.id,
        sessionId: row.session_id,
        content: safeJsonParse(row.content),
        createdAt: row.created_at,
        seq: row.seq,
        localId: row.local_id
    }
}

function toStoredUser(row: DbUserRow): StoredUser {
    return {
        id: row.id,
        platform: row.platform,
        platformUserId: row.platform_user_id,
        namespace: row.namespace,
        role: (row.role === 'operator' ? 'operator' : 'developer') as UserRole,
        createdAt: row.created_at
    }
}

function toStoredAdvisorState(row: DbAdvisorStateRow): StoredAdvisorState {
    return {
        namespace: row.namespace,
        advisorSessionId: row.advisor_session_id,
        machineId: row.machine_id,
        status: (row.status as AdvisorStatus) || 'idle',
        lastSeen: row.last_seen,
        configJson: safeJsonParse(row.config_json),
        updatedAt: row.updated_at
    }
}

function toStoredAgentSessionState(row: DbAgentSessionStateRow): StoredAgentSessionState {
    return {
        sessionId: row.session_id,
        namespace: row.namespace,
        lastSeq: row.last_seq,
        summary: row.summary,
        contextJson: safeJsonParse(row.context_json),
        updatedAt: row.updated_at
    }
}

function toStoredAgentMemory(row: DbAgentMemoryRow): StoredAgentMemory {
    return {
        id: row.id,
        namespace: row.namespace,
        type: (row.type as MemoryType) || 'insight',
        contentJson: safeJsonParse(row.content_json),
        sourceRef: row.source_ref,
        confidence: row.confidence,
        expiresAt: row.expires_at,
        updatedAt: row.updated_at
    }
}

function toStoredAgentSuggestion(row: DbAgentSuggestionRow): StoredAgentSuggestion {
    return {
        id: row.id,
        namespace: row.namespace,
        sessionId: row.session_id,
        sourceSessionId: row.source_session_id,
        title: row.title,
        detail: row.detail,
        category: (row.category as SuggestionCategory) || null,
        severity: (row.severity as SuggestionSeverity) || 'low',
        confidence: row.confidence,
        status: (row.status as SuggestionStatus) || 'pending',
        targets: row.targets,
        scope: (row.scope as SuggestionScope) || 'session',
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function toStoredAgentFeedback(row: DbAgentFeedbackRow): StoredAgentFeedback {
    return {
        id: row.id,
        suggestionId: row.suggestion_id,
        source: (row.source as FeedbackSource) || 'auto',
        userId: row.user_id,
        action: (row.action as FeedbackAction) || 'accept',
        evidenceJson: safeJsonParse(row.evidence_json),
        comment: row.comment,
        createdAt: row.created_at
    }
}

function toStoredAutoIterationConfig(row: DbAutoIterationConfigRow): StoredAutoIterationConfig {
    return {
        namespace: row.namespace,
        enabled: row.enabled === 1,
        policyJson: safeJsonParse(row.policy_json) as Partial<Record<AutoIterActionType, AutoIterExecutionPolicy>> | null,
        allowedProjects: safeJsonParse(row.allowed_projects) as string[] || [],
        notificationLevel: (row.notification_level as AutoIterNotificationLevel) || 'all',
        keepLogsDays: row.keep_logs_days,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by
    }
}

function toStoredAutoIterationLog(row: DbAutoIterationLogRow): StoredAutoIterationLog {
    return {
        id: row.id,
        namespace: row.namespace,
        sourceSuggestionId: row.source_suggestion_id,
        sourceSessionId: row.source_session_id,
        projectPath: row.project_path,
        actionType: row.action_type as AutoIterActionType,
        actionDetail: safeJsonParse(row.action_detail),
        reason: row.reason,
        executionStatus: (row.execution_status as AutoIterExecutionStatus) || 'pending',
        approvalMethod: row.approval_method as AutoIterApprovalMethod | null,
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
        resultJson: safeJsonParse(row.result_json),
        errorMessage: row.error_message,
        rollbackAvailable: row.rollback_available === 1,
        rollbackData: safeJsonParse(row.rollback_data),
        rolledBack: row.rolled_back === 1,
        rolledBackAt: row.rolled_back_at,
        createdAt: row.created_at,
        executedAt: row.executed_at
    }
}

function toStoredSessionAutoIterConfig(row: DbSessionAutoIterConfigRow): StoredSessionAutoIterConfig {
    return {
        sessionId: row.session_id,
        autoIterEnabled: row.auto_iter_enabled === 1,
        updatedAt: row.updated_at
    }
}

function toStoredAgentGroup(row: DbAgentGroupRow): StoredAgentGroup {
    return {
        id: row.id,
        namespace: row.namespace,
        name: row.name,
        description: row.description,
        type: (row.type as AgentGroupType) || 'collaboration',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        status: (row.status as AgentGroupStatus) || 'active'
    }
}

function toStoredAgentGroupMember(row: DbAgentGroupMemberRow): StoredAgentGroupMember {
    return {
        groupId: row.group_id,
        sessionId: row.session_id,
        role: (row.role as GroupMemberRole) || 'member',
        agentType: row.agent_type,
        joinedAt: row.joined_at
    }
}

function toStoredAgentGroupMessage(row: DbAgentGroupMessageRow): StoredAgentGroupMessage {
    return {
        id: row.id,
        groupId: row.group_id,
        sourceSessionId: row.source_session_id,
        senderType: (row.sender_type as GroupSenderType) || 'agent',
        content: row.content,
        messageType: (row.message_type as GroupMessageType) || 'chat',
        createdAt: row.created_at
    }
}

function toStoredAIProfile(row: DbAIProfileRow): StoredAIProfile {
    const stats = safeJsonParse(row.stats_json) as { tasksCompleted?: number; activeMinutes?: number; lastActiveAt?: number | null } | null
    return {
        id: row.id,
        namespace: row.namespace,
        name: row.name,
        role: (row.role as AIProfileRole) || 'developer',
        specialties: (safeJsonParse(row.specialties) as string[]) || [],
        personality: row.personality,
        greetingTemplate: row.greeting_template,
        preferredProjects: (safeJsonParse(row.preferred_projects) as string[]) || [],
        workStyle: row.work_style,
        avatarEmoji: row.avatar_emoji || '🤖',
        status: (row.status as AIProfileStatus) || 'idle',
        stats: {
            tasksCompleted: stats?.tasksCompleted ?? 0,
            activeMinutes: stats?.activeMinutes ?? 0,
            lastActiveAt: stats?.lastActiveAt ?? null
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function toStoredAIProfileMemory(row: DbAIProfileMemoryRow): StoredAIProfileMemory {
    return {
        id: row.id,
        namespace: row.namespace,
        profileId: row.profile_id,
        memoryType: (row.memory_type as AIProfileMemoryType) || 'context',
        content: row.content,
        importance: row.importance,
        accessCount: row.access_count,
        lastAccessedAt: row.last_accessed_at,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: safeJsonParse(row.metadata)
    }
}

function toStoredAITeam(row: DbAITeamRow): StoredAITeam {
    const config = safeJsonParse(row.config_json) as StoredAITeam['config'] | null
    const stats = safeJsonParse(row.stats_json) as StoredAITeam['stats'] | null
    return {
        id: row.id,
        namespace: row.namespace,
        name: row.name,
        description: row.description,
        focus: row.focus,
        status: (row.status as AITeamStatus) || 'active',
        config: {
            maxMembers: config?.maxMembers ?? 10,
            autoAssign: config?.autoAssign ?? true,
            sharedKnowledge: config?.sharedKnowledge ?? true
        },
        stats: {
            tasksCompleted: stats?.tasksCompleted ?? 0,
            activeHours: stats?.activeHours ?? 0,
            collaborationScore: stats?.collaborationScore ?? 50
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function toStoredAITeamMember(row: DbAITeamMemberRow): StoredAITeamMember {
    return {
        teamId: row.team_id,
        profileId: row.profile_id,
        role: (row.role as AITeamMemberRole) || 'member',
        joinedAt: row.joined_at,
        contribution: row.contribution,
        specialization: row.specialization
    }
}

function toStoredAITeamKnowledge(row: DbAITeamKnowledgeRow): StoredAITeamKnowledge {
    return {
        id: row.id,
        teamId: row.team_id,
        namespace: row.namespace,
        title: row.title,
        content: row.content,
        category: row.category as StoredAITeamKnowledge['category'],
        contributorProfileId: row.contributor_profile_id,
        importance: row.importance,
        accessCount: row.access_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function toStoredPushSubscription(row: DbPushSubscriptionRow): StoredPushSubscription {
    return {
        id: row.id,
        namespace: row.namespace,
        endpoint: row.endpoint,
        keys: {
            p256dh: row.keys_p256dh,
            auth: row.keys_auth
        },
        userAgent: row.user_agent,
        clientId: row.client_id,
        chatId: row.chat_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function toStoredSessionNotificationSubscription(row: DbSessionNotificationSubscriptionRow): StoredSessionNotificationSubscription {
    return {
        id: row.id,
        sessionId: row.session_id,
        chatId: row.chat_id,
        clientId: row.client_id,
        namespace: row.namespace,
        subscribedAt: row.subscribed_at
    }
}

// ========== SQLite Store 实现 ==========
// 由于代码量太大，这里导入原有的 Store 类并包装为异步接口
// 实际实现保留在 index.ts 中，这里只做类型适配

import { Store as SyncStore } from './index'

export class SqliteStore implements IStore {
    private store: SyncStore

    constructor(dbPath: string) {
        this.store = new SyncStore(dbPath)
    }

    // 获取底层同步 Store（用于迁移等场景）
    getSyncStore(): SyncStore {
        return this.store
    }

    // === Session 操作 ===
    async getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string): Promise<StoredSession> {
        return this.store.getOrCreateSession(tag, metadata, agentState, namespace)
    }

    async updateSessionMetadata(id: string, metadata: unknown, expectedVersion: number, namespace: string): Promise<VersionedUpdateResult<unknown | null>> {
        return this.store.updateSessionMetadata(id, metadata, expectedVersion, namespace)
    }

    async updateSessionAgentState(id: string, agentState: unknown, expectedVersion: number, namespace: string): Promise<VersionedUpdateResult<unknown | null>> {
        return this.store.updateSessionAgentState(id, agentState, expectedVersion, namespace)
    }

    async setSessionTodos(id: string, todos: unknown, todosUpdatedAt: number, namespace: string): Promise<boolean> {
        return this.store.setSessionTodos(id, todos, todosUpdatedAt, namespace)
    }

    async setSessionAdvisorTaskId(id: string, advisorTaskId: string, namespace: string): Promise<boolean> {
        return this.store.setSessionAdvisorTaskId(id, advisorTaskId, namespace)
    }

    async setSessionAdvisorMode(id: string, advisorMode: boolean, namespace: string): Promise<boolean> {
        return this.store.setSessionAdvisorMode(id, advisorMode, namespace)
    }

    async setSessionAdvisorPromptInjected(id: string, namespace: string): Promise<boolean> {
        return this.store.setSessionAdvisorPromptInjected(id, namespace)
    }

    async shouldInjectAdvisorPrompt(id: string): Promise<boolean> {
        return this.store.shouldInjectAdvisorPrompt(id)
    }

    async isRolePromptSent(id: string): Promise<boolean> {
        return this.store.isRolePromptSent(id)
    }

    async setSessionRolePromptSent(id: string, namespace: string): Promise<boolean> {
        return this.store.setSessionRolePromptSent(id, namespace)
    }

    async getSession(id: string): Promise<StoredSession | null> {
        return this.store.getSession(id)
    }

    async getSessionByNamespace(id: string, namespace: string): Promise<StoredSession | null> {
        return this.store.getSessionByNamespace(id, namespace)
    }

    async getSessions(): Promise<StoredSession[]> {
        return this.store.getSessions()
    }

    async getSessionsByNamespace(namespace: string): Promise<StoredSession[]> {
        return this.store.getSessionsByNamespace(namespace)
    }

    async deleteSession(id: string): Promise<boolean> {
        return this.store.deleteSession(id)
    }

    // === Machine 操作 ===
    async getOrCreateMachine(id: string, metadata: unknown, daemonState: unknown, namespace: string): Promise<StoredMachine> {
        return this.store.getOrCreateMachine(id, metadata, daemonState, namespace)
    }

    async updateMachineMetadata(id: string, metadata: unknown, expectedVersion: number, namespace: string): Promise<VersionedUpdateResult<unknown | null>> {
        return this.store.updateMachineMetadata(id, metadata, expectedVersion, namespace)
    }

    async updateMachineDaemonState(id: string, daemonState: unknown, expectedVersion: number, namespace: string): Promise<VersionedUpdateResult<unknown | null>> {
        return this.store.updateMachineDaemonState(id, daemonState, expectedVersion, namespace)
    }

    async getMachine(id: string): Promise<StoredMachine | null> {
        return this.store.getMachine(id)
    }

    async getMachineByNamespace(id: string, namespace: string): Promise<StoredMachine | null> {
        return this.store.getMachineByNamespace(id, namespace)
    }

    async getMachines(): Promise<StoredMachine[]> {
        return this.store.getMachines()
    }

    async getMachinesByNamespace(namespace: string): Promise<StoredMachine[]> {
        return this.store.getMachinesByNamespace(namespace)
    }

    // === Message 操作 ===
    async addMessage(sessionId: string, content: unknown, localId?: string): Promise<StoredMessage> {
        return this.store.addMessage(sessionId, content, localId)
    }

    async getMessages(sessionId: string, limit: number = 200, beforeSeq?: number): Promise<StoredMessage[]> {
        return this.store.getMessages(sessionId, limit, beforeSeq)
    }

    async getMessagesAfter(sessionId: string, afterSeq: number, limit: number = 200): Promise<StoredMessage[]> {
        return this.store.getMessagesAfter(sessionId, afterSeq, limit)
    }

    async getMessageCount(sessionId: string): Promise<number> {
        return this.store.getMessageCount(sessionId)
    }

    async clearMessages(sessionId: string, keepCount: number = 30): Promise<{ deleted: number; remaining: number }> {
        return this.store.clearMessages(sessionId, keepCount)
    }

    // === User 操作 ===
    async getUser(platform: string, platformUserId: string): Promise<StoredUser | null> {
        return this.store.getUser(platform, platformUserId)
    }

    async getUsersByPlatform(platform: string): Promise<StoredUser[]> {
        return this.store.getUsersByPlatform(platform)
    }

    async getUsersByPlatformAndNamespace(platform: string, namespace: string): Promise<StoredUser[]> {
        return this.store.getUsersByPlatformAndNamespace(platform, namespace)
    }

    async addUser(platform: string, platformUserId: string, namespace: string, role: UserRole = 'developer'): Promise<StoredUser> {
        return this.store.addUser(platform, platformUserId, namespace, role)
    }

    async updateUserRole(platform: string, platformUserId: string, role: UserRole): Promise<boolean> {
        return this.store.updateUserRole(platform, platformUserId, role)
    }

    async removeUser(platform: string, platformUserId: string): Promise<boolean> {
        return this.store.removeUser(platform, platformUserId)
    }

    // === Email 白名单 ===
    async getAllowedEmails(): Promise<string[]> {
        return this.store.getAllowedEmails()
    }

    async getAllowedUsers(): Promise<StoredAllowedEmail[]> {
        return this.store.getAllowedUsers()
    }

    async addAllowedEmail(email: string, role: UserRole = 'developer'): Promise<boolean> {
        return this.store.addAllowedEmail(email, role)
    }

    async updateAllowedEmailRole(email: string, role: UserRole): Promise<boolean> {
        return this.store.updateAllowedEmailRole(email, role)
    }

    async removeAllowedEmail(email: string): Promise<boolean> {
        return this.store.removeAllowedEmail(email)
    }

    async isEmailAllowed(email: string): Promise<boolean> {
        return this.store.isEmailAllowed(email)
    }

    async getEmailRole(email: string): Promise<UserRole | null> {
        return this.store.getEmailRole(email)
    }

    // === Project 操作 ===
    async getProjects(): Promise<StoredProject[]> {
        return this.store.getProjects()
    }

    async getProject(id: string): Promise<StoredProject | null> {
        return this.store.getProject(id)
    }

    async addProject(name: string, path: string, description?: string): Promise<StoredProject | null> {
        return this.store.addProject(name, path, description)
    }

    async updateProject(id: string, name: string, path: string, description?: string): Promise<StoredProject | null> {
        return this.store.updateProject(id, name, path, description)
    }

    async removeProject(id: string): Promise<boolean> {
        return this.store.removeProject(id)
    }

    // === Role Prompt 操作 ===
    async getRolePrompt(role: UserRole): Promise<string | null> {
        return this.store.getRolePrompt(role)
    }

    async getAllRolePrompts(): Promise<StoredRolePrompt[]> {
        return this.store.getAllRolePrompts()
    }

    async setRolePrompt(role: UserRole, prompt: string): Promise<boolean> {
        return this.store.setRolePrompt(role, prompt)
    }

    async removeRolePrompt(role: UserRole): Promise<boolean> {
        return this.store.removeRolePrompt(role)
    }

    // === Push Subscription 操作 ===
    async getPushSubscriptions(namespace: string): Promise<StoredPushSubscription[]> {
        return this.store.getPushSubscriptions(namespace)
    }

    async getPushSubscriptionsByClientId(namespace: string, clientId: string): Promise<StoredPushSubscription[]> {
        return this.store.getPushSubscriptionsByClientId(namespace, clientId)
    }

    async getPushSubscriptionsByChatId(namespace: string, chatId: string): Promise<StoredPushSubscription[]> {
        return this.store.getPushSubscriptionsByChatId(namespace, chatId)
    }

    async getPushSubscriptionByEndpoint(endpoint: string): Promise<StoredPushSubscription | null> {
        return this.store.getPushSubscriptionByEndpoint(endpoint)
    }

    async addOrUpdatePushSubscription(data: {
        namespace: string
        endpoint: string
        keys: { p256dh: string; auth: string }
        userAgent?: string
        clientId?: string
        chatId?: string
    }): Promise<StoredPushSubscription | null> {
        return this.store.addOrUpdatePushSubscription(
            data.namespace,
            data.endpoint,
            data.keys,
            data.userAgent,
            data.clientId,
            data.chatId
        )
    }

    async removePushSubscription(endpoint: string): Promise<boolean> {
        return this.store.removePushSubscription(endpoint)
    }

    async removePushSubscriptionById(id: number): Promise<boolean> {
        return this.store.removePushSubscriptionById(id)
    }

    // === Input Preset 操作 ===
    async getAllInputPresets(): Promise<StoredInputPreset[]> {
        return this.store.getAllInputPresets()
    }

    async getInputPreset(id: string): Promise<StoredInputPreset | null> {
        return this.store.getInputPreset(id)
    }

    async addInputPreset(trigger: string, title: string, prompt: string): Promise<StoredInputPreset | null> {
        return this.store.addInputPreset(trigger, title, prompt)
    }

    async updateInputPreset(id: string, trigger: string, title: string, prompt: string): Promise<StoredInputPreset | null> {
        return this.store.updateInputPreset(id, trigger, title, prompt)
    }

    async removeInputPreset(id: string): Promise<boolean> {
        return this.store.removeInputPreset(id)
    }

    // === Advisor State 操作 ===
    async getAdvisorState(namespace: string): Promise<StoredAdvisorState | null> {
        return this.store.getAdvisorState(namespace)
    }

    async upsertAdvisorState(namespace: string, data: Partial<Omit<StoredAdvisorState, 'namespace' | 'updatedAt'>>): Promise<StoredAdvisorState | null> {
        return this.store.upsertAdvisorState(namespace, data)
    }

    // === Agent Session State 操作 ===
    async getAgentSessionState(sessionId: string): Promise<StoredAgentSessionState | null> {
        return this.store.getAgentSessionState(sessionId)
    }

    async getAgentSessionStatesByNamespace(namespace: string): Promise<StoredAgentSessionState[]> {
        return this.store.getAgentSessionStatesByNamespace(namespace)
    }

    async upsertAgentSessionState(sessionId: string, namespace: string, data: Partial<Omit<StoredAgentSessionState, 'sessionId' | 'namespace' | 'updatedAt'>>): Promise<StoredAgentSessionState | null> {
        return this.store.upsertAgentSessionState(sessionId, namespace, data)
    }

    async deleteAgentSessionState(sessionId: string): Promise<boolean> {
        return this.store.deleteAgentSessionState(sessionId)
    }

    // === Agent Memory 操作 ===
    async createAgentMemory(data: {
        namespace: string
        type: MemoryType
        contentJson: unknown
        sourceRef?: string
        confidence?: number
        expiresAt?: number
    }): Promise<StoredAgentMemory | null> {
        return this.store.createAgentMemory(data)
    }

    async getAgentMemory(id: number): Promise<StoredAgentMemory | null> {
        return this.store.getAgentMemory(id)
    }

    async getAgentMemories(namespace: string, type?: MemoryType, limit: number = 100): Promise<StoredAgentMemory[]> {
        return this.store.getAgentMemories(namespace, type, limit)
    }

    async deleteAgentMemory(id: number): Promise<boolean> {
        return this.store.deleteAgentMemory(id)
    }

    async deleteExpiredAgentMemories(namespace: string): Promise<number> {
        return this.store.deleteExpiredAgentMemories(namespace)
    }

    // === Agent Suggestion 操作 ===
    async createAgentSuggestion(data: {
        namespace: string
        sessionId?: string
        sourceSessionId?: string
        title: string
        detail?: string
        category?: SuggestionCategory
        severity?: SuggestionSeverity
        confidence?: number
        targets?: string
        scope?: SuggestionScope
    }): Promise<StoredAgentSuggestion | null> {
        return this.store.createAgentSuggestion({
            id: randomUUID(),
            namespace: data.namespace,
            sessionId: data.sessionId,
            sourceSessionId: data.sourceSessionId,
            title: data.title,
            detail: data.detail,
            category: data.category,
            severity: data.severity,
            confidence: data.confidence,
            targets: data.targets ? [data.targets] : undefined,
            scope: data.scope
        })
    }

    async getAgentSuggestion(id: string): Promise<StoredAgentSuggestion | null> {
        return this.store.getAgentSuggestion(id)
    }

    async getAgentSuggestions(namespace: string, filters?: {
        status?: SuggestionStatus | SuggestionStatus[]
        sessionId?: string
        sourceSessionId?: string
        limit?: number
    }): Promise<StoredAgentSuggestion[]> {
        return this.store.getAgentSuggestions(namespace, filters)
    }

    async updateAgentSuggestionStatus(id: string, status: SuggestionStatus): Promise<boolean> {
        return this.store.updateAgentSuggestionStatus(id, status)
    }

    async deleteAgentSuggestion(id: string): Promise<boolean> {
        return this.store.deleteAgentSuggestion(id)
    }

    // === Agent Feedback 操作 ===
    async createAgentFeedback(data: {
        suggestionId: string
        source: FeedbackSource
        userId?: string
        action: FeedbackAction
        evidenceJson?: unknown
        comment?: string
    }): Promise<StoredAgentFeedback | null> {
        return this.store.createAgentFeedback(data)
    }

    async getAgentFeedback(id: number): Promise<StoredAgentFeedback | null> {
        return this.store.getAgentFeedback(id)
    }

    async getAgentFeedbackBySuggestion(suggestionId: string): Promise<StoredAgentFeedback[]> {
        return this.store.getAgentFeedbackBySuggestion(suggestionId)
    }

    // === Auto-Iteration 操作 ===
    async getAutoIterationConfig(namespace: string): Promise<StoredAutoIterationConfig | null> {
        return this.store.getAutoIterationConfig(namespace)
    }

    async upsertAutoIterationConfig(namespace: string, data: {
        enabled?: boolean
        policyJson?: Partial<Record<AutoIterActionType, AutoIterExecutionPolicy>>
        allowedProjects?: string[]
        notificationLevel?: AutoIterNotificationLevel
        keepLogsDays?: number
        updatedBy?: string
    }): Promise<StoredAutoIterationConfig | null> {
        return this.store.upsertAutoIterationConfig(namespace, data)
    }

    async createAutoIterationLog(data: {
        namespace: string
        sourceSuggestionId?: string
        sourceSessionId?: string
        projectPath?: string
        actionType: AutoIterActionType
        actionDetail?: unknown
        reason?: string
    }): Promise<StoredAutoIterationLog | null> {
        return this.store.createAutoIterationLog({
            id: randomUUID(),
            namespace: data.namespace,
            sourceSuggestionId: data.sourceSuggestionId,
            sourceSessionId: data.sourceSessionId,
            projectPath: data.projectPath,
            actionType: data.actionType,
            actionDetail: data.actionDetail,
            reason: data.reason
        })
    }

    async getAutoIterationLog(id: string): Promise<StoredAutoIterationLog | null> {
        return this.store.getAutoIterationLog(id)
    }

    async getAutoIterationLogs(namespace: string, filters?: {
        status?: AutoIterExecutionStatus | AutoIterExecutionStatus[]
        projectPath?: string
        limit?: number
        offset?: number
    }): Promise<StoredAutoIterationLog[]> {
        return this.store.getAutoIterationLogs(namespace, filters)
    }

    async updateAutoIterationLog(id: string, data: {
        executionStatus?: AutoIterExecutionStatus
        approvalMethod?: AutoIterApprovalMethod
        approvedBy?: string
        approvedAt?: number
        resultJson?: unknown
        errorMessage?: string
        rollbackAvailable?: boolean
        rollbackData?: unknown
        rolledBack?: boolean
        rolledBackAt?: number
        executedAt?: number
    }): Promise<boolean> {
        return this.store.updateAutoIterationLog(id, data)
    }

    async deleteAutoIterationLog(id: string): Promise<boolean> {
        return this.store.deleteAutoIterationLog(id)
    }

    async cleanupOldAutoIterationLogs(namespace: string, keepDays: number): Promise<number> {
        return this.store.cleanupOldAutoIterationLogs(namespace, keepDays)
    }

    async getSessionAutoIterConfig(sessionId: string): Promise<StoredSessionAutoIterConfig | null> {
        return this.store.getSessionAutoIterConfig(sessionId)
    }

    async isSessionAutoIterEnabled(sessionId: string): Promise<boolean> {
        return this.store.isSessionAutoIterEnabled(sessionId)
    }

    async setSessionAutoIterEnabled(sessionId: string, enabled: boolean): Promise<StoredSessionAutoIterConfig | null> {
        return this.store.setSessionAutoIterEnabled(sessionId, enabled)
    }

    // === Agent Group 操作 ===
    async createAgentGroup(data: {
        namespace: string
        name: string
        description?: string
        type?: AgentGroupType
    }): Promise<StoredAgentGroup> {
        return this.store.createAgentGroup(
            data.namespace,
            data.name,
            data.type ?? 'collaboration',
            data.description
        )
    }

    async getAgentGroup(id: string): Promise<StoredAgentGroup | null> {
        return this.store.getAgentGroup(id)
    }

    async getAgentGroups(namespace: string): Promise<StoredAgentGroup[]> {
        return this.store.getAgentGroups(namespace)
    }

    async getAgentGroupsWithLastMessage(namespace: string): Promise<StoredAgentGroupWithLastMessage[]> {
        return this.store.getAgentGroupsWithLastMessage(namespace)
    }

    async updateAgentGroupStatus(id: string, status: AgentGroupStatus): Promise<void> {
        this.store.updateAgentGroupStatus(id, status)
    }

    async deleteAgentGroup(id: string): Promise<void> {
        this.store.deleteAgentGroup(id)
    }

    async addGroupMember(data: {
        groupId: string
        sessionId: string
        role?: GroupMemberRole
        agentType?: string
    }): Promise<StoredAgentGroupMember> {
        this.store.addGroupMember(
            data.groupId,
            data.sessionId,
            data.role ?? 'member',
            data.agentType
        )
        // 原始方法返回 void，我们构造返回值
        return {
            groupId: data.groupId,
            sessionId: data.sessionId,
            role: data.role ?? 'member',
            agentType: data.agentType ?? null,
            joinedAt: Date.now()
        }
    }

    async removeGroupMember(groupId: string, sessionId: string): Promise<void> {
        this.store.removeGroupMember(groupId, sessionId)
    }

    async getGroupMembers(groupId: string): Promise<StoredAgentGroupMember[]> {
        return this.store.getGroupMembers(groupId)
    }

    async getSessionGroups(sessionId: string): Promise<StoredAgentGroup[]> {
        return this.store.getSessionGroups(sessionId)
    }

    async getGroupsForSession(sessionId: string): Promise<StoredAgentGroup[]> {
        return this.store.getGroupsForSession(sessionId)
    }

    async addGroupMessage(data: {
        groupId: string
        sourceSessionId?: string
        senderType?: GroupSenderType
        content: string
        messageType?: GroupMessageType
    }): Promise<StoredAgentGroupMessage> {
        return this.store.addGroupMessage(
            data.groupId,
            data.sourceSessionId ?? null,
            data.content,
            data.senderType ?? 'agent',
            data.messageType ?? 'chat'
        )
    }

    async getGroupMessages(groupId: string, limit: number = 100, beforeId?: string): Promise<StoredAgentGroupMessage[]> {
        return this.store.getGroupMessages(groupId, limit, beforeId)
    }

    // === Session Creator ChatId 操作 ===
    async setSessionCreatorChatId(sessionId: string, chatId: string, namespace: string): Promise<boolean> {
        return this.store.setSessionCreatorChatId(sessionId, chatId, namespace)
    }

    async getSessionCreatorChatId(sessionId: string): Promise<string | null> {
        return this.store.getSessionCreatorChatId(sessionId)
    }

    async clearSessionCreatorChatId(sessionId: string, namespace: string): Promise<boolean> {
        return this.store.clearSessionCreatorChatId(sessionId, namespace)
    }

    // === Session Notification Subscription 操作 ===
    async subscribeToSessionNotifications(sessionId: string, chatId: string, namespace: string): Promise<StoredSessionNotificationSubscription | null> {
        return this.store.subscribeToSessionNotifications(sessionId, chatId, namespace)
    }

    async subscribeToSessionNotificationsByClientId(sessionId: string, clientId: string, namespace: string): Promise<StoredSessionNotificationSubscription | null> {
        return this.store.subscribeToSessionNotificationsByClientId(sessionId, clientId, namespace)
    }

    async unsubscribeFromSessionNotifications(sessionId: string, chatId: string): Promise<boolean> {
        return this.store.unsubscribeFromSessionNotifications(sessionId, chatId)
    }

    async unsubscribeFromSessionNotificationsByClientId(sessionId: string, clientId: string): Promise<boolean> {
        return this.store.unsubscribeFromSessionNotificationsByClientId(sessionId, clientId)
    }

    async getSessionNotificationSubscription(sessionId: string, chatId: string): Promise<StoredSessionNotificationSubscription | null> {
        return this.store.getSessionNotificationSubscription(sessionId, chatId)
    }

    async getSessionNotificationSubscriptionByClientId(sessionId: string, clientId: string): Promise<StoredSessionNotificationSubscription | null> {
        return this.store.getSessionNotificationSubscriptionByClientId(sessionId, clientId)
    }

    async getSessionNotificationSubscribers(sessionId: string): Promise<string[]> {
        return this.store.getSessionNotificationSubscribers(sessionId)
    }

    async getSessionNotificationSubscriberClientIds(sessionId: string): Promise<string[]> {
        return this.store.getSessionNotificationSubscriberClientIds(sessionId)
    }

    async getSubscribedSessionsForChat(chatId: string): Promise<string[]> {
        return this.store.getSubscribedSessionsForChat(chatId)
    }

    async getSubscribedSessionsForClient(clientId: string): Promise<string[]> {
        return this.store.getSubscribedSessionsForClient(clientId)
    }

    async getSessionNotificationRecipients(sessionId: string): Promise<string[]> {
        return this.store.getSessionNotificationRecipients(sessionId)
    }

    async getSessionNotificationRecipientClientIds(sessionId: string): Promise<string[]> {
        return this.store.getSessionNotificationRecipientClientIds(sessionId)
    }

    // === AI Profile 操作 ===
    async getAIProfiles(namespace: string): Promise<StoredAIProfile[]> {
        return this.store.getAIProfiles(namespace)
    }

    async getAIProfile(id: string): Promise<StoredAIProfile | null> {
        return this.store.getAIProfile(id)
    }

    async getAIProfileByName(namespace: string, name: string): Promise<StoredAIProfile | null> {
        return this.store.getAIProfileByName(namespace, name)
    }

    async createAIProfile(data: {
        namespace: string
        name: string
        role: AIProfileRole
        specialties?: string[]
        personality?: string | null
        greetingTemplate?: string | null
        preferredProjects?: string[]
        workStyle?: string | null
        avatarEmoji?: string
    }): Promise<StoredAIProfile | null> {
        return this.store.createAIProfile(data.namespace, {
            name: data.name,
            role: data.role,
            specialties: data.specialties ?? [],
            personality: data.personality ?? null,
            greetingTemplate: data.greetingTemplate ?? null,
            preferredProjects: data.preferredProjects ?? [],
            workStyle: data.workStyle ?? null,
            avatarEmoji: data.avatarEmoji ?? '🤖',
            status: 'idle',
            stats: { tasksCompleted: 0, activeMinutes: 0, lastActiveAt: null }
        })
    }

    async updateAIProfile(id: string, data: Partial<StoredAIProfile>): Promise<StoredAIProfile | null> {
        return this.store.updateAIProfile(id, data)
    }

    async deleteAIProfile(id: string): Promise<boolean> {
        return this.store.deleteAIProfile(id)
    }

    async updateAIProfileStatus(id: string, status: AIProfileStatus): Promise<void> {
        this.store.updateAIProfileStatus(id, status)
    }

    async updateAIProfileStats(id: string, stats: Partial<StoredAIProfile['stats']>): Promise<void> {
        this.store.updateAIProfileStats(id, stats)
    }

    // === AI Profile Memory 操作 ===
    async createProfileMemory(data: {
        namespace: string
        profileId: string
        memoryType: AIProfileMemoryType
        content: string
        importance?: number
        expiresAt?: number | null
        metadata?: unknown | null
    }): Promise<StoredAIProfileMemory | null> {
        return this.store.createProfileMemory(data.namespace, data.profileId, {
            memoryType: data.memoryType,
            content: data.content,
            importance: data.importance,
            expiresAt: data.expiresAt,
            metadata: data.metadata
        })
    }

    async getProfileMemories(options: {
        namespace: string
        profileId?: string
        memoryType?: AIProfileMemoryType
        minImportance?: number
        limit?: number
        includeExpired?: boolean
    }): Promise<StoredAIProfileMemory[]> {
        // 原始方法需要 profileId 作为必填参数
        if (!options.profileId) {
            return []
        }
        return this.store.getProfileMemories(options.namespace, options.profileId, {
            type: options.memoryType,
            limit: options.limit,
            minImportance: options.minImportance
        })
    }

    async getProfileMemory(id: string): Promise<StoredAIProfileMemory | null> {
        return this.store.getProfileMemory(id)
    }

    async updateMemoryAccess(namespace: string, memoryId: string): Promise<void> {
        this.store.updateMemoryAccess(namespace, memoryId)
    }

    async updateProfileMemory(id: string, data: {
        content?: string
        importance?: number
        expiresAt?: number | null
        metadata?: unknown | null
    }): Promise<StoredAIProfileMemory | null> {
        return this.store.updateProfileMemory(id, data)
    }

    async deleteExpiredMemories(namespace: string): Promise<number> {
        return this.store.deleteExpiredMemories(namespace)
    }

    async deleteProfileMemories(namespace: string, profileId: string): Promise<number> {
        return this.store.deleteProfileMemories(namespace, profileId)
    }

    async deleteProfileMemory(id: string): Promise<boolean> {
        return this.store.deleteProfileMemory(id)
    }

    // === AI Team 操作 ===
    async createAITeam(data: {
        namespace: string
        name: string
        description?: string | null
        focus?: string | null
        config?: Partial<StoredAITeam['config']>
    }): Promise<StoredAITeam | null> {
        return this.store.createAITeam(data.namespace, {
            name: data.name,
            description: data.description,
            focus: data.focus,
            config: data.config
        })
    }

    async getAITeam(id: string): Promise<StoredAITeam | null> {
        return this.store.getAITeam(id)
    }

    async getAITeams(namespace: string): Promise<StoredAITeam[]> {
        return this.store.getAITeams(namespace)
    }

    async getActiveAITeams(namespace: string): Promise<StoredAITeam[]> {
        return this.store.getActiveAITeams(namespace)
    }

    async updateAITeam(id: string, data: {
        name?: string
        description?: string | null
        focus?: string | null
        status?: AITeamStatus
        config?: Partial<StoredAITeam['config']>
    }): Promise<StoredAITeam | null> {
        return this.store.updateAITeam(id, data)
    }

    async updateAITeamStats(id: string, stats: Partial<StoredAITeam['stats']>): Promise<void> {
        this.store.updateAITeamStats(id, stats)
    }

    async deleteAITeam(id: string): Promise<boolean> {
        return this.store.deleteAITeam(id)
    }

    // === AI Team Member 操作 ===
    async addAITeamMember(data: {
        teamId: string
        profileId: string
        role?: AITeamMemberRole
        specialization?: string | null
    }): Promise<StoredAITeamMember | null> {
        return this.store.addAITeamMember(
            data.teamId,
            data.profileId,
            data.role ?? 'member',
            data.specialization ?? undefined
        )
    }

    async getAITeamMember(teamId: string, profileId: string): Promise<StoredAITeamMember | null> {
        return this.store.getAITeamMember(teamId, profileId)
    }

    async getAITeamMembers(teamId: string): Promise<StoredAITeamMember[]> {
        return this.store.getAITeamMembers(teamId)
    }

    async getTeamsForProfile(profileId: string): Promise<StoredAITeam[]> {
        return this.store.getTeamsForProfile(profileId)
    }

    async updateTeamMemberContribution(teamId: string, profileId: string, contribution: number): Promise<void> {
        this.store.updateTeamMemberContribution(teamId, profileId, contribution)
    }

    async updateTeamMemberRole(teamId: string, profileId: string, role: AITeamMemberRole): Promise<void> {
        this.store.updateTeamMemberRole(teamId, profileId, role)
    }

    async removeAITeamMember(teamId: string, profileId: string): Promise<boolean> {
        return this.store.removeAITeamMember(teamId, profileId)
    }

    // === AI Team Knowledge 操作 ===
    async addAITeamKnowledge(data: {
        teamId: string
        namespace: string
        title: string
        content: string
        category: StoredAITeamKnowledge['category']
        contributorProfileId: string
        importance?: number
    }): Promise<StoredAITeamKnowledge | null> {
        return this.store.addAITeamKnowledge(data.teamId, data.namespace, {
            title: data.title,
            content: data.content,
            category: data.category,
            contributorProfileId: data.contributorProfileId,
            importance: data.importance
        })
    }

    async getAITeamKnowledge(id: string): Promise<StoredAITeamKnowledge | null> {
        return this.store.getAITeamKnowledge(id)
    }

    async getAITeamKnowledgeList(teamId: string, options?: {
        category?: StoredAITeamKnowledge['category']
        minImportance?: number
        limit?: number
    }): Promise<StoredAITeamKnowledge[]> {
        return this.store.getAITeamKnowledgeList(teamId, options)
    }

    async updateTeamKnowledgeAccess(id: string): Promise<void> {
        this.store.updateTeamKnowledgeAccess(id)
    }

    async deleteAITeamKnowledge(id: string): Promise<boolean> {
        return this.store.deleteAITeamKnowledge(id)
    }

    // === AI Team with Members 操作 ===
    async getAITeamWithMembers(teamId: string): Promise<{
        team: StoredAITeam
        members: Array<StoredAITeamMember & { profile: StoredAIProfile | null }>
    } | null> {
        return this.store.getAITeamWithMembers(teamId)
    }

    // === 关闭连接 ===
    async close(): Promise<void> {
        // SQLite 使用 bun:sqlite，不需要显式关闭
        // 如果需要，可以在这里添加清理逻辑
    }
}
