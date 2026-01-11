import { useMemo, useState } from 'react'
import type { Project, SessionSummary } from '@/types/api'
import { ViewersBadge } from './ViewersBadge'

// 过滤条件类型
type CreatorFilter = 'all' | 'mine' | 'others'
type AgentFilter = 'all' | 'claude' | 'codex'

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

// 判断是否为当前用户创建的 session
function isMySession(session: SessionSummary, currentUserEmail: string | null): boolean {
    if (!currentUserEmail) return false
    if (!session.createdBy) return false
    return session.createdBy.toLowerCase() === currentUserEmail.toLowerCase()
}

// 获取 agent 类型
function getAgentType(session: SessionSummary): 'claude' | 'codex' | 'other' {
    const flavor = session.metadata?.flavor?.trim()?.toLowerCase()
    if (flavor === 'claude') return 'claude'
    if (flavor === 'codex') return 'codex'
    return 'other'
}

// 平铺排序 sessions
function sortSessions(sessions: SessionSummary[]): SessionSummary[] {
    if (!Array.isArray(sessions)) return []
    return [...sessions].sort((a, b) => {
        const rankA = a.active ? (a.pendingRequestsCount > 0 ? 0 : 1) : 2
        const rankB = b.active ? (b.pendingRequestsCount > 0 ? 0 : 1) : 2
        if (rankA !== rankB) return rankA - rankB
        return b.updatedAt - a.updatedAt
    })
}

// 过滤 sessions
function filterSessions(
    sessions: SessionSummary[],
    creatorFilter: CreatorFilter,
    agentFilter: AgentFilter,
    currentUserEmail: string | null
): SessionSummary[] {
    return sessions.filter(session => {
        // 创建者过滤
        if (creatorFilter === 'mine' && !isMySession(session, currentUserEmail)) return false
        if (creatorFilter === 'others' && isMySession(session, currentUserEmail)) return false

        // Agent 类型过滤
        if (agentFilter !== 'all') {
            const agentType = getAgentType(session)
            if (agentFilter === 'claude' && agentType !== 'claude') return false
            if (agentFilter === 'codex' && agentType !== 'codex') return false
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
    if (flavor === 'gemini') return 'Gemini'
    if (flavor) return flavor
    return 'Agent'
}

function getSourceTag(session: SessionSummary): { label: string; color: string } | null {
    const source = session.metadata?.source?.trim()
    if (!source) return null
    // 机器/自动化 session 标识
    if (source.startsWith('hapi_repair')) {
        return { label: '🤖 Auto Repair', color: 'bg-purple-500/15 text-purple-600' }
    }
    if (source === 'external-api') {
        return { label: '🔌 API', color: 'bg-blue-500/15 text-blue-600' }
    }
    if (source.startsWith('automation:') || source.startsWith('bot:') || source.startsWith('script:')) {
        return { label: '⚙️ Automation', color: 'bg-orange-500/15 text-orange-600' }
    }
    // 其他自定义 source
    if (source.length > 0 && source !== 'manual') {
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

function SessionItem(props: {
    session: SessionSummary
    project: Project | null
    onSelect: (sessionId: string) => void
}) {
    const { session: s, project, onSelect } = props
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
                    {/* Project tag */}
                    {project && (
                        <span
                            className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--app-secondary-bg)] text-[var(--app-hint)] border border-[var(--app-divider)]"
                            title={project.path}
                        >
                            {project.name}
                        </span>
                    )}
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

// 过滤按钮组件
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

    // 过滤状态
    const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>('all')
    const [agentFilter, setAgentFilter] = useState<AgentFilter>('all')

    // 构建 session 到 project 的映射
    const sessionProjectMap = useMemo(() => {
        const map = new Map<string, Project | null>()
        if (Array.isArray(props.sessions) && Array.isArray(props.projects)) {
            props.sessions.forEach(session => {
                map.set(session.id, matchSessionToProject(session, props.projects))
            })
        }
        return map
    }, [props.sessions, props.projects])

    // 过滤并排序 sessions（平铺显示）
    const filteredSessions = useMemo(() => {
        const filtered = filterSessions(props.sessions, creatorFilter, agentFilter, currentUserEmail)
        return sortSessions(filtered)
    }, [props.sessions, creatorFilter, agentFilter, currentUserEmail])

    // 统计数据
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

            {/* 过滤条件 */}
            <div className="flex flex-wrap items-center gap-4 px-3 py-2 border-b border-[var(--app-divider)]">
                {/* 创建者过滤 */}
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[var(--app-hint)]">创建者:</span>
                    <div className="flex gap-1">
                        <FilterButton value="all" current={creatorFilter} label="全部" onClick={setCreatorFilter} />
                        <FilterButton value="mine" current={creatorFilter} label="我的" onClick={setCreatorFilter} />
                        <FilterButton value="others" current={creatorFilter} label="其他人" onClick={setCreatorFilter} />
                    </div>
                </div>

                {/* Agent 类型过滤 */}
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[var(--app-hint)]">Agent:</span>
                    <div className="flex gap-1">
                        <FilterButton value="all" current={agentFilter} label="全部" onClick={setAgentFilter} />
                        <FilterButton value="claude" current={agentFilter} label="Claude" onClick={setAgentFilter} />
                        <FilterButton value="codex" current={agentFilter} label="Codex" onClick={setAgentFilter} />
                    </div>
                </div>
            </div>

            {/* 平铺 Sessions 列表 */}
            <div className="flex flex-col divide-y divide-[var(--app-divider)]">
                {filteredSessions.length === 0 ? (
                    <div className="px-3 py-8 text-center text-sm text-[var(--app-hint)]">
                        没有匹配的 Session
                    </div>
                ) : (
                    filteredSessions.map((session) => (
                        <SessionItem
                            key={session.id}
                            session={session}
                            project={sessionProjectMap.get(session.id) ?? null}
                            onSelect={props.onSelect}
                        />
                    ))
                )}
            </div>
        </div>
    )
}
