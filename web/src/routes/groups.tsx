import { useCallback, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { Spinner } from '@/components/Spinner'
import type { AgentGroup, AgentGroupType, AgentGroupStatus } from '@/types/api'

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

function formatTime(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp
    const date = new Date(timestamp)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    // 今天
    if (date.toDateString() === today.toDateString()) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    // 昨天
    if (date.toDateString() === yesterday.toDateString()) {
        return '昨天'
    }
    // 一周内
    if (diff < 7 * 24 * 60 * 60 * 1000) {
        const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
        return days[date.getDay()]
    }
    // 今年内
    if (date.getFullYear() === today.getFullYear()) {
        return `${date.getMonth() + 1}月${date.getDate()}日`
    }
    // 更早
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

function truncateMessage(content: string, maxLength: number = 40): string {
    // 移除换行符
    const singleLine = content.replace(/\n/g, ' ')
    if (singleLine.length <= maxLength) return singleLine
    return singleLine.slice(0, maxLength) + '...'
}

function CreateGroupForm(props: {
    onSubmit: (data: CreateGroupFormData) => void
    onCancel: () => void
    isPending: boolean
}) {
    const [name, setName] = useState('')

    const handleSubmit = useCallback(() => {
        if (!name.trim()) return
        props.onSubmit({ name: name.trim(), type: 'collaboration', description: '' })
    }, [name, props])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            handleSubmit()
        } else if (e.key === 'Escape') {
            props.onCancel()
        }
    }, [handleSubmit, props])

    return (
        <div className="flex items-center gap-2 px-3 py-2">
            <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入聊天名称后按回车"
                className="flex-1 px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                disabled={props.isPending}
                autoFocus
            />
            {props.isPending ? (
                <Spinner className="w-4 h-4" />
            ) : (
                <button
                    type="button"
                    onClick={props.onCancel}
                    className="p-1.5 rounded text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]"
                    title="取消"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            )}
        </div>
    )
}

function ChatListItem(props: {
    group: AgentGroup
    onClick: () => void
}) {
    const { group, onClick } = props
    const lastMessage = group.lastMessage

    return (
        <button
            onClick={onClick}
            className="w-full px-3 py-3 flex items-start gap-3 hover:bg-[var(--app-secondary-bg)] transition-colors text-left border-b border-[var(--app-divider)] last:border-b-0"
        >
            {/* Avatar */}
            <div className="relative shrink-0">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-medium">
                    {group.name.charAt(0).toUpperCase()}
                </div>
                {/* 状态指示器 */}
                <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--app-bg)] ${GROUP_STATUS_COLORS[group.status]}`} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{group.name}</span>
                    {lastMessage && (
                        <span className="text-[10px] text-[var(--app-hint)] shrink-0">
                            {formatTime(lastMessage.createdAt)}
                        </span>
                    )}
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-[var(--app-hint)] truncate">
                        {lastMessage ? (
                            truncateMessage(lastMessage.content)
                        ) : (
                            <span className="italic">暂无消息</span>
                        )}
                    </span>
                    {group.memberCount > 0 && (
                        <span className="text-[10px] text-[var(--app-hint)] shrink-0 flex items-center gap-0.5">
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                            {group.memberCount}
                        </span>
                    )}
                </div>
            </div>
        </button>
    )
}

export default function GroupsPage() {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const [showCreateForm, setShowCreateForm] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Fetch groups
    const { data: groupsData, isLoading: groupsLoading } = useQuery({
        queryKey: ['groups'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getGroups()
        },
        enabled: Boolean(api)
    })

    const groups = groupsData?.groups ?? []

    // Create group mutation
    const createGroupMutation = useMutation({
        mutationFn: async (data: CreateGroupFormData) => {
            if (!api) throw new Error('API unavailable')
            return await api.createGroup(data.name, data.type, data.description || undefined)
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ['groups'] })
            setShowCreateForm(false)
            setError(null)
            // Navigate to the new chat
            navigate({
                to: '/groups/$groupId/chat',
                params: { groupId: result.group.id }
            })
        },
        onError: (err) => {
            setError(err instanceof Error ? err.message : 'Failed to create group')
        }
    })

    const handleGroupClick = useCallback((groupId: string) => {
        navigate({
            to: '/groups/$groupId/chat',
            params: { groupId }
        })
    }, [navigate])

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 font-medium text-sm">Chat</div>
                    {!showCreateForm && (
                        <button
                            onClick={() => setShowCreateForm(true)}
                            className="p-1.5 rounded bg-[var(--app-button)] text-[var(--app-button-text)]"
                            title="新建聊天"
                        >
                            <PlusIcon className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                <div className="mx-auto w-full max-w-content">
                    {/* Error */}
                    {error && (
                        <div className="mx-3 mt-3 px-3 py-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded-lg">
                            {error}
                        </div>
                    )}

                    {/* Create Form */}
                    {showCreateForm && (
                        <div className="m-3 rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
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
                        <div className="text-center py-12 px-4">
                            <div className="w-16 h-16 mx-auto rounded-full bg-[var(--app-link)]/10 flex items-center justify-center">
                                <ChatIcon className="w-8 h-8 text-[var(--app-link)]" />
                            </div>
                            <p className="mt-4 text-sm font-medium text-[var(--app-fg)]">
                                开始新对话
                            </p>
                            <p className="mt-1 text-xs text-[var(--app-hint)]">
                                创建群聊与多个 AI 代理交流
                            </p>
                            <button
                                onClick={() => setShowCreateForm(true)}
                                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full bg-[var(--app-button)] text-[var(--app-button-text)]"
                            >
                                <PlusIcon className="w-4 h-4" />
                                新建聊天
                            </button>
                        </div>
                    )}

                    {/* Groups List - Telegram 风格 */}
                    {groups.length > 0 && (
                        <div className="bg-[var(--app-bg)]">
                            {groups.map(group => (
                                <ChatListItem
                                    key={group.id}
                                    group={group}
                                    onClick={() => handleGroupClick(group.id)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
