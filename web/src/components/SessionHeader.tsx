import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Session, SessionViewer } from '@/types/api'
import { isTelegramApp, getTelegramWebApp } from '@/hooks/useTelegram'
import { getClientId } from '@/lib/client-identity'
import { ViewersBadge } from './ViewersBadge'
import { useAppContext } from '@/lib/app-context'
import { JoinReviewButton } from './Review'

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

    // Subscription state - supports both Telegram chatId and Web clientId
    const tg = getTelegramWebApp()
    const currentChatId = tg?.initDataUnsafe?.user?.id?.toString() ?? null
    const currentClientId = getClientId()

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

    // 点击外部关闭菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (subscribersMenuRef.current && !subscribersMenuRef.current.contains(event.target as Node)) {
                setShowSubscribersMenu(false)
            }
        }
        if (showSubscribersMenu) {
            document.addEventListener('mousedown', handleClickOutside)
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [showSubscribersMenu])

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
        setShowAgentTip(false)
        setShowSubscribersMenu(false)
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
                    {/* Join Review AI 按钮 (试验性功能) */}
                    {props.session.active && (
                        <JoinReviewButton
                            sessionId={props.session.id}
                            isReviewPanelOpen={props.isReviewPanelOpen}
                            onToggleReviewPanel={props.onToggleReviewPanel}
                            onReviewCreated={props.onReviewCreated}
                        />
                    )}
                    {props.viewers && props.viewers.length > 0 && (
                        <ViewersBadge viewers={props.viewers} compact buttonClassName="h-5 leading-none" />
                    )}
                    {/* Subscription toggle with dropdown menu */}
                    <div className="relative" ref={subscribersMenuRef}>
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
                                title={isSubscribed ? '已订阅通知 (点击取消)' : '订阅通知'}
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
                                title="管理订阅者"
                            >
                                <ChevronDownIcon />
                            </button>
                        </div>
                        {/* 订阅者下拉菜单 */}
                        {showSubscribersMenu && subscribersData && (
                            <div className="absolute right-0 top-full z-30 mt-1 min-w-[200px] max-w-[280px] rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] py-1 shadow-lg">
                                <div className="px-3 py-1.5 text-[10px] font-medium text-[var(--app-hint)] uppercase tracking-wider">
                                    通知订阅者 ({totalSubscribers})
                                </div>
                                {totalSubscribers === 0 ? (
                                    <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
                                        暂无订阅者
                                    </div>
                                ) : (
                                    <div className="max-h-[200px] overflow-y-auto">
                                        {/* Creator */}
                                        {subscribersData.creatorChatId && !subscribersData.subscribers.includes(subscribersData.creatorChatId) && (
                                            <div className="flex items-center justify-between px-3 py-1.5 hover:bg-[var(--app-subtle-bg)]">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-xs truncate">
                                                        {subscribersData.creatorChatId === currentChatId ? '我 (创建者)' : `TG: ${subscribersData.creatorChatId}`}
                                                    </span>
                                                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">
                                                        创建者
                                                    </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeSubscriberMutation.mutate({ subscriberId: subscribersData.creatorChatId!, type: 'chatId' })}
                                                    disabled={removeSubscriberMutation.isPending}
                                                    className="shrink-0 p-1 rounded hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                                                    title="移除订阅"
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
                                                        {chatId === currentChatId ? '我' : `TG: ${chatId}`}
                                                    </span>
                                                    {chatId === subscribersData.creatorChatId && (
                                                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">
                                                            创建者
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeSubscriberMutation.mutate({ subscriberId: chatId, type: 'chatId' })}
                                                    disabled={removeSubscriberMutation.isPending}
                                                    className="shrink-0 p-1 rounded hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                                                    title="移除订阅"
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
                                                        {clientId === currentClientId ? '我 (Web)' : `Web: ${clientId.slice(0, 8)}...`}
                                                    </span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeSubscriberMutation.mutate({ subscriberId: clientId, type: 'clientId' })}
                                                    disabled={removeSubscriberMutation.isPending}
                                                    className="shrink-0 p-1 rounded hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                                                    title="移除订阅"
                                                >
                                                    <XIcon />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    {/* PC端：独立按钮 */}
                    <div className="hidden sm:flex items-center gap-1.5">
                        {props.onRefreshAccount ? (
                            <button
                                type="button"
                                onClick={props.onRefreshAccount}
                                disabled={props.refreshAccountDisabled}
                                className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--app-subtle-bg)] text-[var(--app-hint)] transition-colors hover:bg-green-500/10 hover:text-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="刷新账号 (保留上下文)"
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
                    {/* 移动端：按钮组 */}
                    <div className="sm:hidden flex items-center rounded-md bg-[var(--app-subtle-bg)] overflow-hidden">
                        {props.onRefreshAccount ? (
                            <button
                                type="button"
                                onClick={props.onRefreshAccount}
                                disabled={props.refreshAccountDisabled}
                                className="flex h-7 w-7 items-center justify-center text-[var(--app-hint)] transition-colors hover:bg-green-500/10 hover:text-green-600 disabled:opacity-50 disabled:cursor-not-allowed border-r border-[var(--app-divider)]"
                                title="刷新账号 (保留上下文)"
                            >
                                <RefreshAccountIcon />
                            </button>
                        ) : null}
                        {props.onDelete ? (
                            <button
                                type="button"
                                onClick={props.onDelete}
                                disabled={props.deleteDisabled}
                                className="flex h-7 w-7 items-center justify-center text-[var(--app-hint)] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Delete session"
                            >
                                <TrashIcon />
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    )
}
