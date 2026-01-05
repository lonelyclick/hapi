import { useCallback, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { Spinner } from '@/components/Spinner'
import type { AgentGroup, AgentGroupMember, AgentGroupType, AgentGroupStatus, SessionSummary } from '@/types/api'

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function TrashIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    )
}

function UsersIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    )
}

function BroadcastIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
    )
}

function ChatIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
    )
}

const GROUP_TYPE_LABELS: Record<AgentGroupType, string> = {
    collaboration: '协作',
    debate: '辩论',
    review: '审查'
}

const GROUP_STATUS_LABELS: Record<AgentGroupStatus, string> = {
    active: '活跃',
    paused: '暂停',
    completed: '已完成'
}

const GROUP_STATUS_COLORS: Record<AgentGroupStatus, string> = {
    active: 'bg-emerald-500',
    paused: 'bg-amber-500',
    completed: 'bg-gray-400'
}

type CreateGroupFormData = {
    name: string
    type: AgentGroupType
    description: string
}

function CreateGroupForm(props: {
    onSubmit: (data: CreateGroupFormData) => void
    onCancel: () => void
    isPending: boolean
}) {
    const [name, setName] = useState('')
    const [type, setType] = useState<AgentGroupType>('collaboration')
    const [description, setDescription] = useState('')

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) return
        props.onSubmit({ name: name.trim(), type, description: description.trim() })
    }, [name, type, description, props])

    return (
        <form onSubmit={handleSubmit} className="px-3 py-2 space-y-2 border-b border-[var(--app-divider)]">
            <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="群组名称"
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                disabled={props.isPending}
                autoFocus
            />
            <select
                value={type}
                onChange={(e) => setType(e.target.value as AgentGroupType)}
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                disabled={props.isPending}
            >
                <option value="collaboration">协作模式</option>
                <option value="debate">辩论模式</option>
                <option value="review">审查模式</option>
            </select>
            <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="描述（可选）"
                rows={2}
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)] resize-none"
                disabled={props.isPending}
            />
            <div className="flex items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={props.onCancel}
                    className="px-3 py-1 text-xs font-medium rounded text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                    disabled={props.isPending}
                >
                    取消
                </button>
                <button
                    type="submit"
                    disabled={!name.trim() || props.isPending}
                    className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50"
                >
                    {props.isPending ? <Spinner className="w-3 h-3" /> : null}
                    创建
                </button>
            </div>
        </form>
    )
}

function AddMemberForm(props: {
    sessions: SessionSummary[]
    existingMemberIds: string[]
    onSubmit: (sessionId: string) => void
    onCancel: () => void
    isPending: boolean
}) {
    const [selectedSessionId, setSelectedSessionId] = useState('')

    const availableSessions = useMemo(() => {
        return props.sessions.filter(
            s => s.active && !props.existingMemberIds.includes(s.id)
        )
    }, [props.sessions, props.existingMemberIds])

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedSessionId) return
        props.onSubmit(selectedSessionId)
    }, [selectedSessionId, props])

    return (
        <form onSubmit={handleSubmit} className="px-3 py-2 space-y-2 border-b border-[var(--app-divider)]">
            <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                disabled={props.isPending}
            >
                <option value="">选择会话...</option>
                {availableSessions.map(session => (
                    <option key={session.id} value={session.id}>
                        {session.metadata?.name || session.id.slice(0, 8)}
                        {session.metadata?.runtimeAgent ? ` (${session.metadata.runtimeAgent})` : ''}
                    </option>
                ))}
            </select>
            {availableSessions.length === 0 && (
                <p className="text-xs text-[var(--app-hint)]">没有可用的活跃会话</p>
            )}
            <div className="flex items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={props.onCancel}
                    className="px-3 py-1 text-xs font-medium rounded text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                    disabled={props.isPending}
                >
                    取消
                </button>
                <button
                    type="submit"
                    disabled={!selectedSessionId || props.isPending}
                    className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50"
                >
                    {props.isPending ? <Spinner className="w-3 h-3" /> : null}
                    添加
                </button>
            </div>
        </form>
    )
}

