import { useEffect, useMemo, useState } from 'react'
import type { Project, SessionSummary } from '@/types/api'
import { ViewersBadge } from './ViewersBadge'

type SessionGroup = {
    projectId: string | null
    projectName: string
    projectPath: string | null
    sessions: SessionSummary[]
    latestUpdatedAt: number
    hasActiveSession: boolean
}

function getSessionPath(session: SessionSummary): string | null {
    return session.metadata?.worktree?.basePath ?? session.metadata?.path ?? null
}

function matchSessionToProject(session: SessionSummary, projects: Project[]): Project | null {
    const sessionPath = getSessionPath(session)
    if (!sessionPath) return null

    // Exact match first
    for (const project of projects) {
        if (project.path === sessionPath) {
            return project
        }
    }

    // Check if session path starts with project path (for worktrees)
    for (const project of projects) {
        if (sessionPath.startsWith(project.path + '/') || sessionPath.startsWith(project.path + '-')) {
            return project
        }
    }

    return null
}

function groupSessionsByProject(sessions: SessionSummary[], projects: Project[]): SessionGroup[] {
    const groups = new Map<string, { project: Project | null; sessions: SessionSummary[] }>()

    sessions.forEach(session => {
        const project = matchSessionToProject(session, projects)
        const key = project?.id ?? '__other__'

        if (!groups.has(key)) {
            groups.set(key, { project, sessions: [] })
        }
        groups.get(key)!.sessions.push(session)
    })

    return Array.from(groups.entries())
        .map(([key, { project, sessions: groupSessions }]) => {
            const sortedSessions = [...groupSessions].sort((a, b) => {
                const rankA = a.active ? (a.pendingRequestsCount > 0 ? 0 : 1) : 2
                const rankB = b.active ? (b.pendingRequestsCount > 0 ? 0 : 1) : 2
                if (rankA !== rankB) return rankA - rankB
                return b.updatedAt - a.updatedAt
            })
            const latestUpdatedAt = groupSessions.reduce(
                (max, s) => (s.updatedAt > max ? s.updatedAt : max),
                -Infinity
            )
            const hasActiveSession = groupSessions.some(s => s.active)

            return {
                projectId: project?.id ?? null,
                projectName: project?.name ?? 'Other',
                projectPath: project?.path ?? null,
                sessions: sortedSessions,
                latestUpdatedAt,
                hasActiveSession
            }
        })
        .sort((a, b) => {
            if (a.hasActiveSession !== b.hasActiveSession) {
                return a.hasActiveSession ? -1 : 1
            }
            return b.latestUpdatedAt - a.latestUpdatedAt
        })
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
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

function ChevronIcon(props: { className?: string; collapsed?: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${props.className ?? ''} transition-transform duration-200 ${props.collapsed ? '' : 'rotate-90'}`}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function FolderIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    )
}

function getSessionTitle(session: SessionSummary): string {
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

function getTodoProgress(session: SessionSummary): { completed: number; total: number } | null {
    if (!session.todoProgress) return null
    if (session.todoProgress.completed === session.todoProgress.total) return null
    return session.todoProgress
}

function getAgentLabel(session: SessionSummary): string {
    const flavor = session.metadata?.flavor?.trim()
    if (flavor === 'claude') return 'Claude'
    if (flavor === 'codex') return 'Codex'
    if (flavor === 'gemini') return 'Gemini'
    if (flavor) return flavor
    return 'Agent'
}

function isAdvisorSession(session: SessionSummary): boolean {
    return session.metadata?.runtimeAgent === 'advisor'
}

function formatRelativeTime(value: number): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    const delta = Date.now() - ms
    if (delta < 60_000) return 'now'
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d`
    return new Date(ms).toLocaleDateString()
}

function AdvisorIcon(props: { className?: string }) {
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
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
        </svg>
    )
}

function AdvisorSessionItem(props: {
    session: SessionSummary
    onSelect: (sessionId: string) => void
}) {
    const { session: s, onSelect } = props

    return (
        <button
            type="button"
            onClick={() => onSelect(s.id)}
            className={`
                group flex w-full items-center gap-3 px-3 py-3 text-left
                rounded-lg mb-2
                bg-gradient-to-r from-purple-500/10 to-blue-500/10
                border border-purple-500/20
                transition-all duration-150
                hover:from-purple-500/15 hover:to-blue-500/15
                hover:border-purple-500/30
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500
                ${!s.active ? 'opacity-50' : ''}
            `}
        >
            {/* Advisor icon */}
            <div className="shrink-0">
                <div className={`
                    flex items-center justify-center w-8 h-8 rounded-full
                    bg-gradient-to-br from-purple-500 to-blue-500
                    ${s.active ? 'animate-pulse' : ''}
                `}>
                    <AdvisorIcon className="w-4 h-4 text-white" />
                </div>
            </div>

            {/* Main content */}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400">
                        Team Advisor
                    </span>
                    <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400">
                        AI
                    </span>
                    {s.viewers && s.viewers.length > 0 && (
                        <ViewersBadge viewers={s.viewers} />
                    )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--app-hint)]">
                    <span>{s.active ? 'Monitoring all sessions' : 'Offline'}</span>
                </div>
            </div>

            {/* Status */}
            <div className="shrink-0 flex items-center gap-2">
                <span className={`
                    text-[10px] font-medium px-2 py-1 rounded-full
                    ${s.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-500/15 text-gray-400'}
                `}>
                    {s.active ? 'Active' : 'Offline'}
                </span>
            </div>
        </button>
    )
}

