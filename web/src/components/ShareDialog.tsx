import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import type { SessionShare } from '@/types/api'

function XIcon(props: { className?: string }) {
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

function CheckIcon(props: { className?: string }) {
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
            <polyline points="20 6 9 17 4 12" />
        </svg>
    )
}

interface ShareDialogProps {
    sessionId: string
    onClose: () => void
}

export function ShareDialog({ sessionId, onClose }: ShareDialogProps) {
    const { api, userEmail } = useAppContext()
    const queryClient = useQueryClient()

    // 获取已共享的用户列表
    const { data: sharesData, isLoading: sharesLoading } = useQuery({
        queryKey: ['session-shares', sessionId],
        queryFn: async () => api.getSessionShares(sessionId),
    })

    // 获取所有允许的用户列表
    const { data: usersData, isLoading: usersLoading } = useQuery({
        queryKey: ['allowed-users'],
        queryFn: async () => api.getAllowedUsers(),
    })

    const shares = sharesData?.shares ?? []
    const allowedUsers = usersData?.users ?? []

    // 过滤掉自己和已经共享的用户
    const availableUsers = allowedUsers.filter(
        u => u.email !== userEmail && !shares.some(s => s.sharedWithEmail === u.email)
    )

    // 添加共享的mutation
    const addShareMutation = useMutation({
        mutationFn: async (email: string) => {
            return await api.addSessionShare(sessionId, email)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['session-shares', sessionId] })
        }
    })

    // 移除共享的mutation
    const removeShareMutation = useMutation({
        mutationFn: async (email: string) => {
            return await api.removeSessionShare(sessionId, email)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['session-shares', sessionId] })
        }
    })

    // 点击外部关闭
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', handleEscape)
        return () => document.removeEventListener('keydown', handleEscape)
    }, [onClose])

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div
                className="bg-[var(--app-bg)] rounded-lg shadow-xl border border-[var(--app-divider)] w-full max-w-md"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--app-divider)]">
                    <h2 className="text-lg font-semibold text-[var(--app-fg)]">Share Session</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1 rounded hover:bg-[var(--app-secondary-bg)] text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                    >
                        <XIcon />
                    </button>
                </div>

                {/* Content */}
                <div className="px-4 py-3">
                    <p className="text-sm text-[var(--app-hint)] mb-3">
                        Select users to share this session with. Shared users will be able to view and interact with the session.
                    </p>

                    {/* 已共享的用户列表 */}
                    {shares.length > 0 && (
                        <div className="mb-4">
                            <div className="text-xs font-medium text-[var(--app-hint)] uppercase tracking-wider mb-2">
                                Shared with ({shares.length})
                            </div>
                            <div className="space-y-1">
                                {shares.map((share) => (
                                    <div
                                        key={share.sharedWithEmail}
                                        className="flex items-center justify-between px-3 py-2 rounded-md bg-[var(--app-subtle-bg)] border border-[var(--app-divider)]"
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className="h-6 w-6 rounded-full bg-purple-500/10 flex items-center justify-center">
                                                <span className="text-xs text-purple-600">
                                                    {share.sharedWithEmail[0].toUpperCase()}
                                                </span>
                                            </div>
                                            <span className="text-sm text-[var(--app-fg)]">{share.sharedWithEmail}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeShareMutation.mutate(share.sharedWithEmail)}
                                            disabled={removeShareMutation.isPending}
                                            className="p-1 rounded hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                                            title="Remove access"
                                        >
                                            <XIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 可选用户列表 */}
                    <div>
                        <div className="text-xs font-medium text-[var(--app-hint)] uppercase tracking-wider mb-2">
                            Add People ({availableUsers.length})
                        </div>
                        {usersLoading ? (
                            <div className="text-sm text-[var(--app-hint)] py-4 text-center">Loading users...</div>
                        ) : availableUsers.length === 0 ? (
                            <div className="text-sm text-[var(--app-hint)] py-4 text-center">
                                {shares.length > 0 ? 'All users already have access' : 'No other users available'}
                            </div>
                        ) : (
                            <div className="max-h-[200px] overflow-y-auto space-y-1">
                                {availableUsers.map((user) => (
                                    <button
                                        key={user.email}
                                        type="button"
                                        onClick={() => addShareMutation.mutate(user.email)}
                                        disabled={addShareMutation.isPending}
                                        className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-[var(--app-secondary-bg)] text-left disabled:opacity-50 transition-colors"
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className="h-6 w-6 rounded-full bg-gray-500/10 flex items-center justify-center">
                                                <span className="text-xs text-gray-600">
                                                    {user.email[0].toUpperCase()}
                                                </span>
                                            </div>
                                            <span className="text-sm text-[var(--app-fg)]">{user.email}</span>
                                        </div>
                                        <div className="flex items-center gap-1 text-[var(--app-hint)]">
                                            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-500/10">
                                                {user.role}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-[var(--app-divider)] flex justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] rounded-md transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    )
}