function BroadcastForm(props: {
    onSubmit: (content: string) => void
    onCancel: () => void
    isPending: boolean
}) {
    const [content, setContent] = useState('')

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault()
        if (!content.trim()) return
        props.onSubmit(content.trim())
    }, [content, props])

    return (
        <form onSubmit={handleSubmit} className="px-3 py-2 space-y-2 border-b border-[var(--app-divider)]">
            <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="输入要广播给所有成员的消息..."
                rows={3}
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)] resize-none"
                disabled={props.isPending}
                autoFocus
            />
            <div className="flex items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={props.onCancel}
                    className="px-3 py-1 text-xs font-medium rounded text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                    disabled={props.isPending}
                >
                    取消
                </button>
                <button
                    type="submit"
                    disabled={!content.trim() || props.isPending}
                    className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50"
                >
                    {props.isPending ? <Spinner className="w-3 h-3" /> : null}
                    发送
                </button>
            </div>
        </form>
    )
}

function GroupCard(props: {
    group: AgentGroup
    members: AgentGroupMember[]
    sessions: SessionSummary[]
    onDelete: () => void
    onUpdateStatus: (status: AgentGroupStatus) => void
    onAddMember: (sessionId: string) => void
    onRemoveMember: (sessionId: string) => void
    onBroadcast: (content: string) => void
    isDeleting: boolean
    isUpdating: boolean
    isAddingMember: boolean
    isRemovingMember: boolean
    isBroadcasting: boolean
}) {
    const [showAddMember, setShowAddMember] = useState(false)
    const [showBroadcast, setShowBroadcast] = useState(false)
    const navigate = useNavigate()

    const existingMemberIds = useMemo(() =>
        props.members.map(m => m.sessionId),
        [props.members]
    )

    const handleAddMember = useCallback((sessionId: string) => {
        props.onAddMember(sessionId)
        setShowAddMember(false)
    }, [props])

    const handleBroadcast = useCallback((content: string) => {
        props.onBroadcast(content)
        setShowBroadcast(false)
    }, [props])

    return (
        <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
            {/* Header */}
            <div className="px-3 py-2 border-b border-[var(--app-divider)] flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full ${GROUP_STATUS_COLORS[props.group.status]}`} />
                    <span className="font-medium text-sm truncate">{props.group.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--app-secondary-bg)] text-[var(--app-hint)]">
                        {GROUP_TYPE_LABELS[props.group.type]}
                    </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {/* Chat button - always visible */}
                    <button
                        onClick={() => navigate({
                            to: '/groups/$groupId/chat',
                            params: { groupId: props.group.id }
                        })}
                        className="p-1.5 rounded text-[var(--app-link)] hover:text-[var(--app-link)] hover:bg-[var(--app-link)]/10"
                        title="进入群聊"
                    >
                        <ChatIcon />
                    </button>
                    {props.group.status === 'active' && (
                        <>
                            <button
                                onClick={() => setShowBroadcast(!showBroadcast)}
                                className="p-1.5 rounded text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]"
                                title="广播消息"
                            >
                                <BroadcastIcon />
                            </button>
                            <button
                                onClick={() => setShowAddMember(!showAddMember)}
                                className="p-1.5 rounded text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]"
                                title="添加成员"
                            >
                                <UsersIcon />
                            </button>
                        </>
                    )}
                    <select
                        value={props.group.status}
                        onChange={(e) => props.onUpdateStatus(e.target.value as AgentGroupStatus)}
                        className="text-[10px] px-1 py-0.5 rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)]"
                        disabled={props.isUpdating}
                    >
                        <option value="active">活跃</option>
                        <option value="paused">暂停</option>
                        <option value="completed">完成</option>
                    </select>
                    <button
                        onClick={props.onDelete}
                        disabled={props.isDeleting}
                        className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                        title="删除群组"
                    >
                        {props.isDeleting ? <Spinner className="w-4 h-4" /> : <TrashIcon />}
                    </button>
                </div>
            </div>

            {/* Description */}
            {props.group.description && (
                <div className="px-3 py-1.5 text-xs text-[var(--app-hint)] border-b border-[var(--app-divider)]">
                    {props.group.description}
                </div>
            )}

            {/* Broadcast Form */}
            {showBroadcast && (
                <BroadcastForm
                    onSubmit={handleBroadcast}
                    onCancel={() => setShowBroadcast(false)}
                    isPending={props.isBroadcasting}
                />
            )}

            {/* Add Member Form */}
            {showAddMember && (
                <AddMemberForm
                    sessions={props.sessions}
                    existingMemberIds={existingMemberIds}
                    onSubmit={handleAddMember}
                    onCancel={() => setShowAddMember(false)}
                    isPending={props.isAddingMember}
                />
            )}

            {/* Members */}
            <div className="divide-y divide-[var(--app-divider)]">
                {props.members.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
                        暂无成员
                    </div>
                ) : (
                    props.members.map(member => (
                        <div
                            key={member.sessionId}
                            className="px-3 py-1.5 flex items-center justify-between gap-2"
                        >
                            <button
                                onClick={() => navigate({
                                    to: '/sessions/$sessionId',
                                    params: { sessionId: member.sessionId }
                                })}
                                className="flex items-center gap-2 min-w-0 text-left hover:underline"
                            >
                                <span className={`w-1.5 h-1.5 rounded-full ${member.sessionActive ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                <span className="text-xs truncate">
                                    {member.sessionName || member.sessionId.slice(0, 8)}
                                </span>
                                {member.agentType && (
                                    <span className="text-[10px] text-[var(--app-hint)]">
                                        ({member.agentType})
                                    </span>
                                )}
                            </button>
                            <button
                                onClick={() => props.onRemoveMember(member.sessionId)}
                                disabled={props.isRemovingMember}
                                className="p-1 rounded text-[var(--app-hint)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                                title="移除成员"
                            >
                                <TrashIcon className="w-3 h-3" />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default function GroupsPage() {
    const { api } = useAppContext()
    const goBack = useAppGoBack()
    const queryClient = useQueryClient()
    const [showCreateForm, setShowCreateForm] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)

    // Fetch groups
    const { data: groupsData, isLoading: groupsLoading } = useQuery({
        queryKey: ['groups'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getGroups()
        },
        enabled: Boolean(api)
    })

    // Fetch sessions for member selection
    const { data: sessionsData } = useQuery({
        queryKey: ['sessions'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getSessions()
        },
        enabled: Boolean(api)
    })

    // Fetch group details (with members) for expanded group
    const { data: groupDetailData } = useQuery({
        queryKey: ['group', expandedGroupId],
        queryFn: async () => {
            if (!api || !expandedGroupId) throw new Error('API unavailable')
            return await api.getGroup(expandedGroupId)
        },
        enabled: Boolean(api && expandedGroupId)
    })

    const groups = groupsData?.groups ?? []
    const sessions = sessionsData?.sessions ?? []

    // Create group mutation
    const createGroupMutation = useMutation({
        mutationFn: async (data: CreateGroupFormData) => {
            if (!api) throw new Error('API unavailable')
            return await api.createGroup(data.name, data.type, data.description || undefined)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['groups'] })
            setShowCreateForm(false)
            setError(null)
        },
        onError: (err) => {
            setError(err instanceof Error ? err.message : 'Failed to create group')
        }
    })

    // Delete group mutation
    const deleteGroupMutation = useMutation({
        mutationFn: async (groupId: string) => {
            if (!api) throw new Error('API unavailable')
            return await api.deleteGroup(groupId)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['groups'] })
            setExpandedGroupId(null)
        }
    })

    // Update status mutation
    const updateStatusMutation = useMutation({
        mutationFn: async ({ groupId, status }: { groupId: string; status: AgentGroupStatus }) => {
            if (!api) throw new Error('API unavailable')
            return await api.updateGroupStatus(groupId, status)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['groups'] })
            queryClient.invalidateQueries({ queryKey: ['group', expandedGroupId] })
        }
    })

    // Add member mutation
    const addMemberMutation = useMutation({
        mutationFn: async ({ groupId, sessionId }: { groupId: string; sessionId: string }) => {
            if (!api) throw new Error('API unavailable')
            return await api.addGroupMember(groupId, sessionId)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['group', expandedGroupId] })
        }
    })

    // Remove member mutation
    const removeMemberMutation = useMutation({
        mutationFn: async ({ groupId, sessionId }: { groupId: string; sessionId: string }) => {
            if (!api) throw new Error('API unavailable')
            return await api.removeGroupMember(groupId, sessionId)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['group', expandedGroupId] })
        }
    })

    // Broadcast mutation
    const broadcastMutation = useMutation({
        mutationFn: async ({ groupId, content }: { groupId: string; content: string }) => {
            if (!api) throw new Error('API unavailable')
            return await api.broadcastToGroup(groupId, content)
        },
        onSuccess: (result) => {
            const { broadcast } = result
            alert(`广播完成: ${broadcast.sent} 成功, ${broadcast.failed} 失败`)
        },
        onError: (err) => {
            alert(`广播失败: ${err instanceof Error ? err.message : 'Unknown error'}`)
        }
    })

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 px-3 py-1.5">
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="flex-1 font-medium text-sm">Agent 群组</div>
                    {!showCreateForm && (
                        <button
                            onClick={() => setShowCreateForm(true)}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)]"
                        >
                            <PlusIcon className="w-3 h-3" />
                            新建
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                <div className="mx-auto w-full max-w-content p-3 space-y-3">
                    {/* Error */}
                    {error && (
                        <div className="px-3 py-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded-lg">
                            {error}
                        </div>
                    )}

                    {/* Create Form */}
                    {showCreateForm && (
                        <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                            <div className="px-3 py-2 border-b border-[var(--app-divider)]">
                                <h3 className="text-sm font-medium">创建群组</h3>
                            </div>
                            <CreateGroupForm
                                onSubmit={(data) => createGroupMutation.mutate(data)}
                                onCancel={() => setShowCreateForm(false)}
                                isPending={createGroupMutation.isPending}
                            />
                        </div>
                    )}

                    {/* Loading */}
                    {groupsLoading && (
                        <div className="flex items-center justify-center py-8">
                            <Spinner className="w-6 h-6" />
                        </div>
                    )}

                    {/* Empty State */}
                    {!groupsLoading && groups.length === 0 && !showCreateForm && (
                        <div className="text-center py-8">
                            <UsersIcon className="w-12 h-12 mx-auto text-[var(--app-hint)] opacity-50" />
                            <p className="mt-2 text-sm text-[var(--app-hint)]">
                                还没有群组
                            </p>
                            <p className="mt-1 text-xs text-[var(--app-hint)]">
                                创建群组来让多个 AI Agent 协作、辩论或审查
                            </p>
                        </div>
                    )}

                    {/* Groups List */}
                    {groups.map(group => (
                        <div key={group.id}>
                            {expandedGroupId === group.id ? (
                                <GroupCard
                                    group={group}
                                    members={groupDetailData?.members ?? []}
                                    sessions={sessions}
                                    onDelete={() => deleteGroupMutation.mutate(group.id)}
                                    onUpdateStatus={(status) => updateStatusMutation.mutate({ groupId: group.id, status })}
                                    onAddMember={(sessionId) => addMemberMutation.mutate({ groupId: group.id, sessionId })}
                                    onRemoveMember={(sessionId) => removeMemberMutation.mutate({ groupId: group.id, sessionId })}
                                    onBroadcast={(content) => broadcastMutation.mutate({ groupId: group.id, content })}
                                    isDeleting={deleteGroupMutation.isPending}
                                    isUpdating={updateStatusMutation.isPending}
                                    isAddingMember={addMemberMutation.isPending}
                                    isRemovingMember={removeMemberMutation.isPending}
                                    isBroadcasting={broadcastMutation.isPending}
                                />
                            ) : (
                                <button
                                    onClick={() => setExpandedGroupId(group.id)}
                                    className="w-full rounded-lg bg-[var(--app-subtle-bg)] px-3 py-2 flex items-center justify-between gap-2 hover:bg-[var(--app-secondary-bg)] transition-colors text-left"
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className={`w-2 h-2 rounded-full ${GROUP_STATUS_COLORS[group.status]}`} />
                                        <span className="font-medium text-sm truncate">{group.name}</span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--app-secondary-bg)] text-[var(--app-hint)]">
                                            {GROUP_TYPE_LABELS[group.type]}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-[10px] text-[var(--app-hint)]">
                                            {group.memberCount ?? 0} 成员
                                        </span>
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="text-[var(--app-hint)]"
                                        >
                                            <polyline points="9 18 15 12 9 6" />
                                        </svg>
                                    </div>
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