function SessionItem(props: {
    session: SessionSummary
    onSelect: (sessionId: string) => void
}) {
    const { session: s, onSelect } = props
    const progress = getTodoProgress(s)
    const hasPending = s.pendingRequestsCount > 0
    const runtimeAgent = s.metadata?.runtimeAgent?.trim()
    const isAdvisorCreated = Boolean(s.advisorTaskId)

    return (
        <button
            type="button"
            onClick={() => onSelect(s.id)}
            className={`
                group flex w-full items-center gap-3 px-3 py-2 text-left
                transition-all duration-150
                hover:bg-[var(--app-secondary-bg)]
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]
                ${!s.active ? 'opacity-40' : ''}
                ${isAdvisorCreated ? 'border-l-2 border-l-cyan-500 bg-cyan-500/5' : ''}
            `}
        >
            {/* Status indicator */}
            <div className="shrink-0">
                <span
                    className={`
                        block h-2 w-2 rounded-full
                        ${hasPending ? 'bg-amber-500 animate-pulse' : s.active ? 'bg-emerald-500' : 'bg-gray-400'}
                    `}
                />
            </div>

            {/* Main content */}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className={`truncate text-sm font-medium ${isAdvisorCreated ? 'text-cyan-400' : 'text-[var(--app-fg)]'}`}>
                        {getSessionTitle(s)}
                    </span>
                    {isAdvisorCreated && (
                        <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400">
                            Advisor
                        </span>
                    )}
                    {hasPending && (
                        <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600">
                            {s.pendingRequestsCount} pending
                        </span>
                    )}
                    {s.viewers && s.viewers.length > 0 && (
                        <ViewersBadge viewers={s.viewers} />
                    )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--app-hint)]">
                    <span className="shrink-0">{getAgentLabel(s)}</span>
                    {runtimeAgent && (
                        <>
                            <span className="text-[var(--app-divider)]">•</span>
                            <span className="truncate">{runtimeAgent}</span>
                        </>
                    )}
                    {s.metadata?.worktree?.branch && (
                        <>
                            <span className="text-[var(--app-divider)]">•</span>
                            <span className="truncate">{s.metadata.worktree.branch}</span>
                        </>
                    )}
                    {progress && (
                        <>
                            <span className="text-[var(--app-divider)]">•</span>
                            <span>{progress.completed}/{progress.total} tasks</span>
                        </>
                    )}
                </div>
            </div>

            {/* Time */}
            <div className="shrink-0 text-[11px] text-[var(--app-hint)]">
                {formatRelativeTime(s.updatedAt)}
            </div>
        </button>
    )
}

