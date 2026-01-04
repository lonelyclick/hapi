import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Session, SessionViewer } from '@/types/api'
import { isTelegramApp } from '@/hooks/useTelegram'
import { ViewersBadge } from './ViewersBadge'
import { useAppContext } from '@/lib/app-context'

function getSessionTitle(session: Session): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }
    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }
    if (session.metadata?.path) {
        const parts = session.metadata.path.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }
    return session.id.slice(0, 8)
}

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
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

function FilesIcon(props: { className?: string }) {
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
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
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
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
    )
}

function EraserIcon(props: { className?: string }) {
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
            <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
            <path d="M22 21H7" />
            <path d="m5 11 9 9" />
        </svg>
    )
}

function RobotIcon(props: { className?: string; enabled?: boolean }) {
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
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="12" cy="5" r="2" />
            <path d="M12 7v4" />
            <line x1="8" y1="16" x2="8" y2="16" />
            <line x1="16" y1="16" x2="16" y2="16" />
        </svg>
    )
}

function getAgentLabel(session: Session): string {
    const flavor = session.metadata?.flavor?.trim()
    if (flavor === 'claude') return 'Claude'
    if (flavor === 'codex') return 'Codex'
    if (flavor === 'gemini') return 'Gemini'
    if (flavor) return flavor
    return 'Agent'
}

function formatRuntimeModel(session: Session): string | null {
    const model = session.metadata?.runtimeModel?.trim()
    if (!model) {
        return null
    }
    const effort = session.metadata?.runtimeModelReasoningEffort
    if (effort) {
        return `${model} (${effort})`
    }
    return model
}

export function SessionHeader(props: {
    session: Session
    viewers?: SessionViewer[]
    onBack: () => void
    onViewFiles?: () => void
    onClearMessages?: () => void
    onDelete?: () => void
    clearDisabled?: boolean
    deleteDisabled?: boolean
}) {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const title = useMemo(() => getSessionTitle(props.session), [props.session])
    const worktreeBranch = props.session.metadata?.worktree?.branch
    const agentLabel = useMemo(() => getAgentLabel(props.session), [props.session])
    const runtimeAgent = props.session.metadata?.runtimeAgent?.trim() || null
    const runtimeModel = useMemo(() => formatRuntimeModel(props.session), [props.session])
    const [showAgentTip, setShowAgentTip] = useState(false)
    const agentMeta = useMemo(
        () => {
            const parts = [agentLabel]
            if (runtimeAgent) {
                parts.push(runtimeAgent)
            }
            if (runtimeModel) {
                parts.push(runtimeModel)
            }
            if (worktreeBranch) {
                parts.push(worktreeBranch)
            }
            return parts.join(' • ')
        },
        [agentLabel, runtimeAgent, runtimeModel, worktreeBranch]
    )
    const hasAgentTip = agentMeta !== agentLabel
    const agentTipId = `session-agent-tip-${props.session.id}`

    // Auto-iteration config for this session
    const autoIterQueryKey = ['session-auto-iter', props.session.id]
    const { data: autoIterConfig } = useQuery({
        queryKey: autoIterQueryKey,
        queryFn: async () => {
            return await api.getSessionAutoIteration(props.session.id)
        },
        staleTime: 30000
    })

    const toggleAutoIterMutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            return await api.setSessionAutoIteration(props.session.id, enabled)
        },
        onSuccess: (data) => {
            queryClient.setQueryData(autoIterQueryKey, data)
        }
    })

    const autoIterEnabled = autoIterConfig?.autoIterEnabled ?? true

    useEffect(() => {
        setShowAgentTip(false)
    }, [props.session.id])

    // In Telegram, don't render header (Telegram provides its own)
    if (isTelegramApp()) {
        return null
    }

    return (
        <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)] pt-[env(safe-area-inset-top)]">
            <div className="mx-auto w-full max-w-content px-3 py-2 flex items-center justify-between gap-2 sm:py-1.5">
                {/* Left side: Back button + Title + Agent */}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <button
                        type="button"
                        onClick={props.onBack}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="max-w-[180px] truncate font-medium text-sm sm:max-w-none">
                            {title}
                        </div>
                        <div className="hidden sm:block text-[10px] text-[var(--app-hint)] truncate">
                            {agentMeta}
                        </div>
                    </div>
                </div>

                {/* Right side: Viewers + Action buttons */}
                <div className="flex shrink-0 items-center gap-1.5">
                    {hasAgentTip ? (
                        <div className="sm:hidden relative shrink-0">
                            <button
                                type="button"
                                className="flex h-5 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--app-hint)]"
                                title={agentMeta}
                                aria-label={agentMeta}
                                aria-describedby={agentTipId}
                                aria-expanded={showAgentTip}
                                onClick={() => setShowAgentTip((prev) => !prev)}
                                onBlur={() => setShowAgentTip(false)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                        setShowAgentTip(false)
                                    }
                                }}
                            >
                                <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border border-current text-[8px] font-semibold leading-none">
                                    i
                                </span>
                                <span className="leading-none">{agentLabel}</span>
                            </button>
                            {showAgentTip ? (
                                <div
                                    id={agentTipId}
                                    role="tooltip"
                                    className="absolute right-0 top-full z-20 mt-1 max-w-[80vw] whitespace-nowrap rounded-md border border-[var(--app-divider)] bg-[var(--app-bg)] px-2 py-1 text-[10px] text-[var(--app-fg)] shadow-lg"
                                >
                                    {agentMeta}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <span
                            className="sm:hidden inline-flex h-5 shrink-0 items-center rounded-full bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--app-hint)]"
                            title={agentMeta}
                        >
                            {agentLabel}
                        </span>
                    )}
                    {props.viewers && props.viewers.length > 0 && (
                        <ViewersBadge viewers={props.viewers} compact buttonClassName="h-5 leading-none" />
                    )}
                    {/* Auto-iteration toggle */}
                    <button
                        type="button"
                        onClick={() => toggleAutoIterMutation.mutate(!autoIterEnabled)}
                        disabled={toggleAutoIterMutation.isPending}
                        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                            autoIterEnabled
                                ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20'
                                : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]'
                        } disabled:opacity-50`}
                        title={autoIterEnabled ? '自动迭代已启用 (点击禁用)' : '自动迭代已禁用 (点击启用)'}
                    >
                        <RobotIcon />
                    </button>
                    {props.onViewFiles ? (
                        <button
                            type="button"
                            onClick={props.onViewFiles}
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--app-subtle-bg)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title="Files"
                        >
                            <FilesIcon />
                        </button>
                    ) : null}
                    {props.onClearMessages ? (
                        <button
                            type="button"
                            onClick={props.onClearMessages}
                            disabled={props.clearDisabled}
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--app-subtle-bg)] text-[var(--app-hint)] transition-colors hover:bg-orange-500/10 hover:text-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="清空聊天记录"
                        >
                            <EraserIcon />
                        </button>
                    ) : null}
                    {props.onDelete ? (
                        <button
                            type="button"
                            onClick={props.onDelete}
                            disabled={props.deleteDisabled}
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--app-subtle-bg)] text-[var(--app-hint)] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Delete session"
                        >
                            <TrashIcon />
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
