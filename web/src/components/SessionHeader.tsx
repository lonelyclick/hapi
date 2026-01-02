import { useCallback, useMemo, useState } from 'react'
import type { Session } from '@/types/api'
import { isTelegramApp } from '@/hooks/useTelegram'

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

function FilesIcon(props: { className?: string }) {
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
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
        </svg>
    )
}

function TrashIcon(props: { className?: string }) {
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
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
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

export function SessionHeader(props: {
    session: Session
    onBack: () => void
    onViewFiles?: () => void
    onDelete?: () => void
    deleteDisabled?: boolean
}) {
    const title = useMemo(() => getSessionTitle(props.session), [props.session])
    const worktreeBranch = props.session.metadata?.worktree?.branch
    const agentLabel = useMemo(() => getAgentLabel(props.session), [props.session])
    const [isRefreshing, setIsRefreshing] = useState(false)

    const handleForceRefresh = useCallback(async () => {
        if (isRefreshing) return
        setIsRefreshing(true)

        try {
            const registrations = await navigator.serviceWorker?.getRegistrations()
            if (registrations) {
                for (const registration of registrations) {
                    await registration.unregister()
                }
            }

            const cacheNames = await caches?.keys()
            if (cacheNames) {
                for (const cacheName of cacheNames) {
                    await caches.delete(cacheName)
                }
            }

            window.location.reload()
        } catch (error) {
            console.error('Force refresh failed:', error)
            window.location.reload()
        }
    }, [isRefreshing])

    const gitCommitHash = typeof __GIT_COMMIT_HASH__ !== 'undefined' ? __GIT_COMMIT_HASH__ : 'dev'
    const gitCommitMessage = typeof __GIT_COMMIT_MESSAGE__ !== 'undefined' ? __GIT_COMMIT_MESSAGE__ : ''

    // In Telegram, don't render header (Telegram provides its own)
    if (isTelegramApp()) {
        return null
    }

    return (
        <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)] pt-[env(safe-area-inset-top)]">
            <div className="mx-auto w-full max-w-content flex items-center justify-between px-4 py-3">
                {/* Left side: Back button + Logo + Brand + Version */}
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        type="button"
                        onClick={props.onBack}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-sm">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="white"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-4 w-4"
                            >
                                <circle cx="12" cy="12" r="10" />
                                <path d="M2 12h20" />
                                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                            </svg>
                        </div>
                        <span className="text-lg font-bold yoho-brand-text hidden sm:inline">Yoho Remote</span>
                    </div>
                    <button
                        type="button"
                        onClick={handleForceRefresh}
                        disabled={isRefreshing}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--app-subtle-bg)] text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors disabled:opacity-50 shrink-0"
                        title={`${gitCommitMessage}\n\nClick to force refresh`}
                    >
                        {isRefreshing ? '...' : gitCommitHash}
                    </button>
                </div>

                {/* Right side: Session info + Actions */}
                <div className="flex items-center gap-2 shrink-0">
                    {/* Session title badge */}
                    <div className="hidden sm:flex flex-col items-end">
                        <span className="text-sm font-medium truncate max-w-[200px]" title={title}>
                            {title}
                        </span>
                        <span className="text-[10px] text-[var(--app-hint)]">
                            {agentLabel}
                            {worktreeBranch ? ` • ${worktreeBranch}` : ''}
                        </span>
                    </div>

                    {/* Agent badge for mobile */}
                    <span className="sm:hidden text-xs font-medium px-2 py-1 rounded-full bg-[var(--app-subtle-bg)] text-[var(--app-hint)]">
                        {agentLabel}
                    </span>

                    {/* Action buttons */}
                    {props.onViewFiles ? (
                        <button
                            type="button"
                            onClick={props.onViewFiles}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--app-subtle-bg)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title="Files"
                        >
                            <FilesIcon />
                        </button>
                    ) : null}
                    {props.onDelete ? (
                        <button
                            type="button"
                            onClick={props.onDelete}
                            disabled={props.deleteDisabled}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--app-subtle-bg)] text-[var(--app-hint)] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
