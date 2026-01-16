import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Project, Session, SessionViewer } from '@/types/api'
import { isTelegramApp, getTelegramWebApp } from '@/hooks/useTelegram'
import { getClientId } from '@/lib/client-identity'
import { ViewersBadge } from './ViewersBadge'
import { useAppContext } from '@/lib/app-context'
import { JoinReviewButton } from './Review'

function getSessionPath(session: Session): string | null {
    return session.metadata?.worktree?.basePath ?? session.metadata?.path ?? null
}

function matchSessionToProject(session: Session, projects: Project[]): Project | null {
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

function BellIcon(props: { className?: string; subscribed?: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={props.subscribed ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
    )
}

function XIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
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

function ChevronDownIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="6 9 12 15 18 9" />
        </svg>
    )
}

function MoreIcon(props: { className?: string }) {
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
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="19" r="1" />
        </svg>
    )
}

function RefreshAccountIcon(props: { className?: string }) {
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
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
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
    onDelete?: () => void
    onRefreshAccount?: () => void
    onReviewCreated?: (reviewSessionId: string) => void
    /** 是否已打开 Review 面板 */
    isReviewPanelOpen?: boolean
    /** 切换 Review 面板 */
    onToggleReviewPanel?: () => void
    deleteDisabled?: boolean
    refreshAccountDisabled?: boolean
}) {
    const { api, userEmail } = useAppContext()
    const queryClient = useQueryClient()
    const title = useMemo(() => getSessionTitle(props.session), [props.session])
    const worktreeBranch = props.session.metadata?.worktree?.branch
    const agentLabel = useMemo(() => getAgentLabel(props.session), [props.session])
    const runtimeAgent = props.session.metadata?.runtimeAgent?.trim() || null
    const runtimeModel = useMemo(() => formatRuntimeModel(props.session), [props.session])

    // 查询项目列表
    const { data: projectsData } = useQuery({
        queryKey: ['projects'],
        queryFn: async () => api.getProjects()
    })
    const projects = Array.isArray(projectsData?.projects) ? projectsData.projects : []
    const project = useMemo(() => matchSessionToProject(props.session, projects), [props.session, projects])

    const agentMeta = useMemo(
        () => {
            const parts = [agentLabel]
            if (runtimeAgent) {
                parts.push(runtimeAgent)
            }
            if (runtimeModel) {
                parts.push(runtimeModel)
            }
            if (project) {
                parts.push(project.name)
            }
            if (worktreeBranch) {
                parts.push(worktreeBranch)
            }
            return parts.join(' · ')
        },
        [agentLabel, runtimeAgent, runtimeModel, project, worktreeBranch]
    )

    // Subscription state - supports both Telegram chatId and Web clientId
    const tg = getTelegramWebApp()
    const currentChatId = tg?.initDataUnsafe?.user?.id?.toString() ?? null
    const currentClientId = getClientId()

    // Check if current user is the creator of this session
    const isCreator = useMemo(() => {
        if (!userEmail) return false
        return props.session.createdBy === userEmail
    }, [userEmail, props.session.createdBy])

    // 过滤掉自己，只显示其他在线用户
    const otherViewers = useMemo(() => {
        if (!props.viewers) return []
        return props.viewers.filter(v => v.clientId !== currentClientId)
    }, [props.viewers, currentClientId])

    const subscribersQueryKey = ['session-subscribers', props.session.id]
    const { data: subscribersData } = useQuery({
        queryKey: subscribersQueryKey,
        queryFn: async () => {
            return await api.getSessionSubscribers(props.session.id)
        },
        staleTime: 30000
    })

    const isSubscribed = useMemo(() => {
        if (!subscribersData) return false
        // Check via chatId (Telegram users)
        if (currentChatId) {
            if (subscribersData.creatorChatId === currentChatId ||
                subscribersData.subscribers.includes(currentChatId)) {
                return true
            }
        }
        // Check via clientId (non-Telegram users)
        if (currentClientId && subscribersData.clientIdSubscribers?.includes(currentClientId)) {
            return true
        }
        return false
    }, [currentChatId, currentClientId, subscribersData])

    const toggleSubscriptionMutation = useMutation({
        mutationFn: async (subscribe: boolean) => {
            // Prefer chatId if available (Telegram), otherwise use clientId
            const options = currentChatId ? { chatId: currentChatId } : { clientId: currentClientId }
            if (subscribe) {
                return await api.subscribeToSession(props.session.id, options)
            } else {
                return await api.unsubscribeFromSession(props.session.id, options)
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: subscribersQueryKey })
        }
    })

    // 移除订阅者的 mutation
    const removeSubscriberMutation = useMutation({
        mutationFn: async ({ subscriberId, type }: { subscriberId: string; type: 'chatId' | 'clientId' }) => {
            return await api.removeSessionSubscriber(props.session.id, subscriberId, type)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: subscribersQueryKey })
        }
    })

    // 订阅者下拉菜单状态
    const [showSubscribersMenu, setShowSubscribersMenu] = useState(false)
    const subscribersMenuRef = useRef<HTMLDivElement>(null)

    // 移动端更多菜单状态
    const [showMoreMenu, setShowMoreMenu] = useState(false)
    const moreMenuRef = useRef<HTMLDivElement>(null)

    // 移动端 agent 详情弹出框状态
    const [showAgentDetails, setShowAgentDetails] = useState(false)
    const agentDetailsRef = useRef<HTMLDivElement>(null)

    // 点击外部关闭菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (subscribersMenuRef.current && !subscribersMenuRef.current.contains(event.target as Node)) {
                setShowSubscribersMenu(false)
            }
            if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
                setShowMoreMenu(false)
            }
            if (agentDetailsRef.current && !agentDetailsRef.current.contains(event.target as Node)) {
                setShowAgentDetails(false)
            }
        }
        if (showSubscribersMenu || showMoreMenu || showAgentDetails) {
            document.addEventListener('mousedown', handleClickOutside)
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [showSubscribersMenu, showMoreMenu, showAgentDetails])

    // 计算订阅者总数
    const totalSubscribers = useMemo(() => {
        if (!subscribersData) return 0
        let count = 0
        if (subscribersData.creatorChatId) count++
        count += subscribersData.subscribers.length
        count += (subscribersData.clientIdSubscribers?.length ?? 0)
        // 去重 creator 和 subscribers 中的重复
        if (subscribersData.creatorChatId && subscribersData.subscribers.includes(subscribersData.creatorChatId)) {
            count--
        }
        return count
    }, [subscribersData])

    useEffect(() => {
        setShowSubscribersMenu(false)
        setShowMoreMenu(false)
        setShowAgentDetails(false)
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
                    <div className="min-w-0 flex-1 relative" ref={agentDetailsRef}>
                        <div className="max-w-[180px] truncate font-medium text-sm sm:max-w-none">
                            {title}
                        </div>
                        {/* PC端：显示完整 agentMeta */}
                        <div className="hidden sm:block text-[10px] text-[var(--app-hint)] truncate">
                            {agentMeta}
                        </div>
                        {/* 移动端：只显示 agentLabel，点击弹出详情 */}
                        <button
                            type="button"
                            onClick={() => setShowAgentDetails(!showAgentDetails)}
                            className="sm:hidden text-[10px] text-[var(--app-hint)] truncate max-w-[180px] text-left"
                        >
                            {agentLabel} {(runtimeAgent || runtimeModel || project || worktreeBranch) && '...'}
                        </button>
                        {/* 移动端详情弹出框 */}
                        {showAgentDetails && (
                            <div className="sm:hidden absolute left-0 top-full z-30 mt-1 min-w-[200px] max-w-[280px] rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] py-2 px-3 shadow-lg">
                                <div className="text-xs text-[var(--app-fg)] space-y-1">
                                    <div><span className="text-[var(--app-hint)]">Agent:</span> {agentLabel}</div>
                                    {runtimeAgent && <div><span className="text-[var(--app-hint)]">Runtime:</span> {runtimeAgent}</div>}
                                    {runtimeModel && <div><span className="text-[var(--app-hint)]">Model:</span> {runtimeModel}</div>}
                                    {project && <div><span className="text-[var(--app-hint)]">Project:</span> {project.name}</div>}
                                    {worktreeBranch && <div><span className="text-[var(--app-hint)]">Branch:</span> {worktreeBranch}</div>}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right side: Viewers + Action buttons */}
                <div className="flex shrink-0 items-center gap-1.5">
                    {/* Join Review AI 按钮 (试验性功能) - PC端显示 */}
                    {props.session.active && (
                        <div className="hidden sm:block">
                            <JoinReviewButton
                                sessionId={props.session.id}
                                isReviewPanelOpen={props.isReviewPanelOpen}
                                onToggleReviewPanel={props.onToggleReviewPanel}
                                onReviewCreated={props.onReviewCreated}
                            />
                        </div>
                    )}
                    {/* PC端：在线用户（排除自己） */}
                    {otherViewers.length > 0 && (
                        <div className="hidden sm:block">
                            <ViewersBadge viewers={otherViewers} compact buttonClassName="h-7 leading-none" />
                        </div>
                    )}
                    {/* Subscription toggle with dropdown menu - PC端显示 (hide if creator) */}
                    {!isCreator && <div className="hidden sm:block relative" ref={subscribersMenuRef}>
                        <div className="flex items-center">
                            {/* 主按钮：切换自己的订阅 */}
                            <button
                                type="button"
                                onClick={() => toggleSubscriptionMutation.mutate(!isSubscribed)}
                                disabled={toggleSubscriptionMutation.isPending}
                                className={`flex h-7 items-center justify-center rounded-l-md pl-2 pr-1 transition-colors ${
                                    isSubscribed
                                        ? 'bg-blue-500/10 text-blue-600 hover:bg-blue-500/20'
                                        : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]'
                                } disabled:opacity-50`}
                                title={isSubscribed ? 'Subscribed (click to unsubscribe)' : 'Subscribe'}
                            >
                                <BellIcon subscribed={isSubscribed} />
                                {totalSubscribers > 0 && (
                                    <span className="ml-1 text-[10px] font-medium">{totalSubscribers}</span>
                                )}
                            </button>
                            {/* 下拉按钮：显示订阅者列表 */}
                            <button
                                type="button"
                                onClick={() => setShowSubscribersMenu(!showSubscribersMenu)}
                                className={`flex h-7 w-5 items-center justify-center rounded-r-md border-l transition-colors ${
                                    isSubscribed
                                        ? 'bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 border-blue-500/20'
                                        : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] border-[var(--app-divider)]'
                                }`}
                                title="Manage subscribers"
                            >
                                <ChevronDownIcon />
                            </button>
                        </div>
                        {/* 订阅者下拉菜单 */}
                        {showSubscribersMenu && subscribersData && (
                            <div className="absolute right-0 top-full z-30 mt-1 min-w-[200px] max-w-[280px] rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] py-1 shadow-lg">
                                <div className="px-3 py-1.5 text-[10px] font-medium text-[var(--app-hint)] uppercase tracking-wider">
                                    Subscribers ({totalSubscribers})
                                </div>
                                {totalSubscribers === 0 ? (
                                    <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
                                        No subscribers
                                    </div>
                                ) : (
                                    <div className="max-h-[200px] overflow-y-auto">
                                        {/* Creator */}
                                        {subscribersData.creatorChatId && !subscribersData.subscribers.includes(subscribersData.creatorChatId) && (
                                            <div className="flex items-center justify-between px-3 py-1.5 hover:bg-[var(--app-subtle-bg)]">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-xs truncate">
                                                        {subscribersData.creatorChatId === currentChatId ? 'Me (creator)' : `TG: ${subscribersData.creatorChatId}`}
                                                    </span>
                                                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">
                                                        Creator
                                                    </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeSubscriberMutation.mutate({ subscriberId: subscribersData.creatorChatId!, type: 'chatId' })}
                                                    disabled={removeSubscriberMutation.isPending}
                                                    className="shrink-0 p-1 rounded hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                                                    title="Remove"
                                                >
                                                    <XIcon />
                                                </button>
                                            </div>
                                        )}
                                        {/* ChatId subscribers */}
                                        {subscribersData.subscribers.map((chatId) => (
                                            <div key={`chat-${chatId}`} className="flex items-center justify-between px-3 py-1.5 hover:bg-[var(--app-subtle-bg)]">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-xs truncate">
                                                        {chatId === currentChatId ? 'Me' : `TG: ${chatId}`}
                                                    </span>
                                                    {chatId === subscribersData.creatorChatId && (
                                                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">
                                                            Creator
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeSubscriberMutation.mutate({ subscriberId: chatId, type: 'chatId' })}
                                                    disabled={removeSubscriberMutation.isPending}
                                                    className="shrink-0 p-1 rounded hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                                                    title="Remove"
                                                >
                                                    <XIcon />
                                                </button>
                                            </div>
                                        ))}
                                        {/* ClientId subscribers */}
                                        {subscribersData.clientIdSubscribers?.map((clientId) => (
                                            <div key={`client-${clientId}`} className="flex items-center justify-between px-3 py-1.5 hover:bg-[var(--app-subtle-bg)]">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-xs truncate">
                                                        {clientId === currentClientId ? 'Me (Web)' : `Web: ${clientId.slice(0, 8)}...`}
                                                    </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeSubscriberMutation.mutate({ subscriberId: clientId, type: 'clientId' })}
                                                    disabled={removeSubscriberMutation.isPending}
                                                    className="shrink-0 p-1 rounded hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                                                    title="Remove"
                                                >
                                                    <XIcon />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>}
                    {/* PC端：独立按钮 */}
                    <div className="hidden sm:flex items-center gap-1.5">
                        {props.onRefreshAccount ? (
                            <button
                                type="button"
                                onClick={props.onRefreshAccount}
                                disabled={props.refreshAccountDisabled}
                                className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--app-subtle-bg)] text-[var(--app-hint)] transition-colors hover:bg-green-500/10 hover:text-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Refresh account (keep context)"
                            >
                                <RefreshAccountIcon />
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
                    {/* 移动端：更多菜单 */}
                    <div className="sm:hidden relative" ref={moreMenuRef}>
                        <button
                            type="button"
                            onClick={() => setShowMoreMenu(!showMoreMenu)}
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--app-subtle-bg)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title="More"
                        >
                            <MoreIcon />
                        </button>
                        {showMoreMenu && (
                            <div className="absolute right-0 top-full z-30 mt-1 min-w-[160px] rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] py-1 shadow-lg">
                                {/* 在线用户列表（排除自己） */}
                                {otherViewers.length > 0 && (
                                    <>
                                        <div className="px-3 py-1.5 text-[10px] font-medium text-[var(--app-hint)] uppercase tracking-wider">
                                            Online ({otherViewers.length})
                                        </div>
                                        {otherViewers.map((viewer) => (
                                            <div key={viewer.clientId} className="flex items-center gap-2 px-3 py-1.5">
                                                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                                                <span className="text-xs text-[var(--app-fg)] truncate">
                                                    {viewer.email.split('@')[0]}
                                                </span>
                                            </div>
                                        ))}
                                        <div className="my-1 border-t border-[var(--app-divider)]" />
                                    </>
                                )}
                                {/* Review 按钮 */}
                                {props.session.active && props.onToggleReviewPanel && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowMoreMenu(false)
                                            props.onToggleReviewPanel?.()
                                        }}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                            props.isReviewPanelOpen
                                                ? 'text-purple-600 bg-purple-500/10'
                                                : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                        }`}
                                    >
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
                                            className="shrink-0"
                                        >
                                            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                                            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                                        </svg>
                                        <span>Review</span>
                                    </button>
                                )}
                                {/* 订阅按钮 (hide if creator) */}
                                {!isCreator && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            toggleSubscriptionMutation.mutate(!isSubscribed)
                                            setShowMoreMenu(false)
                                        }}
                                        disabled={toggleSubscriptionMutation.isPending}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                            isSubscribed
                                                ? 'text-blue-600 bg-blue-500/10'
                                                : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                        } disabled:opacity-50`}
                                    >
                                        <BellIcon subscribed={isSubscribed} className="shrink-0" />
                                        <span>{isSubscribed ? 'Unsubscribe' : 'Subscribe'}</span>
                                        {totalSubscribers > 0 && (
                                            <span className="ml-auto text-[10px] text-[var(--app-hint)]">{totalSubscribers}</span>
                                        )}
                                    </button>
                                )}
                                {/* 刷新账号 */}
                                {props.onRefreshAccount ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowMoreMenu(false)
                                            props.onRefreshAccount?.()
                                        }}
                                        disabled={props.refreshAccountDisabled}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <RefreshAccountIcon className="shrink-0" />
                                        <span className="whitespace-nowrap">Refresh Account</span>
                                    </button>
                                ) : null}
                                {/* 删除会话 */}
                                {props.onDelete ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowMoreMenu(false)
                                            props.onDelete?.()
                                        }}
                                        disabled={props.deleteDisabled}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <TrashIcon className="shrink-0" />
                                        <span className="whitespace-nowrap">Delete Session</span>
                                    </button>
                                ) : null}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
