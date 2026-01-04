import { useCallback, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { Spinner } from '@/components/Spinner'
import type { AgentGroupType } from '@/types/api'

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
                        <div className="text-center py-12">
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

                    {/* Groups List */}
                    {groups.map(group => (
                        <button
                            key={group.id}
                            onClick={() => navigate({
                                to: '/groups/$groupId/chat',
                                params: { groupId: group.id }
                            })}
                            className="w-full rounded-lg bg-[var(--app-subtle-bg)] px-3 py-3 flex items-center gap-3 hover:bg-[var(--app-secondary-bg)] transition-colors text-left"
                        >
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-medium text-sm">
                                {group.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{group.name}</div>
                                <div className="text-xs text-[var(--app-hint)]">
                                    {group.memberCount ?? 0} 成员
                                </div>
                            </div>
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                className="text-[var(--app-hint)]"
                            >
                                <polyline points="9 18 15 12 9 6" />
                            </svg>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
