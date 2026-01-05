import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export type StoredSession = {
    id: string
    tag: string | null
    namespace: string
    machineId: string | null
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    agentState: unknown | null
    agentStateVersion: number
    todos: unknown | null
    todosUpdatedAt: number | null
    active: boolean
    activeAt: number | null
    seq: number
    advisorTaskId: string | null  // Advisor 创建的会话的任务 ID
    creatorChatId: string | null  // 创建者的 Telegram chatId（用于通知）
    advisorMode: boolean  // 是否启用 Advisor/CTO 模式（会自动注入 CTO 指令）
    advisorPromptInjected: boolean  // CTO 指令是否已注入（避免重复注入）
    rolePromptSent: boolean  // Role Prompt 是否已发送（避免重复发送）
}

export type StoredMachine = {
    id: string
    namespace: string
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    daemonState: unknown | null
    daemonStateVersion: number
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredMessage = {
    id: string
    sessionId: string
    content: unknown
    createdAt: number
    seq: number
    localId: string | null
}

export type UserRole = 'developer' | 'operator'

export type StoredPushSubscription = {
    id: number
    namespace: string
    endpoint: string
    keys: {
        p256dh: string
        auth: string
    }
    userAgent: string | null
    clientId: string | null
    chatId: string | null  // Telegram chatId，用于关联 Web Push 和 Telegram 通知
    createdAt: number
    updatedAt: number
}

// Advisor Agent 相关类型
export type AdvisorStatus = 'idle' | 'running' | 'error'
export type SuggestionCategory = 'product' | 'architecture' | 'operation' | 'strategy' | 'collaboration'
export type SuggestionSeverity = 'low' | 'medium' | 'high' | 'critical'
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'stale' | 'superseded'
export type SuggestionScope = 'session' | 'project' | 'team' | 'global'
export type MemoryType = 'insight' | 'pattern' | 'decision' | 'lesson'
export type FeedbackSource = 'user' | 'auto' | 'advisor'
export type FeedbackAction = 'accept' | 'reject' | 'defer' | 'supersede'

// Auto-Iteration 相关类型
export type AutoIterActionType =
    | 'format_code' | 'fix_lint' | 'add_comments' | 'run_tests'
    | 'fix_type_errors' | 'update_deps' | 'refactor' | 'optimize'
    | 'edit_config' | 'create_file' | 'delete_file'
    | 'git_commit' | 'git_push' | 'deploy' | 'custom'

export type AutoIterExecutionPolicy =
    | 'auto_execute' | 'notify_then_execute' | 'require_confirm' | 'always_manual' | 'disabled'

export type AutoIterExecutionStatus =
    | 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'rejected' | 'cancelled' | 'timeout'

export type AutoIterApprovalMethod = 'auto' | 'manual' | 'timeout'
export type AutoIterNotificationLevel = 'all' | 'errors_only' | 'none'

export type StoredAutoIterationConfig = {
    namespace: string
    enabled: boolean
    policyJson: Partial<Record<AutoIterActionType, AutoIterExecutionPolicy>> | null
    allowedProjects: string[]
    notificationLevel: AutoIterNotificationLevel
    keepLogsDays: number
    createdAt: number
    updatedAt: number
    updatedBy: string | null
}

export type StoredAutoIterationLog = {
    id: string
    namespace: string
    sourceSuggestionId: string | null
    sourceSessionId: string | null
    projectPath: string | null
    actionType: AutoIterActionType
    actionDetail: unknown | null
    reason: string | null
    executionStatus: AutoIterExecutionStatus
    approvalMethod: AutoIterApprovalMethod | null
    approvedBy: string | null
    approvedAt: number | null
    resultJson: unknown | null
    errorMessage: string | null
    rollbackAvailable: boolean
    rollbackData: unknown | null
    rolledBack: boolean
    rolledBackAt: number | null
    createdAt: number
    executedAt: number | null
}

export type StoredSessionAutoIterConfig = {
    sessionId: string
    autoIterEnabled: boolean
    updatedAt: number
}

// Agent Group 相关类型
export type AgentGroupType = 'collaboration' | 'debate' | 'review'
export type AgentGroupStatus = 'active' | 'paused' | 'completed'
export type GroupMemberRole = 'owner' | 'moderator' | 'member'
export type GroupSenderType = 'agent' | 'user' | 'system'
export type GroupMessageType = 'chat' | 'task' | 'feedback' | 'decision'

// AI Profile 相关类型
export type AIProfileRole = 'developer' | 'architect' | 'reviewer' | 'pm' | 'tester' | 'devops'
export type AIProfileStatus = 'idle' | 'working' | 'resting'
export type AIProfileMemoryType = 'context' | 'preference' | 'knowledge' | 'experience'

export type StoredAIProfile = {
    id: string
    namespace: string
    name: string
    role: AIProfileRole
    specialties: string[]
    personality: string | null
    greetingTemplate: string | null
    preferredProjects: string[]
    workStyle: string | null
    avatarEmoji: string
    status: AIProfileStatus
    stats: {
        tasksCompleted: number
        activeMinutes: number
        lastActiveAt: number | null
    }
    createdAt: number
    updatedAt: number
}

export type StoredAIProfileMemory = {
    id: string
    namespace: string
    profileId: string
    memoryType: AIProfileMemoryType
    content: string
    importance: number
    accessCount: number
    lastAccessedAt: number | null
    expiresAt: number | null
    createdAt: number
    updatedAt: number
    metadata: unknown | null
}

// AI Team 相关类型 (V4.2)
export type AITeamStatus = 'active' | 'paused' | 'archived'
export type AITeamMemberRole = 'lead' | 'member' | 'advisor'

export type StoredAITeam = {
    id: string
    namespace: string
    name: string
    description: string | null
    focus: string | null  // 团队专注领域，如 "backend", "frontend", "devops"
    status: AITeamStatus
    config: {
        maxMembers: number
        autoAssign: boolean  // 是否自动分配新任务
        sharedKnowledge: boolean  // 是否共享团队知识
    }
    stats: {
        tasksCompleted: number
        activeHours: number
        collaborationScore: number  // 协作效率评分 0-100
    }
    createdAt: number
    updatedAt: number
}

export type StoredAITeamMember = {
    teamId: string
    profileId: string
    role: AITeamMemberRole
    joinedAt: number
    contribution: number  // 贡献度 0-100
    specialization: string | null  // 在团队中的专项职责
}

export type StoredAITeamKnowledge = {
    id: string
    teamId: string
    namespace: string
    title: string
    content: string
    category: 'best-practice' | 'lesson-learned' | 'decision' | 'convention'
    contributorProfileId: string
    importance: number
    accessCount: number
    createdAt: number
    updatedAt: number
}

export type StoredAgentGroup = {
    id: string
    namespace: string
    name: string
    description: string | null
    type: AgentGroupType
    createdAt: number
    updatedAt: number
    status: AgentGroupStatus
}

export type StoredAgentGroupWithLastMessage = StoredAgentGroup & {
    memberCount: number
    lastMessage: {
        content: string
        senderType: GroupSenderType
        createdAt: number
    } | null
}

export type StoredAgentGroupMember = {
    groupId: string
    sessionId: string
    role: GroupMemberRole
    agentType: string | null
    joinedAt: number
}

export type StoredAgentGroupMessage = {
    id: string
    groupId: string
    sourceSessionId: string | null
    senderType: GroupSenderType
    content: string
    messageType: GroupMessageType
    createdAt: number
}

export type StoredSessionNotificationSubscription = {
    id: number
    sessionId: string
    chatId: string | null      // Telegram chatId
    clientId: string | null    // Web clientId (用于非 Telegram 用户)
    namespace: string
    subscribedAt: number
}

export type StoredAdvisorState = {
    namespace: string
    advisorSessionId: string | null
    machineId: string | null
    status: AdvisorStatus
    lastSeen: number | null
    configJson: unknown | null
    updatedAt: number
}

export type StoredAgentSessionState = {
    sessionId: string
    namespace: string
    lastSeq: number
    summary: string | null
    contextJson: unknown | null
    updatedAt: number
}

export type StoredAgentMemory = {
    id: number
    namespace: string
    type: MemoryType
    contentJson: unknown
    sourceRef: string | null
    confidence: number
    expiresAt: number | null
    updatedAt: number
}

export type StoredAgentSuggestion = {
    id: string
    namespace: string
    sessionId: string | null
    sourceSessionId: string | null
    title: string
    detail: string | null
    category: SuggestionCategory | null
    severity: SuggestionSeverity
    confidence: number
    status: SuggestionStatus
    targets: string | null  // JSON array
    scope: SuggestionScope
    createdAt: number
    updatedAt: number
}

export type StoredAgentFeedback = {
    id: number
    suggestionId: string
    source: FeedbackSource
    userId: string | null
    action: FeedbackAction
    evidenceJson: unknown | null
    comment: string | null
    createdAt: number
}

export type StoredUser = {
    id: number
    platform: string
    platformUserId: string
    namespace: string
    role: UserRole
    createdAt: number
}

export type VersionedUpdateResult<T> =
    | { result: 'success'; version: number; value: T }
    | { result: 'version-mismatch'; version: number; value: T }
    | { result: 'error' }

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

// Advisor Agent 数据库行类型
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

// Agent Group 数据库行类型
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

// AI Profile 数据库行类型
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

// AI Profile Memory 数据库行类型
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

// AI Team 数据库行类型 (V4.2)
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

// Advisor Agent 转换函数
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

// Auto-Iteration 转换函数
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

// Agent Group 转换函数
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

// AI Profile 转换函数
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

// AI Profile Memory 转换函数
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

// AI Team 转换函数 (V4.2)
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

export class Store {
    private db: Database

    constructor(dbPath: string) {
        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            const dir = dirname(dbPath)
            mkdirSync(dir, { recursive: true, mode: 0o700 })
            try {
                chmodSync(dir, 0o700)
            } catch {
            }

            if (!existsSync(dbPath)) {
                try {
                    const fd = openSync(dbPath, 'a', 0o600)
                    closeSync(fd)
                } catch {
                }
            }
        }

        this.db = new Database(dbPath, { create: true, readwrite: true, strict: true })
        this.db.exec('PRAGMA journal_mode = WAL')
        this.db.exec('PRAGMA synchronous = NORMAL')
        this.db.exec('PRAGMA foreign_keys = ON')
        this.db.exec('PRAGMA busy_timeout = 5000')
        this.initSchema()

        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
                try {
                    chmodSync(path, 0o600)
                } catch {
                }
            }
        }
    }

    private initSchema(): void {
        // Step 1: Create tables and indexes that don't depend on new columns
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                tag TEXT,
                namespace TEXT NOT NULL DEFAULT 'default',
                machine_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                agent_state TEXT,
                agent_state_version INTEGER DEFAULT 1,
                todos TEXT,
                todos_updated_at INTEGER,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_tag ON sessions(tag);

            CREATE TABLE IF NOT EXISTS machines (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                daemon_state TEXT,
                daemon_state_version INTEGER DEFAULT 1,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                local_id TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_local_id ON messages(session_id, local_id) WHERE local_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                platform_user_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                UNIQUE(platform, platform_user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_users_platform ON users(platform);

            CREATE TABLE IF NOT EXISTS allowed_emails (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL DEFAULT 'developer',
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                description TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS role_prompts (
                role TEXT PRIMARY KEY,
                prompt TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL DEFAULT 'default',
                endpoint TEXT NOT NULL UNIQUE,
                keys_p256dh TEXT NOT NULL,
                keys_auth TEXT NOT NULL,
                user_agent TEXT,
                client_id TEXT,
                chat_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_namespace ON push_subscriptions(namespace);
            -- Note: idx_push_subscriptions_chat_id is created after migration to ensure chat_id column exists

            CREATE TABLE IF NOT EXISTS input_presets (
                id TEXT PRIMARY KEY,
                trigger TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                prompt TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `)

        // Step 2: Migrate existing tables (add missing columns)
        const sessionColumns = this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
        const sessionColumnNames = new Set(sessionColumns.map((c) => c.name))

        if (!sessionColumnNames.has('namespace')) {
            this.db.exec("ALTER TABLE sessions ADD COLUMN namespace TEXT NOT NULL DEFAULT 'default'")
        }
        if (!sessionColumnNames.has('todos')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN todos TEXT')
        }
        if (!sessionColumnNames.has('todos_updated_at')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN todos_updated_at INTEGER')
        }
        if (!sessionColumnNames.has('advisor_task_id')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN advisor_task_id TEXT')
        }
        if (!sessionColumnNames.has('creator_chat_id')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN creator_chat_id TEXT')
        }
        if (!sessionColumnNames.has('advisor_mode')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN advisor_mode INTEGER DEFAULT 0')
        }
        if (!sessionColumnNames.has('advisor_prompt_injected')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN advisor_prompt_injected INTEGER DEFAULT 0')
        }
        if (!sessionColumnNames.has('role_prompt_sent')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN role_prompt_sent INTEGER DEFAULT 0')
        }

        const machineColumns = this.db.prepare('PRAGMA table_info(machines)').all() as Array<{ name: string }>
        const machineColumnNames = new Set(machineColumns.map((c) => c.name))
        if (!machineColumnNames.has('namespace')) {
            this.db.exec("ALTER TABLE machines ADD COLUMN namespace TEXT NOT NULL DEFAULT 'default'")
        }

        const userColumns = this.db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
        const userColumnNames = new Set(userColumns.map((c) => c.name))
        if (!userColumnNames.has('namespace')) {
            this.db.exec("ALTER TABLE users ADD COLUMN namespace TEXT NOT NULL DEFAULT 'default'")
        }
        if (!userColumnNames.has('role')) {
            this.db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'developer'")
        }

        // Migrate allowed_emails table to add role column
        const allowedEmailsColumns = this.db.prepare('PRAGMA table_info(allowed_emails)').all() as Array<{ name: string }>
        const allowedEmailsColumnNames = new Set(allowedEmailsColumns.map((c) => c.name))
        if (!allowedEmailsColumnNames.has('role')) {
            this.db.exec("ALTER TABLE allowed_emails ADD COLUMN role TEXT NOT NULL DEFAULT 'developer'")
        }

        // Migrate push_subscriptions table to add client_id and chat_id columns
        const pushSubColumns = this.db.prepare('PRAGMA table_info(push_subscriptions)').all() as Array<{ name: string }>
        const pushSubColumnNames = new Set(pushSubColumns.map((c) => c.name))
        if (!pushSubColumnNames.has('client_id')) {
            this.db.exec('ALTER TABLE push_subscriptions ADD COLUMN client_id TEXT')
        }
        if (!pushSubColumnNames.has('chat_id')) {
            this.db.exec('ALTER TABLE push_subscriptions ADD COLUMN chat_id TEXT')
        }
        // Create indexes after the columns exist
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_push_subscriptions_client_id ON push_subscriptions(client_id)')
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_push_subscriptions_chat_id ON push_subscriptions(chat_id)')

        // Migrate session_notification_subscriptions schema to allow client_id subscriptions.
        const sessionNotifSubColumns = this.db.prepare('PRAGMA table_info(session_notification_subscriptions)').all() as Array<{ name: string; notnull: number }>
        if (sessionNotifSubColumns.length > 0) {
            const sessionNotifSubColumnNames = new Set(sessionNotifSubColumns.map((c) => c.name))
            const chatIdColumn = sessionNotifSubColumns.find((c) => c.name === 'chat_id')
            const chatIdNotNull = chatIdColumn?.notnull === 1
            const hasClientId = sessionNotifSubColumnNames.has('client_id')

            if (chatIdNotNull) {
                this.db.exec('BEGIN')
                try {
                    this.db.exec('ALTER TABLE session_notification_subscriptions RENAME TO session_notification_subscriptions_old')
                    this.db.exec(`
                        CREATE TABLE session_notification_subscriptions (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            session_id TEXT NOT NULL,
                            chat_id TEXT,
                            client_id TEXT,
                            namespace TEXT NOT NULL,
                            subscribed_at INTEGER DEFAULT (unixepoch() * 1000),
                            UNIQUE(session_id, chat_id),
                            UNIQUE(session_id, client_id)
                        );
                    `)

                    const copySql = hasClientId
                        ? `
                            INSERT INTO session_notification_subscriptions (id, session_id, chat_id, client_id, namespace, subscribed_at)
                            SELECT id, session_id, chat_id, client_id, namespace, subscribed_at
                            FROM session_notification_subscriptions_old
                        `
                        : `
                            INSERT INTO session_notification_subscriptions (id, session_id, chat_id, client_id, namespace, subscribed_at)
                            SELECT id, session_id, chat_id, NULL as client_id, namespace, subscribed_at
                            FROM session_notification_subscriptions_old
                        `
                    this.db.exec(copySql)
                    this.db.exec('DROP TABLE session_notification_subscriptions_old')
                    this.db.exec('CREATE INDEX IF NOT EXISTS idx_session_notif_sub_session ON session_notification_subscriptions(session_id)')
                    this.db.exec('CREATE INDEX IF NOT EXISTS idx_session_notif_sub_chat ON session_notification_subscriptions(chat_id)')
                    this.db.exec('CREATE INDEX IF NOT EXISTS idx_session_notif_sub_client ON session_notification_subscriptions(client_id)')
                    this.db.exec('COMMIT')
                } catch (error) {
                    this.db.exec('ROLLBACK')
                    throw error
                }
            } else {
                if (!hasClientId) {
                    this.db.exec('ALTER TABLE session_notification_subscriptions ADD COLUMN client_id TEXT')
                }
                this.db.exec('CREATE INDEX IF NOT EXISTS idx_session_notif_sub_client ON session_notification_subscriptions(client_id)')
                this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_session_notif_sub_session_client ON session_notification_subscriptions(session_id, client_id) WHERE client_id IS NOT NULL')
            }
        }

        // Step 3: Create indexes that depend on namespace column (after migration)
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_sessions_tag_namespace ON sessions(tag, namespace);
            CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace);
            CREATE INDEX IF NOT EXISTS idx_users_platform_namespace ON users(platform, namespace);
        `)

        // Step 4: Create Advisor Agent tables
        this.db.exec(`
            -- Advisor 全局状态（每个 namespace 一条记录）
            CREATE TABLE IF NOT EXISTS advisor_state (
                namespace TEXT PRIMARY KEY,
                advisor_session_id TEXT,
                machine_id TEXT,
                status TEXT DEFAULT 'idle',
                last_seen INTEGER,
                config_json TEXT,
                updated_at INTEGER DEFAULT (unixepoch() * 1000)
            );

            -- 各会话的增量摘要进度
            CREATE TABLE IF NOT EXISTS agent_session_state (
                session_id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                last_seq INTEGER DEFAULT 0,
                summary TEXT,
                context_json TEXT,
                updated_at INTEGER DEFAULT (unixepoch() * 1000)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_session_state_namespace ON agent_session_state(namespace);

            -- Advisor 记忆（长期知识）
            CREATE TABLE IF NOT EXISTS agent_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL,
                type TEXT NOT NULL,
                content_json TEXT NOT NULL,
                source_ref TEXT,
                confidence REAL DEFAULT 0.5,
                expires_at INTEGER,
                updated_at INTEGER DEFAULT (unixepoch() * 1000)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_memory_namespace_type ON agent_memory(namespace, type);

            -- Advisor 建议
            CREATE TABLE IF NOT EXISTS agent_suggestions (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                session_id TEXT,
                source_session_id TEXT,
                title TEXT NOT NULL,
                detail TEXT,
                category TEXT,
                severity TEXT DEFAULT 'low',
                confidence REAL DEFAULT 0.5,
                status TEXT DEFAULT 'pending',
                targets TEXT,
                scope TEXT DEFAULT 'session',
                created_at INTEGER DEFAULT (unixepoch() * 1000),
                updated_at INTEGER DEFAULT (unixepoch() * 1000)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_suggestions_namespace_status ON agent_suggestions(namespace, status);
            CREATE INDEX IF NOT EXISTS idx_agent_suggestions_created ON agent_suggestions(created_at);

            -- 建议反馈（人工与自动）
            CREATE TABLE IF NOT EXISTS agent_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                suggestion_id TEXT NOT NULL,
                source TEXT NOT NULL,
                user_id TEXT,
                action TEXT NOT NULL,
                evidence_json TEXT,
                comment TEXT,
                created_at INTEGER DEFAULT (unixepoch() * 1000),
                FOREIGN KEY (suggestion_id) REFERENCES agent_suggestions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_agent_feedback_suggestion ON agent_feedback(suggestion_id);
        `)

        // Step 5: Create Auto-Iteration tables
        this.db.exec(`
            -- 自动迭代配置（每个 namespace 一条记录）
            CREATE TABLE IF NOT EXISTS auto_iteration_config (
                namespace TEXT PRIMARY KEY,
                enabled INTEGER DEFAULT 0,
                policy_json TEXT,
                allowed_projects TEXT DEFAULT '[]',
                notification_level TEXT DEFAULT 'all',
                keep_logs_days INTEGER DEFAULT 30,
                created_at INTEGER DEFAULT (unixepoch() * 1000),
                updated_at INTEGER DEFAULT (unixepoch() * 1000),
                updated_by TEXT
            );

            -- 自动迭代执行日志
            CREATE TABLE IF NOT EXISTS auto_iteration_logs (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                source_suggestion_id TEXT,
                source_session_id TEXT,
                project_path TEXT,
                action_type TEXT NOT NULL,
                action_detail TEXT,
                reason TEXT,
                execution_status TEXT DEFAULT 'pending',
                approval_method TEXT,
                approved_by TEXT,
                approved_at INTEGER,
                result_json TEXT,
                error_message TEXT,
                rollback_available INTEGER DEFAULT 0,
                rollback_data TEXT,
                rolled_back INTEGER DEFAULT 0,
                rolled_back_at INTEGER,
                created_at INTEGER DEFAULT (unixepoch() * 1000),
                executed_at INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_auto_iteration_logs_namespace ON auto_iteration_logs(namespace);
            CREATE INDEX IF NOT EXISTS idx_auto_iteration_logs_status ON auto_iteration_logs(execution_status);
            CREATE INDEX IF NOT EXISTS idx_auto_iteration_logs_created ON auto_iteration_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_auto_iteration_logs_project ON auto_iteration_logs(project_path);

            -- 每个 session 的自动迭代配置
            CREATE TABLE IF NOT EXISTS session_auto_iter_config (
                session_id TEXT PRIMARY KEY,
                auto_iter_enabled INTEGER DEFAULT 1,
                updated_at INTEGER DEFAULT (unixepoch() * 1000),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
        `)

        // Step 6: Create Agent Groups tables
        this.db.exec(`
            -- Agent 群组
            CREATE TABLE IF NOT EXISTS agent_groups (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                type TEXT DEFAULT 'collaboration',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                status TEXT DEFAULT 'active'
            );
            CREATE INDEX IF NOT EXISTS idx_agent_groups_namespace ON agent_groups(namespace);

            -- 群组成员
            CREATE TABLE IF NOT EXISTS agent_group_members (
                group_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                role TEXT DEFAULT 'member',
                agent_type TEXT,
                joined_at INTEGER NOT NULL,
                PRIMARY KEY (group_id, session_id),
                FOREIGN KEY (group_id) REFERENCES agent_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            -- 群组消息
            CREATE TABLE IF NOT EXISTS agent_group_messages (
                id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL,
                source_session_id TEXT,
                sender_type TEXT DEFAULT 'agent',
                content TEXT NOT NULL,
                message_type TEXT DEFAULT 'chat',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (group_id) REFERENCES agent_groups(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_agent_group_messages_group ON agent_group_messages(group_id);
        `)

        // Step 7: Create session notification subscriptions table
        this.db.exec(`
            -- Session 通知订阅表（用于订阅指定 session 的通知）
            -- 支持 chat_id (Telegram) 或 client_id (Web) 订阅
            CREATE TABLE IF NOT EXISTS session_notification_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                chat_id TEXT,
                client_id TEXT,
                namespace TEXT NOT NULL,
                subscribed_at INTEGER DEFAULT (unixepoch() * 1000),
                UNIQUE(session_id, chat_id),
                UNIQUE(session_id, client_id)
            );
            CREATE INDEX IF NOT EXISTS idx_session_notif_sub_session ON session_notification_subscriptions(session_id);
            CREATE INDEX IF NOT EXISTS idx_session_notif_sub_chat ON session_notification_subscriptions(chat_id);
            CREATE INDEX IF NOT EXISTS idx_session_notif_sub_client ON session_notification_subscriptions(client_id);
        `)

        // Step 8: Create AI Profiles table
        this.db.exec(`
            -- AI 员工档案表
            CREATE TABLE IF NOT EXISTS ai_profiles (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                specialties TEXT,
                personality TEXT,
                greeting_template TEXT,
                preferred_projects TEXT,
                work_style TEXT,
                avatar_emoji TEXT DEFAULT '🤖',
                status TEXT DEFAULT 'idle',
                stats_json TEXT,
                created_at INTEGER DEFAULT (unixepoch() * 1000),
                updated_at INTEGER DEFAULT (unixepoch() * 1000)
            );
            CREATE INDEX IF NOT EXISTS idx_ai_profiles_namespace ON ai_profiles(namespace);
            CREATE INDEX IF NOT EXISTS idx_ai_profiles_role ON ai_profiles(role);
        `)

        // Step 9: Create AI Profile Memories table
        this.db.exec(`
            -- AI 员工记忆表
            CREATE TABLE IF NOT EXISTS ai_profile_memories (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                profile_id TEXT NOT NULL,
                memory_type TEXT NOT NULL,
                content TEXT NOT NULL,
                importance REAL DEFAULT 0.5,
                access_count INTEGER DEFAULT 0,
                last_accessed_at INTEGER,
                expires_at INTEGER,
                created_at INTEGER DEFAULT (unixepoch() * 1000),
                updated_at INTEGER DEFAULT (unixepoch() * 1000),
                metadata TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_ai_profile_memories_namespace ON ai_profile_memories(namespace);
            CREATE INDEX IF NOT EXISTS idx_ai_profile_memories_profile ON ai_profile_memories(profile_id);
            CREATE INDEX IF NOT EXISTS idx_ai_profile_memories_type ON ai_profile_memories(memory_type);
            CREATE INDEX IF NOT EXISTS idx_ai_profile_memories_importance ON ai_profile_memories(importance);
            CREATE INDEX IF NOT EXISTS idx_ai_profile_memories_expires ON ai_profile_memories(expires_at);
        `)

        // Step 10: Create AI Teams tables (V4.2)
        this.db.exec(`
            -- AI 团队表
            CREATE TABLE IF NOT EXISTS ai_teams (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                focus TEXT,
                status TEXT DEFAULT 'active',
                config_json TEXT,
                stats_json TEXT,
                created_at INTEGER DEFAULT (unixepoch() * 1000),
                updated_at INTEGER DEFAULT (unixepoch() * 1000)
            );
            CREATE INDEX IF NOT EXISTS idx_ai_teams_namespace ON ai_teams(namespace);
            CREATE INDEX IF NOT EXISTS idx_ai_teams_status ON ai_teams(status);

            -- AI 团队成员表
            CREATE TABLE IF NOT EXISTS ai_team_members (
                team_id TEXT NOT NULL,
                profile_id TEXT NOT NULL,
                role TEXT DEFAULT 'member',
                joined_at INTEGER DEFAULT (unixepoch() * 1000),
                contribution INTEGER DEFAULT 0,
                specialization TEXT,
                PRIMARY KEY (team_id, profile_id),
                FOREIGN KEY (team_id) REFERENCES ai_teams(id) ON DELETE CASCADE,
                FOREIGN KEY (profile_id) REFERENCES ai_profiles(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_ai_team_members_profile ON ai_team_members(profile_id);

            -- AI 团队知识库表
            CREATE TABLE IF NOT EXISTS ai_team_knowledge (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL,
                namespace TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                category TEXT NOT NULL,
                contributor_profile_id TEXT NOT NULL,
                importance REAL DEFAULT 0.5,
                access_count INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (unixepoch() * 1000),
                updated_at INTEGER DEFAULT (unixepoch() * 1000),
                FOREIGN KEY (team_id) REFERENCES ai_teams(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_ai_team_knowledge_team ON ai_team_knowledge(team_id);
            CREATE INDEX IF NOT EXISTS idx_ai_team_knowledge_category ON ai_team_knowledge(category);
            CREATE INDEX IF NOT EXISTS idx_ai_team_knowledge_importance ON ai_team_knowledge(importance);
        `)
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string): StoredSession {
        const existing = this.db.prepare(
            'SELECT * FROM sessions WHERE tag = ? AND namespace = ? ORDER BY created_at DESC LIMIT 1'
        ).get(tag, namespace) as DbSessionRow | undefined

        if (existing) {
            return toStoredSession(existing)
        }

        const now = Date.now()
        const id = randomUUID()

        const metadataJson = JSON.stringify(metadata)
        const agentStateJson = agentState === null || agentState === undefined ? null : JSON.stringify(agentState)

        this.db.prepare(`
            INSERT INTO sessions (
                id, tag, namespace, machine_id, created_at, updated_at,
                metadata, metadata_version,
                agent_state, agent_state_version,
                todos, todos_updated_at,
                active, active_at, seq
            ) VALUES (
                @id, @tag, @namespace, NULL, @created_at, @updated_at,
                @metadata, 1,
                @agent_state, 1,
                NULL, NULL,
                0, NULL, 0
            )
        `).run({
            id,
            tag,
            namespace,
            created_at: now,
            updated_at: now,
            metadata: metadataJson,
            agent_state: agentStateJson
        })

        const row = this.getSession(id)
        if (!row) {
            throw new Error('Failed to create session')
        }
        return row
    }

    updateSessionMetadata(
        id: string,
        metadata: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        try {
            const now = Date.now()
            const json = JSON.stringify(metadata)
            const result = this.db.prepare(`
                UPDATE sessions
                SET metadata = @metadata,
                    metadata_version = metadata_version + 1,
                    updated_at = @updated_at,
                    seq = seq + 1
                WHERE id = @id AND namespace = @namespace AND metadata_version = @expectedVersion
            `).run({ id, metadata: json, updated_at: now, expectedVersion, namespace })

            if (result.changes === 1) {
                return { result: 'success', version: expectedVersion + 1, value: metadata }
            }

            const current = this.db.prepare(
                'SELECT metadata, metadata_version FROM sessions WHERE id = ? AND namespace = ?'
            ).get(id, namespace) as
                | { metadata: string | null; metadata_version: number }
                | undefined
            if (!current) {
                return { result: 'error' }
            }
            return {
                result: 'version-mismatch',
                version: current.metadata_version,
                value: safeJsonParse(current.metadata)
            }
        } catch {
            return { result: 'error' }
        }
    }

    updateSessionAgentState(
        id: string,
        agentState: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        try {
            const now = Date.now()
            const json = agentState === null || agentState === undefined ? null : JSON.stringify(agentState)
            const result = this.db.prepare(`
                UPDATE sessions
                SET agent_state = @agent_state,
                    agent_state_version = agent_state_version + 1,
                    updated_at = @updated_at,
                    seq = seq + 1
                WHERE id = @id AND namespace = @namespace AND agent_state_version = @expectedVersion
            `).run({ id, agent_state: json, updated_at: now, expectedVersion, namespace })

            if (result.changes === 1) {
                return { result: 'success', version: expectedVersion + 1, value: agentState === undefined ? null : agentState }
            }

            const current = this.db.prepare(
                'SELECT agent_state, agent_state_version FROM sessions WHERE id = ? AND namespace = ?'
            ).get(id, namespace) as
                | { agent_state: string | null; agent_state_version: number }
                | undefined
            if (!current) {
                return { result: 'error' }
            }
            return {
                result: 'version-mismatch',
                version: current.agent_state_version,
                value: safeJsonParse(current.agent_state)
            }
        } catch {
            return { result: 'error' }
        }
    }

    setSessionTodos(id: string, todos: unknown, todosUpdatedAt: number, namespace: string): boolean {
        try {
            const json = todos === null || todos === undefined ? null : JSON.stringify(todos)
            const result = this.db.prepare(`
                UPDATE sessions
                SET todos = @todos,
                    todos_updated_at = @todos_updated_at,
                    updated_at = CASE WHEN updated_at > @updated_at THEN updated_at ELSE @updated_at END,
                    seq = seq + 1
                WHERE id = @id
                  AND namespace = @namespace
                  AND (todos_updated_at IS NULL OR todos_updated_at < @todos_updated_at)
            `).run({
                id,
                todos: json,
                todos_updated_at: todosUpdatedAt,
                updated_at: todosUpdatedAt,
                namespace
            })

            return result.changes === 1
        } catch {
            return false
        }
    }

    /**
     * 设置会话的 Advisor 任务 ID（用于标记 Advisor 创建的会话）
     */
    setSessionAdvisorTaskId(id: string, advisorTaskId: string, namespace: string): boolean {
        try {
            const now = Date.now()
            const result = this.db.prepare(`
                UPDATE sessions
                SET advisor_task_id = @advisor_task_id,
                    updated_at = @updated_at,
                    seq = seq + 1
                WHERE id = @id AND namespace = @namespace
            `).run({ id, advisor_task_id: advisorTaskId, updated_at: now, namespace })

            return result.changes === 1
        } catch {
            return false
        }
    }

    /**
     * 设置会话的 Advisor 模式（启用后会在首条消息前自动注入 CTO 指令）
     */
    setSessionAdvisorMode(id: string, advisorMode: boolean, namespace: string): boolean {
        try {
            const now = Date.now()
            const result = this.db.prepare(`
                UPDATE sessions
                SET advisor_mode = @advisor_mode,
                    updated_at = @updated_at,
                    seq = seq + 1
                WHERE id = @id AND namespace = @namespace
            `).run({ id, advisor_mode: advisorMode ? 1 : 0, updated_at: now, namespace })

            return result.changes === 1
        } catch {
            return false
        }
    }

    /**
     * 标记会话的 CTO 指令已注入（防止重复注入）
     */
    setSessionAdvisorPromptInjected(id: string, namespace: string): boolean {
        try {
            const now = Date.now()
            const result = this.db.prepare(`
                UPDATE sessions
                SET advisor_prompt_injected = 1,
                    updated_at = @updated_at,
                    seq = seq + 1
                WHERE id = @id AND namespace = @namespace
            `).run({ id, updated_at: now, namespace })

            return result.changes === 1
        } catch {
            return false
        }
    }

    /**
     * 检查会话是否需要注入 CTO 指令
     * 返回 true 如果 advisorMode=true 且 advisorPromptInjected=false
     */
    shouldInjectAdvisorPrompt(id: string): boolean {
        const row = this.db.prepare(
            'SELECT advisor_mode, advisor_prompt_injected FROM sessions WHERE id = ?'
        ).get(id) as { advisor_mode: number | null; advisor_prompt_injected: number | null } | undefined

        if (!row) return false
        return row.advisor_mode === 1 && row.advisor_prompt_injected !== 1
    }

    /**
     * 检查会话是否已发送过 Role Prompt
     */
    isRolePromptSent(id: string): boolean {
        const row = this.db.prepare(
            'SELECT role_prompt_sent FROM sessions WHERE id = ?'
        ).get(id) as { role_prompt_sent: number | null } | undefined
        return row?.role_prompt_sent === 1
    }

    /**
     * 标记会话已发送 Role Prompt
     */
    setSessionRolePromptSent(id: string, namespace: string): boolean {
        try {
            const now = Date.now()
            const result = this.db.prepare(`
                UPDATE sessions
                SET role_prompt_sent = 1,
                    updated_at = @updated_at,
                    seq = seq + 1
                WHERE id = @id AND namespace = @namespace
            `).run({ id, updated_at: now, namespace })

            return result.changes > 0
        } catch {
            return false
        }
    }

    getSession(id: string): StoredSession | null {
        const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as DbSessionRow | undefined
        return row ? toStoredSession(row) : null
    }

    getSessionByNamespace(id: string, namespace: string): StoredSession | null {
        const row = this.db.prepare(
            'SELECT * FROM sessions WHERE id = ? AND namespace = ?'
        ).get(id, namespace) as DbSessionRow | undefined
        return row ? toStoredSession(row) : null
    }

    getSessions(): StoredSession[] {
        const rows = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as DbSessionRow[]
        return rows.map(toStoredSession)
    }

    getSessionsByNamespace(namespace: string): StoredSession[] {
        const rows = this.db.prepare(
            'SELECT * FROM sessions WHERE namespace = ? ORDER BY updated_at DESC'
        ).all(namespace) as DbSessionRow[]
        return rows.map(toStoredSession)
    }

    deleteSession(id: string): boolean {
        const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
        return result.changes > 0
    }

    getOrCreateMachine(id: string, metadata: unknown, daemonState: unknown, namespace: string): StoredMachine {
        const existing = this.db.prepare('SELECT * FROM machines WHERE id = ?').get(id) as DbMachineRow | undefined
        if (existing) {
            const stored = toStoredMachine(existing)
            if (stored.namespace !== namespace) {
                throw new Error('Machine namespace mismatch')
            }
            return stored
        }

        const now = Date.now()
        const metadataJson = JSON.stringify(metadata)
        const daemonStateJson = daemonState === null || daemonState === undefined ? null : JSON.stringify(daemonState)

        this.db.prepare(`
            INSERT INTO machines (
                id, namespace, created_at, updated_at,
                metadata, metadata_version,
                daemon_state, daemon_state_version,
                active, active_at, seq
            ) VALUES (
                @id, @namespace, @created_at, @updated_at,
                @metadata, 1,
                @daemon_state, 1,
                0, NULL, 0
            )
        `).run({
            id,
            namespace,
            created_at: now,
            updated_at: now,
            metadata: metadataJson,
            daemon_state: daemonStateJson
        })

        const row = this.getMachine(id)
        if (!row) {
            throw new Error('Failed to create machine')
        }
        return row
    }

    updateMachineMetadata(
        id: string,
        metadata: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        try {
            const now = Date.now()
            const json = JSON.stringify(metadata)
            const result = this.db.prepare(`
                UPDATE machines
                SET metadata = @metadata,
                    metadata_version = metadata_version + 1,
                    updated_at = @updated_at,
                    seq = seq + 1
                WHERE id = @id AND namespace = @namespace AND metadata_version = @expectedVersion
            `).run({ id, metadata: json, updated_at: now, expectedVersion, namespace })

            if (result.changes === 1) {
                return { result: 'success', version: expectedVersion + 1, value: metadata }
            }

            const current = this.db.prepare(
                'SELECT metadata, metadata_version FROM machines WHERE id = ? AND namespace = ?'
            ).get(id, namespace) as
                | { metadata: string | null; metadata_version: number }
                | undefined
            if (!current) {
                return { result: 'error' }
            }
            return {
                result: 'version-mismatch',
                version: current.metadata_version,
                value: safeJsonParse(current.metadata)
            }
        } catch {
            return { result: 'error' }
        }
    }

    updateMachineDaemonState(
        id: string,
        daemonState: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        try {
            const now = Date.now()
            const json = daemonState === null || daemonState === undefined ? null : JSON.stringify(daemonState)
            const result = this.db.prepare(`
                UPDATE machines
                SET daemon_state = @daemon_state,
                    daemon_state_version = daemon_state_version + 1,
                    updated_at = @updated_at,
                    active = 1,
                    active_at = @active_at,
                    seq = seq + 1
                WHERE id = @id AND namespace = @namespace AND daemon_state_version = @expectedVersion
            `).run({ id, daemon_state: json, updated_at: now, active_at: now, expectedVersion, namespace })

            if (result.changes === 1) {
                return { result: 'success', version: expectedVersion + 1, value: daemonState === undefined ? null : daemonState }
            }

            const current = this.db.prepare(
                'SELECT daemon_state, daemon_state_version FROM machines WHERE id = ? AND namespace = ?'
            ).get(id, namespace) as
                | { daemon_state: string | null; daemon_state_version: number }
                | undefined
            if (!current) {
                return { result: 'error' }
            }
            return {
                result: 'version-mismatch',
                version: current.daemon_state_version,
                value: safeJsonParse(current.daemon_state)
            }
        } catch {
            return { result: 'error' }
        }
    }

    getMachine(id: string): StoredMachine | null {
        const row = this.db.prepare('SELECT * FROM machines WHERE id = ?').get(id) as DbMachineRow | undefined
        return row ? toStoredMachine(row) : null
    }

    getMachineByNamespace(id: string, namespace: string): StoredMachine | null {
        const row = this.db.prepare(
            'SELECT * FROM machines WHERE id = ? AND namespace = ?'
        ).get(id, namespace) as DbMachineRow | undefined
        return row ? toStoredMachine(row) : null
    }

    getMachines(): StoredMachine[] {
        const rows = this.db.prepare('SELECT * FROM machines ORDER BY updated_at DESC').all() as DbMachineRow[]
        return rows.map(toStoredMachine)
    }

    getMachinesByNamespace(namespace: string): StoredMachine[] {
        const rows = this.db.prepare(
            'SELECT * FROM machines WHERE namespace = ? ORDER BY updated_at DESC'
        ).all(namespace) as DbMachineRow[]
        return rows.map(toStoredMachine)
    }

    addMessage(sessionId: string, content: unknown, localId?: string): StoredMessage {
        const now = Date.now()

        if (localId) {
            const existing = this.db.prepare(
                'SELECT * FROM messages WHERE session_id = ? AND local_id = ? LIMIT 1'
            ).get(sessionId, localId) as DbMessageRow | undefined
            if (existing) {
                return toStoredMessage(existing)
            }
        }

        const msgSeqRow = this.db.prepare(
            'SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM messages WHERE session_id = ?'
        ).get(sessionId) as { nextSeq: number }
        const msgSeq = msgSeqRow.nextSeq

        const id = randomUUID()
        const json = JSON.stringify(content)

        this.db.prepare(`
            INSERT INTO messages (
                id, session_id, content, created_at, seq, local_id
            ) VALUES (
                @id, @session_id, @content, @created_at, @seq, @local_id
            )
        `).run({
            id,
            session_id: sessionId,
            content: json,
            created_at: now,
            seq: msgSeq,
            local_id: localId ?? null
        })

        const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as DbMessageRow | undefined
        if (!row) {
            throw new Error('Failed to create message')
        }
        return toStoredMessage(row)
    }

    getMessages(sessionId: string, limit: number = 200, beforeSeq?: number): StoredMessage[] {
        const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 200

        const rows = (beforeSeq !== undefined && beforeSeq !== null && Number.isFinite(beforeSeq))
            ? this.db.prepare(
                'SELECT * FROM messages WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?'
            ).all(sessionId, beforeSeq, safeLimit) as DbMessageRow[]
            : this.db.prepare(
                'SELECT * FROM messages WHERE session_id = ? ORDER BY seq DESC LIMIT ?'
            ).all(sessionId, safeLimit) as DbMessageRow[]

        return rows.reverse().map(toStoredMessage)
    }

    getMessagesAfter(sessionId: string, afterSeq: number, limit: number = 200): StoredMessage[] {
        const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 200
        const safeAfterSeq = Number.isFinite(afterSeq) ? afterSeq : 0

        const rows = this.db.prepare(
            'SELECT * FROM messages WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?'
        ).all(sessionId, safeAfterSeq, safeLimit) as DbMessageRow[]

        return rows.map(toStoredMessage)
    }

    getMessageCount(sessionId: string): number {
        const row = this.db.prepare(
            'SELECT COUNT(*) AS count FROM messages WHERE session_id = ?'
        ).get(sessionId) as { count: number }
        return row.count
    }

    clearMessages(sessionId: string, keepCount: number = 30): { deleted: number; remaining: number } {
        const safeKeepCount = Math.max(0, keepCount)

        // Get the seq threshold - messages with seq > threshold will be kept
        const thresholdRow = this.db.prepare(`
            SELECT seq FROM messages
            WHERE session_id = ?
            ORDER BY seq DESC
            LIMIT 1 OFFSET ?
        `).get(sessionId, safeKeepCount - 1) as { seq: number } | undefined

        if (!thresholdRow) {
            // Not enough messages to delete
            const count = this.getMessageCount(sessionId)
            return { deleted: 0, remaining: count }
        }

        const thresholdSeq = thresholdRow.seq

        // Delete messages older than threshold
        const result = this.db.prepare(
            'DELETE FROM messages WHERE session_id = ? AND seq < ?'
        ).run(sessionId, thresholdSeq)

        const remaining = this.getMessageCount(sessionId)
        return { deleted: result.changes, remaining }
    }

    getUser(platform: string, platformUserId: string): StoredUser | null {
        const row = this.db.prepare(
            'SELECT * FROM users WHERE platform = ? AND platform_user_id = ? LIMIT 1'
        ).get(platform, platformUserId) as DbUserRow | undefined
        return row ? toStoredUser(row) : null
    }

    getUsersByPlatform(platform: string): StoredUser[] {
        const rows = this.db.prepare(
            'SELECT * FROM users WHERE platform = ? ORDER BY created_at ASC'
        ).all(platform) as DbUserRow[]
        return rows.map(toStoredUser)
    }

    getUsersByPlatformAndNamespace(platform: string, namespace: string): StoredUser[] {
        const rows = this.db.prepare(
            'SELECT * FROM users WHERE platform = ? AND namespace = ? ORDER BY created_at ASC'
        ).all(platform, namespace) as DbUserRow[]
        return rows.map(toStoredUser)
    }

    addUser(platform: string, platformUserId: string, namespace: string, role: UserRole = 'developer'): StoredUser {
        const now = Date.now()
        this.db.prepare(`
            INSERT OR IGNORE INTO users (
                platform, platform_user_id, namespace, role, created_at
            ) VALUES (
                @platform, @platform_user_id, @namespace, @role, @created_at
            )
        `).run({
            platform,
            platform_user_id: platformUserId,
            namespace,
            role,
            created_at: now
        })

        const row = this.getUser(platform, platformUserId)
        if (!row) {
            throw new Error('Failed to create user')
        }
        return row
    }

    updateUserRole(platform: string, platformUserId: string, role: UserRole): boolean {
        const result = this.db.prepare(
            'UPDATE users SET role = ? WHERE platform = ? AND platform_user_id = ?'
        ).run(role, platform, platformUserId)
        return result.changes > 0
    }

    removeUser(platform: string, platformUserId: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM users WHERE platform = ? AND platform_user_id = ?'
        ).run(platform, platformUserId)
        return result.changes > 0
    }

    // 邮箱白名单/用户管理
    getAllowedEmails(): string[] {
        const rows = this.db.prepare(
            'SELECT email FROM allowed_emails ORDER BY created_at ASC'
        ).all() as Array<{ email: string }>
        return rows.map(r => r.email)
    }

    getAllowedUsers(): Array<{ email: string; role: UserRole; createdAt: number }> {
        const rows = this.db.prepare(
            'SELECT email, role, created_at FROM allowed_emails ORDER BY created_at ASC'
        ).all() as Array<{ email: string; role: string; created_at: number }>
        return rows.map(r => ({
            email: r.email,
            role: (r.role === 'operator' ? 'operator' : 'developer') as UserRole,
            createdAt: r.created_at
        }))
    }

    addAllowedEmail(email: string, role: UserRole = 'developer'): boolean {
        try {
            const normalizedEmail = email.toLowerCase().trim()
            const now = Date.now()
            this.db.prepare(`
                INSERT OR IGNORE INTO allowed_emails (email, role, created_at)
                VALUES (@email, @role, @created_at)
            `).run({
                email: normalizedEmail,
                role,
                created_at: now
            })
            return true
        } catch {
            return false
        }
    }

    updateAllowedEmailRole(email: string, role: UserRole): boolean {
        const normalizedEmail = email.toLowerCase().trim()
        const result = this.db.prepare(
            'UPDATE allowed_emails SET role = ? WHERE email = ?'
        ).run(role, normalizedEmail)
        return result.changes > 0
    }

    removeAllowedEmail(email: string): boolean {
        const normalizedEmail = email.toLowerCase().trim()
        const result = this.db.prepare(
            'DELETE FROM allowed_emails WHERE email = ?'
        ).run(normalizedEmail)
        return result.changes > 0
    }

    isEmailAllowed(email: string): boolean {
        const allowedEmails = this.getAllowedEmails()
        // 如果白名单为空，允许所有
        if (allowedEmails.length === 0) {
            return true
        }
        const normalizedEmail = email.toLowerCase().trim()
        return allowedEmails.includes(normalizedEmail)
    }

    getEmailRole(email: string): UserRole | null {
        const normalizedEmail = email.toLowerCase().trim()
        const row = this.db.prepare(
            'SELECT role FROM allowed_emails WHERE email = ?'
        ).get(normalizedEmail) as { role: string } | undefined
        if (!row) return null
        return (row.role === 'operator' ? 'operator' : 'developer') as UserRole
    }

    // 项目管理
    getProjects(): Array<{ id: string; name: string; path: string; description: string | null; createdAt: number; updatedAt: number }> {
        const rows = this.db.prepare(
            'SELECT id, name, path, description, created_at, updated_at FROM projects ORDER BY name ASC'
        ).all() as Array<{ id: string; name: string; path: string; description: string | null; created_at: number; updated_at: number }>
        return rows.map(r => ({
            id: r.id,
            name: r.name,
            path: r.path,
            description: r.description,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        }))
    }

    getProject(id: string): { id: string; name: string; path: string; description: string | null; createdAt: number; updatedAt: number } | null {
        const row = this.db.prepare(
            'SELECT id, name, path, description, created_at, updated_at FROM projects WHERE id = ?'
        ).get(id) as { id: string; name: string; path: string; description: string | null; created_at: number; updated_at: number } | undefined
        if (!row) return null
        return {
            id: row.id,
            name: row.name,
            path: row.path,
            description: row.description,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }
    }

    addProject(name: string, path: string, description?: string): { id: string; name: string; path: string; description: string | null; createdAt: number; updatedAt: number } | null {
        try {
            const id = randomUUID()
            const now = Date.now()
            this.db.prepare(`
                INSERT INTO projects (id, name, path, description, created_at, updated_at)
                VALUES (@id, @name, @path, @description, @created_at, @updated_at)
            `).run({
                id,
                name: name.trim(),
                path: path.trim(),
                description: description?.trim() || null,
                created_at: now,
                updated_at: now
            })
            return this.getProject(id)
        } catch {
            return null
        }
    }

    updateProject(id: string, name: string, path: string, description?: string): { id: string; name: string; path: string; description: string | null; createdAt: number; updatedAt: number } | null {
        try {
            const now = Date.now()
            const result = this.db.prepare(`
                UPDATE projects
                SET name = @name, path = @path, description = @description, updated_at = @updated_at
                WHERE id = @id
            `).run({
                id,
                name: name.trim(),
                path: path.trim(),
                description: description?.trim() || null,
                updated_at: now
            })
            if (result.changes === 0) return null
            return this.getProject(id)
        } catch {
            return null
        }
    }

    removeProject(id: string): boolean {
        const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
        return result.changes > 0
    }

    // 角色预设 Prompt 管理
    getRolePrompt(role: UserRole): string | null {
        const row = this.db.prepare(
            'SELECT prompt FROM role_prompts WHERE role = ?'
        ).get(role) as { prompt: string } | undefined
        return row?.prompt ?? null
    }

    getAllRolePrompts(): Array<{ role: UserRole; prompt: string; updatedAt: number }> {
        const rows = this.db.prepare(
            'SELECT role, prompt, updated_at FROM role_prompts ORDER BY role ASC'
        ).all() as Array<{ role: string; prompt: string; updated_at: number }>
        return rows.map(r => ({
            role: (r.role === 'operator' ? 'operator' : 'developer') as UserRole,
            prompt: r.prompt,
            updatedAt: r.updated_at
        }))
    }

    setRolePrompt(role: UserRole, prompt: string): boolean {
        try {
            const now = Date.now()
            this.db.prepare(`
                INSERT INTO role_prompts (role, prompt, updated_at)
                VALUES (@role, @prompt, @updated_at)
                ON CONFLICT(role) DO UPDATE SET prompt = @prompt, updated_at = @updated_at
            `).run({
                role,
                prompt: prompt.trim(),
                updated_at: now
            })
            return true
        } catch {
            return false
        }
    }

    removeRolePrompt(role: UserRole): boolean {
        const result = this.db.prepare('DELETE FROM role_prompts WHERE role = ?').run(role)
        return result.changes > 0
    }

    // Push 订阅管理
    getPushSubscriptions(namespace: string): StoredPushSubscription[] {
        const rows = this.db.prepare(
            'SELECT id, namespace, endpoint, keys_p256dh, keys_auth, user_agent, client_id, chat_id, created_at, updated_at FROM push_subscriptions WHERE namespace = ? ORDER BY created_at ASC'
        ).all(namespace) as Array<{
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
        }>
        return rows.map(r => ({
            id: r.id,
            namespace: r.namespace,
            endpoint: r.endpoint,
            keys: {
                p256dh: r.keys_p256dh,
                auth: r.keys_auth
            },
            userAgent: r.user_agent,
            clientId: r.client_id,
            chatId: r.chat_id,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        }))
    }

    getPushSubscriptionsByClientId(namespace: string, clientId: string): StoredPushSubscription[] {
        const rows = this.db.prepare(
            'SELECT id, namespace, endpoint, keys_p256dh, keys_auth, user_agent, client_id, chat_id, created_at, updated_at FROM push_subscriptions WHERE namespace = ? AND client_id = ? ORDER BY created_at ASC'
        ).all(namespace, clientId) as Array<{
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
        }>
        return rows.map(r => ({
            id: r.id,
            namespace: r.namespace,
            endpoint: r.endpoint,
            keys: {
                p256dh: r.keys_p256dh,
                auth: r.keys_auth
            },
            userAgent: r.user_agent,
            clientId: r.client_id,
            chatId: r.chat_id,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        }))
    }

    getPushSubscriptionsByChatId(namespace: string, chatId: string): StoredPushSubscription[] {
        const rows = this.db.prepare(
            'SELECT id, namespace, endpoint, keys_p256dh, keys_auth, user_agent, client_id, chat_id, created_at, updated_at FROM push_subscriptions WHERE namespace = ? AND chat_id = ? ORDER BY created_at ASC'
        ).all(namespace, chatId) as Array<{
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
        }>
        return rows.map(r => ({
            id: r.id,
            namespace: r.namespace,
            endpoint: r.endpoint,
            keys: {
                p256dh: r.keys_p256dh,
                auth: r.keys_auth
            },
            userAgent: r.user_agent,
            clientId: r.client_id,
            chatId: r.chat_id,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        }))
    }

    getPushSubscriptionByEndpoint(endpoint: string): StoredPushSubscription | null {
        const row = this.db.prepare(
            'SELECT id, namespace, endpoint, keys_p256dh, keys_auth, user_agent, client_id, chat_id, created_at, updated_at FROM push_subscriptions WHERE endpoint = ?'
        ).get(endpoint) as {
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
        } | undefined
        if (!row) return null
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

    addOrUpdatePushSubscription(
        namespace: string,
        endpoint: string,
        keys: { p256dh: string; auth: string },
        userAgent?: string,
        clientId?: string,
        chatId?: string
    ): StoredPushSubscription | null {
        try {
            const now = Date.now()
            this.db.prepare(`
                INSERT INTO push_subscriptions (namespace, endpoint, keys_p256dh, keys_auth, user_agent, client_id, chat_id, created_at, updated_at)
                VALUES (@namespace, @endpoint, @keys_p256dh, @keys_auth, @user_agent, @client_id, @chat_id, @created_at, @updated_at)
                ON CONFLICT(endpoint) DO UPDATE SET
                    namespace = @namespace,
                    keys_p256dh = @keys_p256dh,
                    keys_auth = @keys_auth,
                    user_agent = @user_agent,
                    client_id = @client_id,
                    chat_id = COALESCE(@chat_id, chat_id),
                    updated_at = @updated_at
            `).run({
                namespace,
                endpoint,
                keys_p256dh: keys.p256dh,
                keys_auth: keys.auth,
                user_agent: userAgent ?? null,
                client_id: clientId ?? null,
                chat_id: chatId ?? null,
                created_at: now,
                updated_at: now
            })
            return this.getPushSubscriptionByEndpoint(endpoint)
        } catch {
            return null
        }
    }

    removePushSubscription(endpoint: string): boolean {
        const result = this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
        return result.changes > 0
    }

    removePushSubscriptionById(id: number): boolean {
        const result = this.db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id)
        return result.changes > 0
    }

    // 输入预设管理
    getAllInputPresets(): Array<{ id: string; trigger: string; title: string; prompt: string; createdAt: number; updatedAt: number }> {
        const rows = this.db.prepare(
            'SELECT id, trigger, title, prompt, created_at, updated_at FROM input_presets ORDER BY trigger ASC'
        ).all() as Array<{
            id: string
            trigger: string
            title: string
            prompt: string
            created_at: number
            updated_at: number
        }>
        return rows.map(r => ({
            id: r.id,
            trigger: r.trigger,
            title: r.title,
            prompt: r.prompt,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        }))
    }

    getInputPreset(id: string): { id: string; trigger: string; title: string; prompt: string; createdAt: number; updatedAt: number } | null {
        const row = this.db.prepare(
            'SELECT id, trigger, title, prompt, created_at, updated_at FROM input_presets WHERE id = ?'
        ).get(id) as {
            id: string
            trigger: string
            title: string
            prompt: string
            created_at: number
            updated_at: number
        } | undefined
        if (!row) return null
        return {
            id: row.id,
            trigger: row.trigger,
            title: row.title,
            prompt: row.prompt,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }
    }

    addInputPreset(trigger: string, title: string, prompt: string): { id: string; trigger: string; title: string; prompt: string; createdAt: number; updatedAt: number } | null {
        try {
            const id = randomUUID()
            const now = Date.now()
            this.db.prepare(`
                INSERT INTO input_presets (id, trigger, title, prompt, created_at, updated_at)
                VALUES (@id, @trigger, @title, @prompt, @created_at, @updated_at)
            `).run({
                id,
                trigger: trigger.trim(),
                title: title.trim(),
                prompt: prompt.trim(),
                created_at: now,
                updated_at: now
            })
            return this.getInputPreset(id)
        } catch {
            return null
        }
    }

    updateInputPreset(id: string, trigger: string, title: string, prompt: string): { id: string; trigger: string; title: string; prompt: string; createdAt: number; updatedAt: number } | null {
        try {
            const now = Date.now()
            const result = this.db.prepare(`
                UPDATE input_presets
                SET trigger = @trigger, title = @title, prompt = @prompt, updated_at = @updated_at
                WHERE id = @id
            `).run({
                id,
                trigger: trigger.trim(),
                title: title.trim(),
                prompt: prompt.trim(),
                updated_at: now
            })
            if (result.changes === 0) return null
            return this.getInputPreset(id)
        } catch {
            return null
        }
    }

    removeInputPreset(id: string): boolean {
        const result = this.db.prepare('DELETE FROM input_presets WHERE id = ?').run(id)
        return result.changes > 0
    }

    // ========== Advisor Agent 方法 ==========

    // Advisor State CRUD
    getAdvisorState(namespace: string): StoredAdvisorState | null {
        const row = this.db.prepare(
            'SELECT * FROM advisor_state WHERE namespace = ?'
        ).get(namespace) as DbAdvisorStateRow | undefined
        return row ? toStoredAdvisorState(row) : null
    }

    upsertAdvisorState(namespace: string, data: Partial<Omit<StoredAdvisorState, 'namespace' | 'updatedAt'>>): StoredAdvisorState | null {
        try {
            const now = Date.now()
            const existing = this.getAdvisorState(namespace)

            if (existing) {
                this.db.prepare(`
                    UPDATE advisor_state
                    SET advisor_session_id = @advisor_session_id,
                        machine_id = @machine_id,
                        status = @status,
                        last_seen = @last_seen,
                        config_json = @config_json,
                        updated_at = @updated_at
                    WHERE namespace = @namespace
                `).run({
                    namespace,
                    advisor_session_id: data.advisorSessionId ?? existing.advisorSessionId,
                    machine_id: data.machineId ?? existing.machineId,
                    status: data.status ?? existing.status,
                    last_seen: data.lastSeen ?? existing.lastSeen,
                    config_json: data.configJson ? JSON.stringify(data.configJson) : (existing.configJson ? JSON.stringify(existing.configJson) : null),
                    updated_at: now
                })
            } else {
                this.db.prepare(`
                    INSERT INTO advisor_state (namespace, advisor_session_id, machine_id, status, last_seen, config_json, updated_at)
                    VALUES (@namespace, @advisor_session_id, @machine_id, @status, @last_seen, @config_json, @updated_at)
                `).run({
                    namespace,
                    advisor_session_id: data.advisorSessionId ?? null,
                    machine_id: data.machineId ?? null,
                    status: data.status ?? 'idle',
                    last_seen: data.lastSeen ?? null,
                    config_json: data.configJson ? JSON.stringify(data.configJson) : null,
                    updated_at: now
                })
            }
            return this.getAdvisorState(namespace)
        } catch {
            return null
        }
    }

    // Agent Session State CRUD
    getAgentSessionState(sessionId: string): StoredAgentSessionState | null {
        const row = this.db.prepare(
            'SELECT * FROM agent_session_state WHERE session_id = ?'
        ).get(sessionId) as DbAgentSessionStateRow | undefined
        return row ? toStoredAgentSessionState(row) : null
    }

    getAgentSessionStatesByNamespace(namespace: string): StoredAgentSessionState[] {
        const rows = this.db.prepare(
            'SELECT * FROM agent_session_state WHERE namespace = ? ORDER BY updated_at DESC'
        ).all(namespace) as DbAgentSessionStateRow[]
        return rows.map(toStoredAgentSessionState)
    }

    upsertAgentSessionState(sessionId: string, namespace: string, data: Partial<Omit<StoredAgentSessionState, 'sessionId' | 'namespace' | 'updatedAt'>>): StoredAgentSessionState | null {
        try {
            const now = Date.now()
            const existing = this.getAgentSessionState(sessionId)

            if (existing) {
                this.db.prepare(`
                    UPDATE agent_session_state
                    SET last_seq = @last_seq,
                        summary = @summary,
                        context_json = @context_json,
                        updated_at = @updated_at
                    WHERE session_id = @session_id
                `).run({
                    session_id: sessionId,
                    last_seq: data.lastSeq ?? existing.lastSeq,
                    summary: data.summary ?? existing.summary,
                    context_json: data.contextJson ? JSON.stringify(data.contextJson) : (existing.contextJson ? JSON.stringify(existing.contextJson) : null),
                    updated_at: now
                })
            } else {
                this.db.prepare(`
                    INSERT INTO agent_session_state (session_id, namespace, last_seq, summary, context_json, updated_at)
                    VALUES (@session_id, @namespace, @last_seq, @summary, @context_json, @updated_at)
                `).run({
                    session_id: sessionId,
                    namespace,
                    last_seq: data.lastSeq ?? 0,
                    summary: data.summary ?? null,
                    context_json: data.contextJson ? JSON.stringify(data.contextJson) : null,
                    updated_at: now
                })
            }
            return this.getAgentSessionState(sessionId)
        } catch {
            return null
        }
    }

    deleteAgentSessionState(sessionId: string): boolean {
        const result = this.db.prepare('DELETE FROM agent_session_state WHERE session_id = ?').run(sessionId)
        return result.changes > 0
    }

    // Agent Memory CRUD
    createAgentMemory(data: {
        namespace: string
        type: MemoryType
        contentJson: unknown
        sourceRef?: string
        confidence?: number
        expiresAt?: number
    }): StoredAgentMemory | null {
        try {
            const now = Date.now()
            const result = this.db.prepare(`
                INSERT INTO agent_memory (namespace, type, content_json, source_ref, confidence, expires_at, updated_at)
                VALUES (@namespace, @type, @content_json, @source_ref, @confidence, @expires_at, @updated_at)
            `).run({
                namespace: data.namespace,
                type: data.type,
                content_json: JSON.stringify(data.contentJson),
                source_ref: data.sourceRef ?? null,
                confidence: data.confidence ?? 0.5,
                expires_at: data.expiresAt ?? null,
                updated_at: now
            })

            const id = result.lastInsertRowid as number
            return this.getAgentMemory(id)
        } catch {
            return null
        }
    }

    getAgentMemory(id: number): StoredAgentMemory | null {
        const row = this.db.prepare(
            'SELECT * FROM agent_memory WHERE id = ?'
        ).get(id) as DbAgentMemoryRow | undefined
        return row ? toStoredAgentMemory(row) : null
    }

    getAgentMemories(namespace: string, type?: MemoryType, limit: number = 100): StoredAgentMemory[] {
        const query = type
            ? 'SELECT * FROM agent_memory WHERE namespace = ? AND type = ? ORDER BY updated_at DESC LIMIT ?'
            : 'SELECT * FROM agent_memory WHERE namespace = ? ORDER BY updated_at DESC LIMIT ?'
        const params = type ? [namespace, type, limit] : [namespace, limit]
        const rows = this.db.prepare(query).all(...params) as DbAgentMemoryRow[]
        return rows.map(toStoredAgentMemory)
    }

    deleteAgentMemory(id: number): boolean {
        const result = this.db.prepare('DELETE FROM agent_memory WHERE id = ?').run(id)
        return result.changes > 0
    }

    deleteExpiredAgentMemories(namespace: string): number {
        const now = Date.now()
        const result = this.db.prepare(
            'DELETE FROM agent_memory WHERE namespace = ? AND expires_at IS NOT NULL AND expires_at < ?'
        ).run(namespace, now)
        return result.changes
    }

    // Agent Suggestions CRUD
    createAgentSuggestion(data: {
        id: string
        namespace: string
        sessionId?: string
        sourceSessionId?: string
        title: string
        detail?: string
        category?: SuggestionCategory
        severity?: SuggestionSeverity
        confidence?: number
        status?: SuggestionStatus
        targets?: string[]
        scope?: SuggestionScope
    }): StoredAgentSuggestion | null {
        try {
            const now = Date.now()
            this.db.prepare(`
                INSERT INTO agent_suggestions (id, namespace, session_id, source_session_id, title, detail, category, severity, confidence, status, targets, scope, created_at, updated_at)
                VALUES (@id, @namespace, @session_id, @source_session_id, @title, @detail, @category, @severity, @confidence, @status, @targets, @scope, @created_at, @updated_at)
            `).run({
                id: data.id,
                namespace: data.namespace,
                session_id: data.sessionId ?? null,
                source_session_id: data.sourceSessionId ?? null,
                title: data.title,
                detail: data.detail ?? null,
                category: data.category ?? null,
                severity: data.severity ?? 'low',
                confidence: data.confidence ?? 0.5,
                status: data.status ?? 'pending',
                targets: data.targets ? JSON.stringify(data.targets) : null,
                scope: data.scope ?? 'session',
                created_at: now,
                updated_at: now
            })
            return this.getAgentSuggestion(data.id)
        } catch {
            return null
        }
    }

    getAgentSuggestion(id: string): StoredAgentSuggestion | null {
        const row = this.db.prepare(
            'SELECT * FROM agent_suggestions WHERE id = ?'
        ).get(id) as DbAgentSuggestionRow | undefined
        return row ? toStoredAgentSuggestion(row) : null
    }

    getAgentSuggestions(namespace: string, filters?: {
        status?: SuggestionStatus | SuggestionStatus[]
        category?: SuggestionCategory
        sessionId?: string
        sourceSessionId?: string
        limit?: number
    }): StoredAgentSuggestion[] {
        let query = 'SELECT * FROM agent_suggestions WHERE namespace = ?'
        const params: unknown[] = [namespace]

        if (filters?.status) {
            if (Array.isArray(filters.status)) {
                query += ` AND status IN (${filters.status.map(() => '?').join(',')})`
                params.push(...filters.status)
            } else {
                query += ' AND status = ?'
                params.push(filters.status)
            }
        }

        if (filters?.category) {
            query += ' AND category = ?'
            params.push(filters.category)
        }

        if (filters?.sessionId) {
            query += ' AND session_id = ?'
            params.push(filters.sessionId)
        }

        if (filters?.sourceSessionId) {
            query += ' AND source_session_id = ?'
            params.push(filters.sourceSessionId)
        }

        query += ' ORDER BY created_at DESC'

        if (filters?.limit) {
            query += ' LIMIT ?'
            params.push(filters.limit)
        }

        const rows = this.db.prepare(query).all(...(params as (string | number)[])) as DbAgentSuggestionRow[]
        return rows.map(toStoredAgentSuggestion)
    }

    updateAgentSuggestionStatus(id: string, status: SuggestionStatus): boolean {
        const now = Date.now()
        const result = this.db.prepare(
            'UPDATE agent_suggestions SET status = ?, updated_at = ? WHERE id = ?'
        ).run(status, now, id)
        return result.changes > 0
    }

    deleteAgentSuggestion(id: string): boolean {
        const result = this.db.prepare('DELETE FROM agent_suggestions WHERE id = ?').run(id)
        return result.changes > 0
    }

    // Agent Feedback CRUD
    createAgentFeedback(data: {
        suggestionId: string
        source: FeedbackSource
        userId?: string
        action: FeedbackAction
        evidenceJson?: unknown
        comment?: string
    }): StoredAgentFeedback | null {
        try {
            const now = Date.now()
            const result = this.db.prepare(`
                INSERT INTO agent_feedback (suggestion_id, source, user_id, action, evidence_json, comment, created_at)
                VALUES (@suggestion_id, @source, @user_id, @action, @evidence_json, @comment, @created_at)
            `).run({
                suggestion_id: data.suggestionId,
                source: data.source,
                user_id: data.userId ?? null,
                action: data.action,
                evidence_json: data.evidenceJson ? JSON.stringify(data.evidenceJson) : null,
                comment: data.comment ?? null,
                created_at: now
            })

            const id = result.lastInsertRowid as number
            return this.getAgentFeedback(id)
        } catch {
            return null
        }
    }

    getAgentFeedback(id: number): StoredAgentFeedback | null {
        const row = this.db.prepare(
            'SELECT * FROM agent_feedback WHERE id = ?'
        ).get(id) as DbAgentFeedbackRow | undefined
        return row ? toStoredAgentFeedback(row) : null
    }

    getAgentFeedbackBySuggestion(suggestionId: string): StoredAgentFeedback[] {
        const rows = this.db.prepare(
            'SELECT * FROM agent_feedback WHERE suggestion_id = ? ORDER BY created_at ASC'
        ).all(suggestionId) as DbAgentFeedbackRow[]
        return rows.map(toStoredAgentFeedback)
    }

    // ========== Auto-Iteration Config CRUD ==========

    getAutoIterationConfig(namespace: string): StoredAutoIterationConfig | null {
        const row = this.db.prepare(
            'SELECT * FROM auto_iteration_config WHERE namespace = ?'
        ).get(namespace) as DbAutoIterationConfigRow | undefined
        return row ? toStoredAutoIterationConfig(row) : null
    }

    upsertAutoIterationConfig(namespace: string, data: {
        enabled?: boolean
        policyJson?: Partial<Record<AutoIterActionType, AutoIterExecutionPolicy>>
        allowedProjects?: string[]
        notificationLevel?: AutoIterNotificationLevel
        keepLogsDays?: number
        updatedBy?: string
    }): StoredAutoIterationConfig | null {
        try {
            const now = Date.now()
            // Get raw row for existing values
            const existingRow = this.db.prepare(
                'SELECT * FROM auto_iteration_config WHERE namespace = ?'
            ).get(namespace) as DbAutoIterationConfigRow | undefined

            if (existingRow) {
                // Update - build complete params object with proper types for DB
                this.db.prepare(`
                    UPDATE auto_iteration_config
                    SET updated_at = ?,
                        enabled = ?,
                        policy_json = ?,
                        allowed_projects = ?,
                        notification_level = ?,
                        keep_logs_days = ?,
                        updated_by = ?
                    WHERE namespace = ?
                `).run(
                    now,
                    data.enabled !== undefined ? (data.enabled ? 1 : 0) : existingRow.enabled,
                    data.policyJson !== undefined ? JSON.stringify(data.policyJson) : existingRow.policy_json,
                    data.allowedProjects !== undefined ? JSON.stringify(data.allowedProjects) : existingRow.allowed_projects,
                    data.notificationLevel ?? existingRow.notification_level,
                    data.keepLogsDays ?? existingRow.keep_logs_days,
                    data.updatedBy ?? existingRow.updated_by ?? null,
                    namespace
                )
            } else {
                // Insert
                this.db.prepare(`
                    INSERT INTO auto_iteration_config (
                        namespace, enabled, policy_json, allowed_projects,
                        notification_level, keep_logs_days, created_at, updated_at, updated_by
                    ) VALUES (
                        @namespace, @enabled, @policy_json, @allowed_projects,
                        @notification_level, @keep_logs_days, @created_at, @updated_at, @updated_by
                    )
                `).run({
                    namespace,
                    enabled: data.enabled ? 1 : 0,
                    policy_json: data.policyJson ? JSON.stringify(data.policyJson) : null,
                    allowed_projects: JSON.stringify(data.allowedProjects ?? []),
                    notification_level: data.notificationLevel ?? 'all',
                    keep_logs_days: data.keepLogsDays ?? 30,
                    created_at: now,
                    updated_at: now,
                    updated_by: data.updatedBy ?? null
                })
            }

            return this.getAutoIterationConfig(namespace)
        } catch {
            return null
        }
    }

    // ========== Auto-Iteration Log CRUD ==========

    createAutoIterationLog(data: {
        id: string
        namespace: string
        sourceSuggestionId?: string
        sourceSessionId?: string
        projectPath?: string
        actionType: AutoIterActionType
        actionDetail?: unknown
        reason?: string
    }): StoredAutoIterationLog | null {
        try {
            const now = Date.now()
            this.db.prepare(`
                INSERT INTO auto_iteration_logs (
                    id, namespace, source_suggestion_id, source_session_id,
                    project_path, action_type, action_detail, reason,
                    execution_status, created_at
                ) VALUES (
                    @id, @namespace, @source_suggestion_id, @source_session_id,
                    @project_path, @action_type, @action_detail, @reason,
                    'pending', @created_at
                )
            `).run({
                id: data.id,
                namespace: data.namespace,
                source_suggestion_id: data.sourceSuggestionId ?? null,
                source_session_id: data.sourceSessionId ?? null,
                project_path: data.projectPath ?? null,
                action_type: data.actionType,
                action_detail: data.actionDetail ? JSON.stringify(data.actionDetail) : null,
                reason: data.reason ?? null,
                created_at: now
            })

            return this.getAutoIterationLog(data.id)
        } catch {
            return null
        }
    }

    getAutoIterationLog(id: string): StoredAutoIterationLog | null {
        const row = this.db.prepare(
            'SELECT * FROM auto_iteration_logs WHERE id = ?'
        ).get(id) as DbAutoIterationLogRow | undefined
        return row ? toStoredAutoIterationLog(row) : null
    }

    getAutoIterationLogs(namespace: string, filters?: {
        status?: AutoIterExecutionStatus | AutoIterExecutionStatus[]
        actionType?: AutoIterActionType
        projectPath?: string
        limit?: number
        offset?: number
    }): StoredAutoIterationLog[] {
        let query = 'SELECT * FROM auto_iteration_logs WHERE namespace = ?'
        const params: unknown[] = [namespace]

        if (filters?.status) {
            if (Array.isArray(filters.status)) {
                query += ` AND execution_status IN (${filters.status.map(() => '?').join(',')})`
                params.push(...filters.status)
            } else {
                query += ' AND execution_status = ?'
                params.push(filters.status)
            }
        }

        if (filters?.actionType) {
            query += ' AND action_type = ?'
            params.push(filters.actionType)
        }

        if (filters?.projectPath) {
            query += ' AND project_path = ?'
            params.push(filters.projectPath)
        }

        query += ' ORDER BY created_at DESC'

        if (filters?.limit) {
            query += ' LIMIT ?'
            params.push(filters.limit)
        }

        if (filters?.offset) {
            query += ' OFFSET ?'
            params.push(filters.offset)
        }

        const rows = this.db.prepare(query).all(...(params as (string | number)[])) as DbAutoIterationLogRow[]
        return rows.map(toStoredAutoIterationLog)
    }

    updateAutoIterationLog(id: string, data: {
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
    }): boolean {
        try {
            const updates: string[] = []

            if (data.executionStatus !== undefined) {
                updates.push('execution_status = ?')
            }
            if (data.approvalMethod !== undefined) {
                updates.push('approval_method = ?')
            }
            if (data.approvedBy !== undefined) {
                updates.push('approved_by = ?')
            }
            if (data.approvedAt !== undefined) {
                updates.push('approved_at = ?')
            }
            if (data.resultJson !== undefined) {
                updates.push('result_json = ?')
            }
            if (data.errorMessage !== undefined) {
                updates.push('error_message = ?')
            }
            if (data.rollbackAvailable !== undefined) {
                updates.push('rollback_available = ?')
            }
            if (data.rollbackData !== undefined) {
                updates.push('rollback_data = ?')
            }
            if (data.rolledBack !== undefined) {
                updates.push('rolled_back = ?')
            }
            if (data.rolledBackAt !== undefined) {
                updates.push('rolled_back_at = ?')
            }
            if (data.executedAt !== undefined) {
                updates.push('executed_at = ?')
            }

            if (updates.length === 0) return true

            // Build positional params array in same order as updates
            const params: (string | number | null)[] = []
            if (data.executionStatus !== undefined) params.push(data.executionStatus)
            if (data.approvalMethod !== undefined) params.push(data.approvalMethod)
            if (data.approvedBy !== undefined) params.push(data.approvedBy)
            if (data.approvedAt !== undefined) params.push(data.approvedAt)
            if (data.resultJson !== undefined) params.push(JSON.stringify(data.resultJson))
            if (data.errorMessage !== undefined) params.push(data.errorMessage)
            if (data.rollbackAvailable !== undefined) params.push(data.rollbackAvailable ? 1 : 0)
            if (data.rollbackData !== undefined) params.push(JSON.stringify(data.rollbackData))
            if (data.rolledBack !== undefined) params.push(data.rolledBack ? 1 : 0)
            if (data.rolledBackAt !== undefined) params.push(data.rolledBackAt)
            if (data.executedAt !== undefined) params.push(data.executedAt)
            params.push(id) // WHERE id = ?

            const result = this.db.prepare(`
                UPDATE auto_iteration_logs
                SET ${updates.join(', ')}
                WHERE id = ?
            `).run(...params)

            return result.changes > 0
        } catch {
            return false
        }
    }

    deleteAutoIterationLog(id: string): boolean {
        const result = this.db.prepare('DELETE FROM auto_iteration_logs WHERE id = ?').run(id)
        return result.changes > 0
    }

    cleanupOldAutoIterationLogs(namespace: string, keepDays: number): number {
        const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000
        const result = this.db.prepare(
            'DELETE FROM auto_iteration_logs WHERE namespace = ? AND created_at < ?'
        ).run(namespace, cutoff)
        return result.changes
    }

    // ==================== Session Auto-Iteration Config ====================

    getSessionAutoIterConfig(sessionId: string): StoredSessionAutoIterConfig | null {
        const row = this.db.prepare(
            'SELECT * FROM session_auto_iter_config WHERE session_id = ?'
        ).get(sessionId) as DbSessionAutoIterConfigRow | undefined
        return row ? toStoredSessionAutoIterConfig(row) : null
    }

    isSessionAutoIterEnabled(sessionId: string): boolean {
        const config = this.getSessionAutoIterConfig(sessionId)
        // Default to true if no config exists
        return config ? config.autoIterEnabled : true
    }

    setSessionAutoIterEnabled(sessionId: string, enabled: boolean): StoredSessionAutoIterConfig | null {
        const now = Date.now()
        this.db.prepare(`
            INSERT INTO session_auto_iter_config (session_id, auto_iter_enabled, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
                auto_iter_enabled = excluded.auto_iter_enabled,
                updated_at = excluded.updated_at
        `).run(sessionId, enabled ? 1 : 0, now)

        return this.getSessionAutoIterConfig(sessionId)
    }

    // ==================== Agent Group CRUD ====================

    createAgentGroup(
        namespace: string,
        name: string,
        type: AgentGroupType = 'collaboration',
        description?: string
    ): StoredAgentGroup {
        const now = Date.now()
        const id = randomUUID()

        this.db.prepare(`
            INSERT INTO agent_groups (id, namespace, name, description, type, created_at, updated_at, status)
            VALUES (@id, @namespace, @name, @description, @type, @created_at, @updated_at, 'active')
        `).run({
            id,
            namespace,
            name,
            description: description ?? null,
            type,
            created_at: now,
            updated_at: now
        })

        const group = this.getAgentGroup(id)
        if (!group) {
            throw new Error('Failed to create agent group')
        }
        return group
    }

    getAgentGroup(id: string): StoredAgentGroup | null {
        const row = this.db.prepare(
            'SELECT * FROM agent_groups WHERE id = ?'
        ).get(id) as DbAgentGroupRow | undefined
        return row ? toStoredAgentGroup(row) : null
    }

    getAgentGroups(namespace: string): StoredAgentGroup[] {
        const rows = this.db.prepare(
            'SELECT * FROM agent_groups WHERE namespace = ? ORDER BY updated_at DESC'
        ).all(namespace) as DbAgentGroupRow[]
        return rows.map(toStoredAgentGroup)
    }

    getAgentGroupsWithLastMessage(namespace: string): StoredAgentGroupWithLastMessage[] {
        // 使用一个更优化的查询来获取带最后消息的群组列表
        const rows = this.db.prepare(`
            SELECT
                g.*,
                (SELECT COUNT(*) FROM agent_group_members WHERE group_id = g.id) as member_count,
                m.content as last_message_content,
                m.sender_type as last_message_sender_type,
                m.created_at as last_message_created_at
            FROM agent_groups g
            LEFT JOIN (
                SELECT group_id, content, sender_type, created_at
                FROM agent_group_messages m1
                WHERE created_at = (
                    SELECT MAX(created_at)
                    FROM agent_group_messages m2
                    WHERE m2.group_id = m1.group_id
                )
            ) m ON m.group_id = g.id
            WHERE g.namespace = ?
            ORDER BY COALESCE(m.created_at, g.updated_at) DESC
        `).all(namespace) as Array<DbAgentGroupRow & {
            member_count: number
            last_message_content: string | null
            last_message_sender_type: string | null
            last_message_created_at: number | null
        }>

        return rows.map(row => ({
            ...toStoredAgentGroup(row),
            memberCount: row.member_count,
            lastMessage: row.last_message_content ? {
                content: row.last_message_content,
                senderType: row.last_message_sender_type as GroupSenderType,
                createdAt: row.last_message_created_at!
            } : null
        }))
    }

    updateAgentGroupStatus(id: string, status: AgentGroupStatus): void {
        const now = Date.now()
        this.db.prepare(
            'UPDATE agent_groups SET status = ?, updated_at = ? WHERE id = ?'
        ).run(status, now, id)
    }

    deleteAgentGroup(id: string): void {
        this.db.prepare('DELETE FROM agent_groups WHERE id = ?').run(id)
    }

    // ==================== Agent Group Members ====================

    addGroupMember(
        groupId: string,
        sessionId: string,
        role: GroupMemberRole = 'member',
        agentType?: string
    ): void {
        const now = Date.now()
        this.db.prepare(`
            INSERT OR REPLACE INTO agent_group_members (group_id, session_id, role, agent_type, joined_at)
            VALUES (@group_id, @session_id, @role, @agent_type, @joined_at)
        `).run({
            group_id: groupId,
            session_id: sessionId,
            role,
            agent_type: agentType ?? null,
            joined_at: now
        })

        // Update group updated_at
        this.db.prepare(
            'UPDATE agent_groups SET updated_at = ? WHERE id = ?'
        ).run(now, groupId)
    }

    removeGroupMember(groupId: string, sessionId: string): void {
        this.db.prepare(
            'DELETE FROM agent_group_members WHERE group_id = ? AND session_id = ?'
        ).run(groupId, sessionId)

        const now = Date.now()
        this.db.prepare(
            'UPDATE agent_groups SET updated_at = ? WHERE id = ?'
        ).run(now, groupId)
    }

    getGroupMembers(groupId: string): StoredAgentGroupMember[] {
        const rows = this.db.prepare(
            'SELECT * FROM agent_group_members WHERE group_id = ? ORDER BY joined_at ASC'
        ).all(groupId) as DbAgentGroupMemberRow[]
        return rows.map(toStoredAgentGroupMember)
    }

    getSessionGroups(sessionId: string): StoredAgentGroup[] {
        const rows = this.db.prepare(`
            SELECT g.* FROM agent_groups g
            INNER JOIN agent_group_members m ON g.id = m.group_id
            WHERE m.session_id = ?
            ORDER BY g.updated_at DESC
        `).all(sessionId) as DbAgentGroupRow[]
        return rows.map(toStoredAgentGroup)
    }

    /**
     * 获取 session 所属的活跃群组（status = 'active'）
     * 用于 AI 回复消息时同步到群组
     */
    getGroupsForSession(sessionId: string): StoredAgentGroup[] {
        console.log(`[Store] getGroupsForSession called with sessionId: ${sessionId}`)

        // 先检查 session 是否在任何群组成员表中
        const memberRows = this.db.prepare(`
            SELECT m.*, g.name as group_name, g.status as group_status
            FROM agent_group_members m
            LEFT JOIN agent_groups g ON g.id = m.group_id
            WHERE m.session_id = ?
        `).all(sessionId) as Array<{ group_id: string; session_id: string; group_name: string | null; group_status: string | null }>
        console.log(`[Store] Session ${sessionId} is member of ${memberRows.length} groups:`, memberRows.map(r => ({ groupId: r.group_id, groupName: r.group_name, groupStatus: r.group_status })))

        const rows = this.db.prepare(`
            SELECT g.* FROM agent_groups g
            INNER JOIN agent_group_members m ON g.id = m.group_id
            WHERE m.session_id = ? AND g.status = 'active'
        `).all(sessionId) as DbAgentGroupRow[]
        console.log(`[Store] Found ${rows.length} active groups for session ${sessionId}`)
        return rows.map(toStoredAgentGroup)
    }

    // ==================== Agent Group Messages ====================

    addGroupMessage(
        groupId: string,
        sourceSessionId: string | null,
        content: string,
        senderType: GroupSenderType = 'agent',
        messageType: GroupMessageType = 'chat'
    ): StoredAgentGroupMessage {
        const now = Date.now()
        const id = randomUUID()

        this.db.prepare(`
            INSERT INTO agent_group_messages (id, group_id, source_session_id, sender_type, content, message_type, created_at)
            VALUES (@id, @group_id, @source_session_id, @sender_type, @content, @message_type, @created_at)
        `).run({
            id,
            group_id: groupId,
            source_session_id: sourceSessionId,
            sender_type: senderType,
            content,
            message_type: messageType,
            created_at: now
        })

        // Update group updated_at
        this.db.prepare(
            'UPDATE agent_groups SET updated_at = ? WHERE id = ?'
        ).run(now, groupId)

        const message = this.db.prepare(
            'SELECT * FROM agent_group_messages WHERE id = ?'
        ).get(id) as DbAgentGroupMessageRow | undefined

        if (!message) {
            throw new Error('Failed to create group message')
        }
        return toStoredAgentGroupMessage(message)
    }

    getGroupMessages(groupId: string, limit: number = 100, beforeId?: string): StoredAgentGroupMessage[] {
        const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, limit)) : 100

        if (beforeId) {
            const beforeRow = this.db.prepare(
                'SELECT created_at FROM agent_group_messages WHERE id = ?'
            ).get(beforeId) as { created_at: number } | undefined

            if (beforeRow) {
                const rows = this.db.prepare(`
                    SELECT * FROM agent_group_messages
                    WHERE group_id = ? AND created_at < ?
                    ORDER BY created_at DESC
                    LIMIT ?
                `).all(groupId, beforeRow.created_at, safeLimit) as DbAgentGroupMessageRow[]
                return rows.reverse().map(toStoredAgentGroupMessage)
            }
        }

        const rows = this.db.prepare(`
            SELECT * FROM agent_group_messages
            WHERE group_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        `).all(groupId, safeLimit) as DbAgentGroupMessageRow[]
        return rows.reverse().map(toStoredAgentGroupMessage)
    }

    // ==================== Session Creator Chat ID ====================

    setSessionCreatorChatId(sessionId: string, chatId: string, namespace: string): boolean {
        try {
            const now = Date.now()
            const result = this.db.prepare(`
                UPDATE sessions
                SET creator_chat_id = @creator_chat_id,
                    updated_at = @updated_at,
                    seq = seq + 1
                WHERE id = @id AND namespace = @namespace
            `).run({ id: sessionId, creator_chat_id: chatId, updated_at: now, namespace })
            return result.changes === 1
        } catch {
            return false
        }
    }

    getSessionCreatorChatId(sessionId: string): string | null {
        const row = this.db.prepare(
            'SELECT creator_chat_id FROM sessions WHERE id = ?'
        ).get(sessionId) as { creator_chat_id: string | null } | undefined
        return row?.creator_chat_id ?? null
    }

    clearSessionCreatorChatId(sessionId: string, namespace: string): boolean {
        try {
            const now = Date.now()
            const result = this.db.prepare(`
                UPDATE sessions
                SET creator_chat_id = NULL,
                    updated_at = @updated_at,
                    seq = seq + 1
                WHERE id = @id AND namespace = @namespace
            `).run({ id: sessionId, updated_at: now, namespace })
            return result.changes === 1
        } catch {
            return false
        }
    }

    // ==================== Session Notification Subscriptions ====================

    /**
     * 通过 chatId 订阅（Telegram 用户）
     */
    subscribeToSessionNotifications(sessionId: string, chatId: string, namespace: string): StoredSessionNotificationSubscription | null {
        try {
            this.db.prepare(`
                INSERT OR REPLACE INTO session_notification_subscriptions (session_id, chat_id, client_id, namespace, subscribed_at)
                VALUES (?, ?, NULL, ?, ?)
            `).run(sessionId, chatId, namespace, Date.now())
            return this.getSessionNotificationSubscription(sessionId, chatId)
        } catch {
            return null
        }
    }

    /**
     * 通过 clientId 订阅（非 Telegram 用户）
     */
    subscribeToSessionNotificationsByClientId(sessionId: string, clientId: string, namespace: string): StoredSessionNotificationSubscription | null {
        try {
            this.db.prepare(`
                INSERT OR REPLACE INTO session_notification_subscriptions (session_id, chat_id, client_id, namespace, subscribed_at)
                VALUES (?, NULL, ?, ?, ?)
            `).run(sessionId, clientId, namespace, Date.now())
            return this.getSessionNotificationSubscriptionByClientId(sessionId, clientId)
        } catch {
            return null
        }
    }

    unsubscribeFromSessionNotifications(sessionId: string, chatId: string): boolean {
        try {
            const result = this.db.prepare(
                'DELETE FROM session_notification_subscriptions WHERE session_id = ? AND chat_id = ?'
            ).run(sessionId, chatId)
            return result.changes > 0
        } catch {
            return false
        }
    }

    unsubscribeFromSessionNotificationsByClientId(sessionId: string, clientId: string): boolean {
        try {
            const result = this.db.prepare(
                'DELETE FROM session_notification_subscriptions WHERE session_id = ? AND client_id = ?'
            ).run(sessionId, clientId)
            return result.changes > 0
        } catch {
            return false
        }
    }

    getSessionNotificationSubscription(sessionId: string, chatId: string): StoredSessionNotificationSubscription | null {
        const row = this.db.prepare(
            'SELECT * FROM session_notification_subscriptions WHERE session_id = ? AND chat_id = ?'
        ).get(sessionId, chatId) as { id: number; session_id: string; chat_id: string | null; client_id: string | null; namespace: string; subscribed_at: number } | undefined
        if (!row) return null
        return {
            id: row.id,
            sessionId: row.session_id,
            chatId: row.chat_id,
            clientId: row.client_id,
            namespace: row.namespace,
            subscribedAt: row.subscribed_at
        }
    }

    getSessionNotificationSubscriptionByClientId(sessionId: string, clientId: string): StoredSessionNotificationSubscription | null {
        const row = this.db.prepare(
            'SELECT * FROM session_notification_subscriptions WHERE session_id = ? AND client_id = ?'
        ).get(sessionId, clientId) as { id: number; session_id: string; chat_id: string | null; client_id: string | null; namespace: string; subscribed_at: number } | undefined
        if (!row) return null
        return {
            id: row.id,
            sessionId: row.session_id,
            chatId: row.chat_id,
            clientId: row.client_id,
            namespace: row.namespace,
            subscribedAt: row.subscribed_at
        }
    }

    getSessionNotificationSubscribers(sessionId: string): string[] {
        const rows = this.db.prepare(
            'SELECT chat_id FROM session_notification_subscriptions WHERE session_id = ? AND chat_id IS NOT NULL'
        ).all(sessionId) as Array<{ chat_id: string }>
        return rows.map(r => r.chat_id)
    }

    getSessionNotificationSubscriberClientIds(sessionId: string): string[] {
        const rows = this.db.prepare(
            'SELECT client_id FROM session_notification_subscriptions WHERE session_id = ? AND client_id IS NOT NULL'
        ).all(sessionId) as Array<{ client_id: string }>
        return rows.map(r => r.client_id)
    }

    getSubscribedSessionsForChat(chatId: string): string[] {
        const rows = this.db.prepare(
            'SELECT session_id FROM session_notification_subscriptions WHERE chat_id = ?'
        ).all(chatId) as Array<{ session_id: string }>
        return rows.map(r => r.session_id)
    }

    getSubscribedSessionsForClient(clientId: string): string[] {
        const rows = this.db.prepare(
            'SELECT session_id FROM session_notification_subscriptions WHERE client_id = ?'
        ).all(clientId) as Array<{ session_id: string }>
        return rows.map(r => r.session_id)
    }

    /**
     * 获取应该接收 session 通知的所有 chatId
     * 包括：session 创建者 + 所有订阅者（去重）
     */
    getSessionNotificationRecipients(sessionId: string): string[] {
        const session = this.getSession(sessionId)
        const recipients = new Set<string>()

        // 添加创建者
        if (session?.creatorChatId) {
            recipients.add(session.creatorChatId)
        }

        // 添加订阅者（通过 chatId）
        const subscribers = this.getSessionNotificationSubscribers(sessionId)
        for (const chatId of subscribers) {
            recipients.add(chatId)
        }

        return Array.from(recipients)
    }

    /**
     * 获取应该接收 session 通知的所有 clientId
     * 包括通过 clientId 订阅的用户
     */
    getSessionNotificationRecipientClientIds(sessionId: string): string[] {
        return this.getSessionNotificationSubscriberClientIds(sessionId)
    }

    // ==================== AI Profiles ====================

    /**
     * 获取 namespace 下所有 AI 员工档案
     */
    getAIProfiles(namespace: string): StoredAIProfile[] {
        const rows = this.db.prepare(
            'SELECT * FROM ai_profiles WHERE namespace = ? ORDER BY created_at ASC'
        ).all(namespace) as DbAIProfileRow[]
        return rows.map(toStoredAIProfile)
    }

    /**
     * 通过 ID 获取 AI 员工档案
     */
    getAIProfile(id: string): StoredAIProfile | null {
        const row = this.db.prepare(
            'SELECT * FROM ai_profiles WHERE id = ?'
        ).get(id) as DbAIProfileRow | undefined
        return row ? toStoredAIProfile(row) : null
    }

    /**
     * 通过名称获取 AI 员工档案
     */
    getAIProfileByName(namespace: string, name: string): StoredAIProfile | null {
        const row = this.db.prepare(
            'SELECT * FROM ai_profiles WHERE namespace = ? AND name = ?'
        ).get(namespace, name) as DbAIProfileRow | undefined
        return row ? toStoredAIProfile(row) : null
    }

    /**
     * 创建 AI 员工档案
     */
    createAIProfile(
        namespace: string,
        data: Omit<StoredAIProfile, 'id' | 'namespace' | 'createdAt' | 'updatedAt'>
    ): StoredAIProfile {
        const id = randomUUID()
        const now = Date.now()

        this.db.prepare(`
            INSERT INTO ai_profiles (
                id, namespace, name, role, specialties, personality,
                greeting_template, preferred_projects, work_style,
                avatar_emoji, status, stats_json, created_at, updated_at
            ) VALUES (
                @id, @namespace, @name, @role, @specialties, @personality,
                @greeting_template, @preferred_projects, @work_style,
                @avatar_emoji, @status, @stats_json, @created_at, @updated_at
            )
        `).run({
            id,
            namespace,
            name: data.name,
            role: data.role,
            specialties: JSON.stringify(data.specialties),
            personality: data.personality,
            greeting_template: data.greetingTemplate,
            preferred_projects: JSON.stringify(data.preferredProjects),
            work_style: data.workStyle,
            avatar_emoji: data.avatarEmoji,
            status: data.status,
            stats_json: JSON.stringify(data.stats),
            created_at: now,
            updated_at: now
        })

        const profile = this.getAIProfile(id)
        if (!profile) {
            throw new Error('Failed to create AI profile')
        }
        return profile
    }

    /**
     * 更新 AI 员工档案
     */
    updateAIProfile(id: string, data: Partial<StoredAIProfile>): StoredAIProfile | null {
        const existing = this.getAIProfile(id)
        if (!existing) {
            return null
        }

        const now = Date.now()
        const updates: string[] = ['updated_at = @updated_at']
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: Record<string, any> = { id, updated_at: now }

        if (data.name !== undefined) {
            updates.push('name = @name')
            params.name = data.name
        }
        if (data.role !== undefined) {
            updates.push('role = @role')
            params.role = data.role
        }
        if (data.specialties !== undefined) {
            updates.push('specialties = @specialties')
            params.specialties = JSON.stringify(data.specialties)
        }
        if (data.personality !== undefined) {
            updates.push('personality = @personality')
            params.personality = data.personality
        }
        if (data.greetingTemplate !== undefined) {
            updates.push('greeting_template = @greeting_template')
            params.greeting_template = data.greetingTemplate
        }
        if (data.preferredProjects !== undefined) {
            updates.push('preferred_projects = @preferred_projects')
            params.preferred_projects = JSON.stringify(data.preferredProjects)
        }
        if (data.workStyle !== undefined) {
            updates.push('work_style = @work_style')
            params.work_style = data.workStyle
        }
        if (data.avatarEmoji !== undefined) {
            updates.push('avatar_emoji = @avatar_emoji')
            params.avatar_emoji = data.avatarEmoji
        }
        if (data.status !== undefined) {
            updates.push('status = @status')
            params.status = data.status
        }
        if (data.stats !== undefined) {
            updates.push('stats_json = @stats_json')
            params.stats_json = JSON.stringify(data.stats)
        }

        this.db.prepare(`
            UPDATE ai_profiles SET ${updates.join(', ')} WHERE id = @id
        `).run(params)

        return this.getAIProfile(id)
    }

    /**
     * 删除 AI 员工档案
     */
    deleteAIProfile(id: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM ai_profiles WHERE id = ?'
        ).run(id)
        return result.changes > 0
    }

    /**
     * 更新 AI 员工状态
     */
    updateAIProfileStatus(id: string, status: AIProfileStatus): void {
        const now = Date.now()
        this.db.prepare(`
            UPDATE ai_profiles SET status = @status, updated_at = @updated_at WHERE id = @id
        `).run({ id, status, updated_at: now })
    }

    /**
     * 更新 AI 员工统计数据
     */
    updateAIProfileStats(id: string, stats: Partial<StoredAIProfile['stats']>): void {
        const existing = this.getAIProfile(id)
        if (!existing) {
            return
        }

        const now = Date.now()
        const mergedStats = {
            ...existing.stats,
            ...stats
        }

        this.db.prepare(`
            UPDATE ai_profiles SET stats_json = @stats_json, updated_at = @updated_at WHERE id = @id
        `).run({
            id,
            stats_json: JSON.stringify(mergedStats),
            updated_at: now
        })
    }

    // ===========================================
    // AI Profile Memory 方法
    // ===========================================

    /**
     * 创建 AI Profile 记忆
     */
    createProfileMemory(
        namespace: string,
        profileId: string,
        memory: {
            memoryType: AIProfileMemoryType
            content: string
            importance?: number
            expiresAt?: number | null
            metadata?: unknown
        }
    ): StoredAIProfileMemory {
        const id = randomUUID()
        const now = Date.now()

        this.db.prepare(`
            INSERT INTO ai_profile_memories (
                id, namespace, profile_id, memory_type, content,
                importance, access_count, last_accessed_at, expires_at,
                created_at, updated_at, metadata
            ) VALUES (
                @id, @namespace, @profile_id, @memory_type, @content,
                @importance, @access_count, @last_accessed_at, @expires_at,
                @created_at, @updated_at, @metadata
            )
        `).run({
            id,
            namespace,
            profile_id: profileId,
            memory_type: memory.memoryType,
            content: memory.content,
            importance: memory.importance ?? 0.5,
            access_count: 0,
            last_accessed_at: null,
            expires_at: memory.expiresAt ?? null,
            created_at: now,
            updated_at: now,
            metadata: memory.metadata ? JSON.stringify(memory.metadata) : null
        })

        const row = this.db.prepare(
            'SELECT * FROM ai_profile_memories WHERE id = ?'
        ).get(id) as DbAIProfileMemoryRow

        return toStoredAIProfileMemory(row)
    }

    /**
     * 获取 AI Profile 的记忆列表
     */
    getProfileMemories(
        namespace: string,
        profileId: string,
        options?: {
            type?: AIProfileMemoryType
            limit?: number
            minImportance?: number
        }
    ): StoredAIProfileMemory[] {
        let sql = 'SELECT * FROM ai_profile_memories WHERE namespace = ? AND profile_id = ?'
        const params: (string | number)[] = [namespace, profileId]

        if (options?.type) {
            sql += ' AND memory_type = ?'
            params.push(options.type)
        }

        if (options?.minImportance !== undefined) {
            sql += ' AND importance >= ?'
            params.push(options.minImportance)
        }

        // 排除已过期的记忆
        sql += ' AND (expires_at IS NULL OR expires_at > ?)'
        params.push(Date.now())

        sql += ' ORDER BY importance DESC, last_accessed_at DESC NULLS LAST, created_at DESC'

        if (options?.limit) {
            sql += ' LIMIT ?'
            params.push(options.limit)
        }

        const rows = this.db.prepare(sql).all(...params) as DbAIProfileMemoryRow[]
        return rows.map(toStoredAIProfileMemory)
    }

    /**
     * 通过 ID 获取单个记忆
     */
    getProfileMemory(id: string): StoredAIProfileMemory | null {
        const row = this.db.prepare(
            'SELECT * FROM ai_profile_memories WHERE id = ?'
        ).get(id) as DbAIProfileMemoryRow | undefined
        return row ? toStoredAIProfileMemory(row) : null
    }

    /**
     * 更新记忆的访问计数和最后访问时间
     */
    updateMemoryAccess(namespace: string, memoryId: string): void {
        const now = Date.now()
        this.db.prepare(`
            UPDATE ai_profile_memories
            SET access_count = access_count + 1,
                last_accessed_at = @now,
                updated_at = @now
            WHERE id = @id AND namespace = @namespace
        `).run({
            id: memoryId,
            namespace,
            now
        })
    }

    /**
     * 更新记忆内容和重要性
     */
    updateProfileMemory(
        id: string,
        data: Partial<{
            content: string
            importance: number
            expiresAt: number | null
            metadata: unknown
        }>
    ): StoredAIProfileMemory | null {
        const existing = this.getProfileMemory(id)
        if (!existing) {
            return null
        }

        const now = Date.now()
        const updates: string[] = ['updated_at = @updated_at']
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: Record<string, any> = { id, updated_at: now }

        if (data.content !== undefined) {
            updates.push('content = @content')
            params.content = data.content
        }
        if (data.importance !== undefined) {
            updates.push('importance = @importance')
            params.importance = data.importance
        }
        if (data.expiresAt !== undefined) {
            updates.push('expires_at = @expires_at')
            params.expires_at = data.expiresAt
        }
        if (data.metadata !== undefined) {
            updates.push('metadata = @metadata')
            params.metadata = data.metadata ? JSON.stringify(data.metadata) : null
        }

        this.db.prepare(`
            UPDATE ai_profile_memories SET ${updates.join(', ')} WHERE id = @id
        `).run(params)

        return this.getProfileMemory(id)
    }

    /**
     * 删除过期的记忆
     */
    deleteExpiredMemories(namespace: string): number {
        const now = Date.now()
        const result = this.db.prepare(
            'DELETE FROM ai_profile_memories WHERE namespace = ? AND expires_at IS NOT NULL AND expires_at <= ?'
        ).run(namespace, now)
        return result.changes
    }

    /**
     * 删除 Profile 的所有记忆
     */
    deleteProfileMemories(namespace: string, profileId: string): number {
        const result = this.db.prepare(
            'DELETE FROM ai_profile_memories WHERE namespace = ? AND profile_id = ?'
        ).run(namespace, profileId)
        return result.changes
    }

    /**
     * 删除单个记忆
     */
    deleteProfileMemory(id: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM ai_profile_memories WHERE id = ?'
        ).run(id)
        return result.changes > 0
    }

    // ===========================================
    // AI Team 方法 (V4.2)
    // ===========================================

    /**
     * 创建 AI 团队
     */
    createAITeam(
        namespace: string,
        team: {
            name: string
            description?: string | null
            focus?: string | null
            config?: Partial<StoredAITeam['config']>
        }
    ): StoredAITeam {
        const id = randomUUID()
        const now = Date.now()

        const config: StoredAITeam['config'] = {
            maxMembers: team.config?.maxMembers ?? 10,
            autoAssign: team.config?.autoAssign ?? true,
            sharedKnowledge: team.config?.sharedKnowledge ?? true
        }

        const stats: StoredAITeam['stats'] = {
            tasksCompleted: 0,
            activeHours: 0,
            collaborationScore: 50
        }

        this.db.prepare(`
            INSERT INTO ai_teams (
                id, namespace, name, description, focus, status,
                config_json, stats_json, created_at, updated_at
            ) VALUES (
                @id, @namespace, @name, @description, @focus, @status,
                @config_json, @stats_json, @created_at, @updated_at
            )
        `).run({
            id,
            namespace,
            name: team.name,
            description: team.description ?? null,
            focus: team.focus ?? null,
            status: 'active',
            config_json: JSON.stringify(config),
            stats_json: JSON.stringify(stats),
            created_at: now,
            updated_at: now
        })

        return this.getAITeam(id)!
    }

    /**
     * 获取 AI 团队
     */
    getAITeam(id: string): StoredAITeam | null {
        const row = this.db.prepare(
            'SELECT * FROM ai_teams WHERE id = ?'
        ).get(id) as DbAITeamRow | undefined

        return row ? toStoredAITeam(row) : null
    }

    /**
     * 获取命名空间下的所有 AI 团队
     */
    getAITeams(namespace: string): StoredAITeam[] {
        const rows = this.db.prepare(
            'SELECT * FROM ai_teams WHERE namespace = ? ORDER BY created_at DESC'
        ).all(namespace) as DbAITeamRow[]

        return rows.map(toStoredAITeam)
    }

    /**
     * 获取活跃的 AI 团队
     */
    getActiveAITeams(namespace: string): StoredAITeam[] {
        const rows = this.db.prepare(
            "SELECT * FROM ai_teams WHERE namespace = ? AND status = 'active' ORDER BY created_at DESC"
        ).all(namespace) as DbAITeamRow[]

        return rows.map(toStoredAITeam)
    }

    /**
     * 更新 AI 团队
     */
    updateAITeam(
        id: string,
        data: Partial<{
            name: string
            description: string | null
            focus: string | null
            status: AITeamStatus
            config: Partial<StoredAITeam['config']>
        }>
    ): StoredAITeam | null {
        const existing = this.getAITeam(id)
        if (!existing) return null

        const now = Date.now()
        const updates: string[] = ['updated_at = @updated_at']
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: Record<string, any> = { id, updated_at: now }

        if (data.name !== undefined) {
            updates.push('name = @name')
            params.name = data.name
        }
        if (data.description !== undefined) {
            updates.push('description = @description')
            params.description = data.description
        }
        if (data.focus !== undefined) {
            updates.push('focus = @focus')
            params.focus = data.focus
        }
        if (data.status !== undefined) {
            updates.push('status = @status')
            params.status = data.status
        }
        if (data.config !== undefined) {
            updates.push('config_json = @config_json')
            params.config_json = JSON.stringify({ ...existing.config, ...data.config })
        }

        this.db.prepare(`
            UPDATE ai_teams SET ${updates.join(', ')} WHERE id = @id
        `).run(params)

        return this.getAITeam(id)
    }

    /**
     * 更新 AI 团队统计数据
     */
    updateAITeamStats(id: string, stats: Partial<StoredAITeam['stats']>): void {
        const existing = this.getAITeam(id)
        if (!existing) return

        const now = Date.now()
        const mergedStats = { ...existing.stats, ...stats }

        this.db.prepare(`
            UPDATE ai_teams SET stats_json = @stats_json, updated_at = @updated_at WHERE id = @id
        `).run({
            id,
            stats_json: JSON.stringify(mergedStats),
            updated_at: now
        })
    }

    /**
     * 删除 AI 团队
     */
    deleteAITeam(id: string): boolean {
        const result = this.db.prepare('DELETE FROM ai_teams WHERE id = ?').run(id)
        return result.changes > 0
    }

    /**
     * 添加团队成员
     */
    addAITeamMember(
        teamId: string,
        profileId: string,
        role: AITeamMemberRole = 'member',
        specialization?: string
    ): StoredAITeamMember | null {
        const team = this.getAITeam(teamId)
        if (!team) return null

        // 检查成员数量限制
        const members = this.getAITeamMembers(teamId)
        if (members.length >= team.config.maxMembers) {
            console.log(`[Store] Team ${teamId} has reached max members`)
            return null
        }

        // 检查是否已是成员
        if (members.some(m => m.profileId === profileId)) {
            console.log(`[Store] Profile ${profileId} is already a member of team ${teamId}`)
            return null
        }

        const now = Date.now()

        this.db.prepare(`
            INSERT INTO ai_team_members (team_id, profile_id, role, joined_at, contribution, specialization)
            VALUES (@team_id, @profile_id, @role, @joined_at, @contribution, @specialization)
        `).run({
            team_id: teamId,
            profile_id: profileId,
            role,
            joined_at: now,
            contribution: 0,
            specialization: specialization ?? null
        })

        return this.getAITeamMember(teamId, profileId)
    }

    /**
     * 获取团队成员
     */
    getAITeamMember(teamId: string, profileId: string): StoredAITeamMember | null {
        const row = this.db.prepare(
            'SELECT * FROM ai_team_members WHERE team_id = ? AND profile_id = ?'
        ).get(teamId, profileId) as DbAITeamMemberRow | undefined

        return row ? toStoredAITeamMember(row) : null
    }

    /**
     * 获取团队所有成员
     */
    getAITeamMembers(teamId: string): StoredAITeamMember[] {
        const rows = this.db.prepare(
            'SELECT * FROM ai_team_members WHERE team_id = ? ORDER BY joined_at ASC'
        ).all(teamId) as DbAITeamMemberRow[]

        return rows.map(toStoredAITeamMember)
    }

    /**
     * 获取 AI Profile 所属的团队
     */
    getTeamsForProfile(profileId: string): StoredAITeam[] {
        const memberRows = this.db.prepare(
            'SELECT team_id FROM ai_team_members WHERE profile_id = ?'
        ).all(profileId) as Array<{ team_id: string }>

        const teams: StoredAITeam[] = []
        for (const row of memberRows) {
            const team = this.getAITeam(row.team_id)
            if (team) teams.push(team)
        }

        return teams
    }

    /**
     * 更新团队成员贡献度
     */
    updateTeamMemberContribution(teamId: string, profileId: string, contribution: number): void {
        this.db.prepare(`
            UPDATE ai_team_members SET contribution = @contribution WHERE team_id = @team_id AND profile_id = @profile_id
        `).run({ team_id: teamId, profile_id: profileId, contribution })
    }

    /**
     * 更新团队成员角色
     */
    updateTeamMemberRole(teamId: string, profileId: string, role: AITeamMemberRole): void {
        this.db.prepare(`
            UPDATE ai_team_members SET role = @role WHERE team_id = @team_id AND profile_id = @profile_id
        `).run({ team_id: teamId, profile_id: profileId, role })
    }

    /**
     * 移除团队成员
     */
    removeAITeamMember(teamId: string, profileId: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM ai_team_members WHERE team_id = ? AND profile_id = ?'
        ).run(teamId, profileId)
        return result.changes > 0
    }

    /**
     * 添加团队知识
     */
    addAITeamKnowledge(
        teamId: string,
        namespace: string,
        knowledge: {
            title: string
            content: string
            category: StoredAITeamKnowledge['category']
            contributorProfileId: string
            importance?: number
        }
    ): StoredAITeamKnowledge {
        const id = randomUUID()
        const now = Date.now()

        this.db.prepare(`
            INSERT INTO ai_team_knowledge (
                id, team_id, namespace, title, content, category,
                contributor_profile_id, importance, access_count,
                created_at, updated_at
            ) VALUES (
                @id, @team_id, @namespace, @title, @content, @category,
                @contributor_profile_id, @importance, @access_count,
                @created_at, @updated_at
            )
        `).run({
            id,
            team_id: teamId,
            namespace,
            title: knowledge.title,
            content: knowledge.content,
            category: knowledge.category,
            contributor_profile_id: knowledge.contributorProfileId,
            importance: knowledge.importance ?? 0.5,
            access_count: 0,
            created_at: now,
            updated_at: now
        })

        return this.getAITeamKnowledge(id)!
    }

    /**
     * 获取团队知识
     */
    getAITeamKnowledge(id: string): StoredAITeamKnowledge | null {
        const row = this.db.prepare(
            'SELECT * FROM ai_team_knowledge WHERE id = ?'
        ).get(id) as DbAITeamKnowledgeRow | undefined

        return row ? toStoredAITeamKnowledge(row) : null
    }

    /**
     * 获取团队所有知识
     */
    getAITeamKnowledgeList(teamId: string, options?: {
        category?: StoredAITeamKnowledge['category']
        limit?: number
        orderBy?: 'importance' | 'accessCount' | 'createdAt'
    }): StoredAITeamKnowledge[] {
        let sql = 'SELECT * FROM ai_team_knowledge WHERE team_id = ?'
        const params: (string | number)[] = [teamId]

        if (options?.category) {
            sql += ' AND category = ?'
            params.push(options.category)
        }

        const orderBy = options?.orderBy ?? 'importance'
        const orderColumn = orderBy === 'accessCount' ? 'access_count' : orderBy === 'createdAt' ? 'created_at' : 'importance'
        sql += ` ORDER BY ${orderColumn} DESC`

        if (options?.limit) {
            sql += ' LIMIT ?'
            params.push(options.limit)
        }

        const rows = this.db.prepare(sql).all(...params) as DbAITeamKnowledgeRow[]
        return rows.map(toStoredAITeamKnowledge)
    }

    /**
     * 更新团队知识访问计数
     */
    updateTeamKnowledgeAccess(id: string): void {
        const now = Date.now()
        this.db.prepare(`
            UPDATE ai_team_knowledge
            SET access_count = access_count + 1, updated_at = @now
            WHERE id = @id
        `).run({ id, now })
    }

    /**
     * 删除团队知识
     */
    deleteAITeamKnowledge(id: string): boolean {
        const result = this.db.prepare('DELETE FROM ai_team_knowledge WHERE id = ?').run(id)
        return result.changes > 0
    }

    /**
     * 获取团队及其成员的完整信息
     */
    getAITeamWithMembers(teamId: string): {
        team: StoredAITeam
        members: Array<StoredAITeamMember & { profile: StoredAIProfile | null }>
    } | null {
        const team = this.getAITeam(teamId)
        if (!team) return null

        const members = this.getAITeamMembers(teamId).map(member => ({
            ...member,
            profile: this.getAIProfile(member.profileId)
        }))

        return { team, members }
    }
}

// Re-export types and interface from separate files
export type { IStore } from './interface'
export type { StoreConfig, PostgresConfig } from './types'
export { SqliteStore } from './sqlite'
export { PostgresStore } from './postgres'

import type { IStore } from './interface'
import type { StoreConfig } from './types'

/**
 * Create a store instance based on configuration.
 * Returns an IStore implementation (SQLite or PostgreSQL).
 *
 * Note: Uses dynamic imports to avoid circular dependency issues.
 */
export async function createStore(config: StoreConfig): Promise<IStore> {
    if (config.type === 'postgres') {
        if (!config.postgres) {
            throw new Error('PostgreSQL configuration required when STORE_TYPE=postgres')
        }
        console.log(`[Store] Initializing PostgreSQL store: ${config.postgres.host}/${config.postgres.database}`)
        const { PostgresStore } = await import('./postgres')
        return PostgresStore.create(config.postgres)
    }

    // Default: SQLite
    const dbPath = config.sqlitePath || `${process.env.HOME}/.hapi/hapi.db`
    console.log(`[Store] Initializing SQLite store: ${dbPath}`)
    const { SqliteStore } = await import('./sqlite')
    return new SqliteStore(dbPath)
}