export function SessionList(props: {
    sessions: SessionSummary[]
    projects: Project[]
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onRefresh: () => void
    isLoading: boolean
    renderHeader?: boolean
}) {
    const { renderHeader = true } = props

    // Separate Advisor sessions from regular sessions
    const { advisorSessions, regularSessions } = useMemo(() => {
        const advisor: SessionSummary[] = []
        const regular: SessionSummary[] = []
        for (const session of props.sessions) {
            if (isAdvisorSession(session)) {
                advisor.push(session)
            } else {
                regular.push(session)
            }
        }
        return { advisorSessions: advisor, regularSessions: regular }
    }, [props.sessions])

    const groups = useMemo(
        () => groupSessionsByProject(regularSessions, props.projects),
        [regularSessions, props.projects]
    )
    const [collapseOverrides, setCollapseOverrides] = useState<Map<string, boolean>>(
        () => new Map()
    )
    const getGroupKey = (group: SessionGroup): string => group.projectId ?? '__other__'

    const isGroupCollapsed = (group: SessionGroup): boolean => {
        const override = collapseOverrides.get(getGroupKey(group))
        if (override !== undefined) return override
        return !group.hasActiveSession
    }

    const toggleGroup = (group: SessionGroup, isCollapsed: boolean) => {
        const key = getGroupKey(group)
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(key, !isCollapsed)
            return next
        })
    }

    useEffect(() => {
        setCollapseOverrides(prev => {
            if (prev.size === 0) return prev
            const next = new Map(prev)
            const knownGroups = new Set(groups.map(getGroupKey))
            let changed = false
            for (const key of next.keys()) {
                if (!knownGroups.has(key)) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [groups])

    return (
        <div className="mx-auto w-full max-w-content flex flex-col">
            {renderHeader ? (
                <div className="flex items-center justify-between px-3 py-1">
                    <div className="text-xs text-[var(--app-hint)]">
                        {props.sessions.length} sessions in {groups.length} projects
                    </div>
                    <button
                        type="button"
                        onClick={props.onNewSession}
                        className="session-list-new-button p-1.5 rounded-full text-[var(--app-link)] transition-colors"
                        title="New Session"
                    >
                        <PlusIcon className="h-5 w-5" />
                    </button>
                </div>
            ) : null}

            <div className="flex flex-col gap-1 p-2">
                {/* Advisor sessions - always at top */}
                {advisorSessions.map((s) => (
                    <AdvisorSessionItem
                        key={s.id}
                        session={s}
                        onSelect={props.onSelect}
                    />
                ))}

                {/* Regular sessions grouped by project */}
                {groups.map((group) => {
                    const isCollapsed = isGroupCollapsed(group)
                    const activeCount = group.sessions.filter(s => s.active).length
                    const groupKey = getGroupKey(group)
                    return (
                        <div
                            key={groupKey}
                            className="rounded-lg bg-[var(--app-subtle-bg)]"
                        >
                            {/* Group header */}
                            <button
                                type="button"
                                onClick={() => toggleGroup(group, isCollapsed)}
                                title={group.projectPath ?? group.projectName}
                                className="
                                    flex w-full items-center gap-2 px-3 py-2
                                    text-left transition-colors
                                    hover:bg-[var(--app-secondary-bg)]
                                "
                            >
                                <ChevronIcon
                                    className="shrink-0 text-[var(--app-hint)]"
                                    collapsed={isCollapsed}
                                />
                                <FolderIcon className="shrink-0 text-[var(--app-hint)]" />
                                <span className="truncate text-sm font-medium">
                                    {group.projectName}
                                </span>
                                <div className="flex items-center gap-1.5 ml-auto shrink-0">
                                    {activeCount > 0 && (
                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">
                                            {activeCount} active
                                        </span>
                                    )}
                                    <span className="text-[11px] text-[var(--app-hint)]">
                                        {group.sessions.length}
                                    </span>
                                </div>
                            </button>

                            {/* Sessions list */}
                            {!isCollapsed && (
                                <div className="border-t border-[var(--app-divider)]">
                                    {group.sessions.map((s) => (
                                        <SessionItem
                                            key={s.id}
                                            session={s}
                                            onSelect={props.onSelect}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
