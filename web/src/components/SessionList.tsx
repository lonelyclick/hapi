import { useMemo, useState } from 'react'
import type { Project, SessionSummary } from '@/types/api'
import { ViewersBadge } from './ViewersBadge'
import { LoadingState } from './LoadingState'

// Filter types
type CreatorFilter = 'mine' | 'others'
type ArchiveFilter = boolean  // true = show archived (offline) sessions only
type AgentFilter = 'claude' | 'codex' | 'opencode'
type ProjectFilter = string | null  // project id or null for all

function getSessionPath(session: SessionSummary): string | null {
    return session.metadata?.worktree?.basePath ?? session.metadata?.path ?? null
}

function matchSessionToProject(session: SessionSummary, projects: Project[]): Project | null {
    const sessionPath = getSessionPath(session)
    if (!sessionPath) return null
    if (!Array.isArray(projects)) return null

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

// Check if session was created by current user
function isMySession(session: SessionSummary, currentUserEmail: string | null): boolean {
    if (!currentUserEmail) return false
    if (!session.createdBy) return false
    return session.createdBy.toLowerCase() === currentUserEmail.toLowerCase()
}

// Get agent type
function getAgentType(session: SessionSummary): 'claude' | 'codex' | 'opencode' | 'other' {
    const flavor = session.metadata?.flavor?.trim()?.toLowerCase()
    if (flavor === 'claude') return 'claude'
    if (flavor === 'codex') return 'codex'
    if (flavor === 'opencode') return 'opencode'
    return 'other'
}

// Sort sessions flat
function sortSessions(sessions: SessionSummary[]): SessionSummary[] {
    if (!Array.isArray(sessions)) return []
    return [...sessions].sort((a, b) => {
        const rankA = a.active ? (a.pendingRequestsCount > 0 ? 0 : 1) : 2
        const rankB = b.active ? (b.pendingRequestsCount > 0 ? 0 : 1) : 2
        if (rankA !== rankB) return rankA - rankB
        return b.updatedAt - a.updatedAt
    })
}

// Filter sessions
function filterSessions(
    sessions: SessionSummary[],
    creatorFilter: CreatorFilter,
    archiveFilter: ArchiveFilter,
    agentFilter: AgentFilter,
    projectFilter: ProjectFilter,
    currentUserEmail: string | null,
    sessionProjectMap: Map<string, Project | null>
): SessionSummary[] {
    return sessions.filter(session => {
        // Creator filter
        if (creatorFilter === 'mine' && !isMySession(session, currentUserEmail)) return false
        if (creatorFilter === 'others' && isMySession(session, currentUserEmail)) return false

        // Archive filter: if true, show only offline sessions; if false, show only active sessions
        if (archiveFilter && session.active) return false
        if (!archiveFilter && !session.active) return false

        // Agent type filter
        const agentType = getAgentType(session)
        if (agentFilter === 'claude' && agentType !== 'claude') return false
        if (agentFilter === 'codex' && agentType !== 'codex') return false
        if (agentFilter === 'opencode' && agentType !== 'opencode') return false

        // Project filter
        if (projectFilter !== null) {
            const project = sessionProjectMap.get(session.id)
            if (project?.id !== projectFilter) return false
        }

        return true
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
    if (flavor === 'opencode') return 'OpenCode'
    if (flavor === 'gemini') return 'Gemini'
    if (flavor) return flavor
    return 'Agent'
}

function getSourceTag(session: SessionSummary): { label: string; color: string } | null {
    const source = session.metadata?.source?.trim()
    if (!source) return null
    // Machine/automation session tags
    if (source.startsWith('hapi_repair')) {
        return { label: '🤖 Auto Repair', color: 'bg-purple-500/15 text-purple-600' }
    }
    if (source === 'external-api') {
        return { label: '🔌 API', color: 'bg-blue-500/15 text-blue-600' }
    }
    if (source.startsWith('automation:') || source.startsWith('bot:') || source.startsWith('script:')) {
        return { label: '⚙️ Automation', color: 'bg-orange-500/15 text-orange-600' }
    }
    // Other custom sources
    if (source.length > 0 && source !== 'manual' && source !== 'webapp') {
        return { label: source.slice(0, 20), color: 'bg-gray-500/15 text-gray-600' }
    }
    return null
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

// Get display name from email (first part before @, or full email if short)
function getCreatorDisplayName(email: string | undefined | null): string | null {
    if (!email) return null
    const atIndex = email.indexOf('@')
    if (atIndex === -1) return email
    const name = email.slice(0, atIndex)
    return name.length > 0 ? name : email
}

function SessionItem(props: {
    session: SessionSummary
    project: Project | null
    showCreator: boolean
    onSelect: (sessionId: string) => void
}) {
    const { session: s, project, showCreator, onSelect } = props
    const progress = getTodoProgress(s)
    const hasPending = s.pendingRequestsCount > 0
    const runtimeAgent = s.metadata?.runtimeAgent?.trim()
    const sourceTag = getSourceTag(s)

    return (
        <button
            type="button"
            onClick={() => onSelect(s.id)}
            className={`
                group flex w-full items-center gap-3 px-3 py-2.5 text-left
                transition-all duration-150
                hover:bg-[var(--app-secondary-bg)]
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]
                ${!s.active ? 'opacity-40' : ''}
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
                    <span className="truncate text-sm font-medium text-[var(--app-fg)]">
                        {getSessionTitle(s)}
                    </span>
                    {sourceTag && (
                        <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${sourceTag.color}`}>
                            {sourceTag.label}
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
                <div className="flex items-center gap-1 mt-0.5 text-[11px] text-[var(--app-hint)]">
                    <span className="shrink-0">{getAgentLabel(s)}</span>
                    {showCreator && s.createdBy && (
                        <>
                            <span className="opacity-50">·</span>
                            <span className="shrink-0" title={s.createdBy}>{getCreatorDisplayName(s.createdBy)}</span>
                        </>
                    )}
                    {project && (
                        <>
                            <span className="opacity-50">·</span>
                            <span className="truncate" title={project.path}>{project.name}</span>
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

// Filter button component
function FilterButton<T extends string>(props: {
    value: T
    current: T
    label: string
    onClick: (value: T) => void
}) {
    const isActive = props.value === props.current
    return (
        <button
            type="button"
            onClick={() => props.onClick(props.value)}
            className={`
                px-2 py-1 text-xs rounded-md transition-colors
                ${isActive
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-sm'
                    : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)]'
                }
            `}
        >
            {props.label}
        </button>
    )
}

export function SessionList(props: {
    sessions: SessionSummary[]
    projects: Project[]
    currentUserEmail: string | null
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onRefresh: () => void
    isLoading: boolean
    renderHeader?: boolean
}) {
    const { renderHeader = true, currentUserEmail } = props

    // Filter state - defaults: mine, not archived, Claude, all projects
    const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>('mine')
    const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>(false)
    const [agentFilter, setAgentFilter] = useState<AgentFilter>('claude')
    const [projectFilter, setProjectFilter] = useState<ProjectFilter>(null)

    // Build session to project mapping
    const sessionProjectMap = useMemo(() => {
        const map = new Map<string, Project | null>()
        if (Array.isArray(props.sessions) && Array.isArray(props.projects)) {
            props.sessions.forEach(session => {
                map.set(session.id, matchSessionToProject(session, props.projects))
            })
        }
        return map
    }, [props.sessions, props.projects])

    // Get projects that have sessions (for filter options)
    const projectsWithSessions = useMemo(() => {
        const projectSet = new Set<string>()
        sessionProjectMap.forEach((project) => {
            if (project) projectSet.add(project.id)
        })
        return props.projects.filter(p => projectSet.has(p.id))
    }, [props.projects, sessionProjectMap])

    // Filter and sort sessions (flat display)
    const filteredSessions = useMemo(() => {
        const filtered = filterSessions(props.sessions, creatorFilter, archiveFilter, agentFilter, projectFilter, currentUserEmail, sessionProjectMap)
        return sortSessions(filtered)
    }, [props.sessions, creatorFilter, archiveFilter, agentFilter, projectFilter, currentUserEmail, sessionProjectMap])

    // Statistics
    const activeCount = filteredSessions.filter(s => s.active).length

    return (
        <div className="mx-auto w-full max-w-content flex flex-col">
            {renderHeader ? (
                <div className="flex items-center justify-between px-3 py-1">
                    <div className="text-xs text-[var(--app-hint)]">
                        {filteredSessions.length} sessions
                        {activeCount > 0 && ` (${activeCount} active)`}
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

            {/* Filters */}
            <div className="flex flex-col gap-2 px-3 py-2 border-b border-[var(--app-divider)]">
                {/* First row: Creator filter + Project filter */}
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-[var(--app-hint)]">Creator:</span>
                        <div className="flex gap-1">
                            <FilterButton value="mine" current={creatorFilter} label="Mine" onClick={setCreatorFilter} />
                            <FilterButton value="others" current={creatorFilter} label="Others" onClick={setCreatorFilter} />
                            <button
                                type="button"
                                onClick={() => setArchiveFilter(!archiveFilter)}
                                className={`
                                    px-2 py-1 text-xs rounded-md transition-colors
                                    ${archiveFilter
                                        ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-sm'
                                        : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)]'
                                    }
                                `}
                            >
                                Archive
                            </button>
                        </div>
                    </div>
                    {/* Project filter - right aligned */}
                    {projectsWithSessions.length > 0 && (
                        <select
                            value={projectFilter ?? ''}
                            onChange={(e) => setProjectFilter(e.target.value || null)}
                            className="ml-auto text-xs px-2 py-1 rounded-md bg-[var(--app-subtle-bg)] text-[var(--app-fg)] border border-[var(--app-divider)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                            <option value="">All Projects</option>
                            {projectsWithSessions.map(project => (
                                <option key={project.id} value={project.id}>{project.name}</option>
                            ))}
                        </select>
                    )}
                </div>

                {/* Second row: Agent type filter */}
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[var(--app-hint)]">Agent:</span>
                    <div className="flex gap-1">
                        <FilterButton value="claude" current={agentFilter} label="Claude" onClick={setAgentFilter} />
                        <FilterButton value="codex" current={agentFilter} label="Codex" onClick={setAgentFilter} />
                        <FilterButton value="opencode" current={agentFilter} label="OpenCode" onClick={setAgentFilter} />
                    </div>
                </div>
            </div>

            {/* Sessions list */}
            <div className="flex flex-col divide-y divide-[var(--app-divider)]">
                {props.isLoading && filteredSessions.length === 0 ? (
                    <div className="px-3 py-8 flex justify-center">
                        <LoadingState label="Loading..." spinnerSize="sm" />
                    </div>
                ) : filteredSessions.length === 0 ? (
                    <div className="px-3 py-8 text-center text-sm text-[var(--app-hint)]">
                        No matching sessions
                    </div>
                ) : (
                    filteredSessions.map((session) => (
                        <SessionItem
                            key={session.id}
                            session={session}
                            project={sessionProjectMap.get(session.id) ?? null}
                            showCreator={creatorFilter !== 'mine'}
                            onSelect={props.onSelect}
                        />
                    ))
                )}
            </div>
        </div>
    )
}
