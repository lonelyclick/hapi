import { useMemo } from 'react'
import type { Session, SessionViewer } from '@/types/api'
import { isTelegramApp } from '@/hooks/useTelegram'
import { ViewersBadge } from './ViewersBadge'

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
    viewers?: SessionViewer[]
    onBack: () => void
    onViewFiles?: () => void
    onDelete?: () => void
    deleteDisabled?: boolean
}) {
    const title = useMemo(() => getSessionTitle(props.session), [props.session])
    const worktreeBranch = props.session.metadata?.worktree?.branch
    const agentLabel = useMemo(() => getAgentLabel(props.session), [props.session])

    // In Telegram, don't render header (Telegram provides its own)
    if (isTelegramApp()) {
        return null
    }

    return (
        <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)] pt-[env(safe-area-inset-top)]">
            <div className="mx-auto w-full max-w-content px-3 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:py-1.5">
                {/* Left side: Back button + Title + Agent */}
                <div className="flex w-full min-w-0 flex-1 items-center gap-2 sm:w-auto">
                    <button
                        type="button"
                        onClick={props.onBack}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-sm">
                            {title}
                        </div>
                        <div className="text-[10px] text-[var(--app-hint)] truncate">
                            {agentLabel}
                            {worktreeBranch ? ` • ${worktreeBranch}` : ''}
                        </div>
                    </div>
                </div>

                {/* Right side: Viewers + Action buttons */}
                <div className="flex w-full flex-wrap items-center justify-end gap-1.5 shrink-0 sm:w-auto">
                    {props.viewers && props.viewers.length > 0 && (
                        <ViewersBadge viewers={props.viewers} />
                    )}
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
