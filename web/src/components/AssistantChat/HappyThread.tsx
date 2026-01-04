import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ThreadPrimitive } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type { SessionMetadataSummary } from '@/types/api'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { HappyAssistantMessage } from '@/components/AssistantChat/messages/AssistantMessage'
import { HappyUserMessage } from '@/components/AssistantChat/messages/UserMessage'
import { HappySystemMessage } from '@/components/AssistantChat/messages/SystemMessage'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { useIdleSuggestion } from '@/hooks/useIdleSuggestion'
import type { SuggestionChip, MinimaxStatus } from '@/hooks/useIdleSuggestion'

function NewMessagesIndicator(props: { count: number; onClick: () => void }) {
    if (props.count === 0) {
        return null
    }

    return (
        <button
            onClick={props.onClick}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-[var(--app-button)] text-[var(--app-button-text)] px-3 py-1.5 rounded-full text-sm font-medium shadow-lg animate-bounce-in z-10"
        >
            {props.count} new message{props.count > 1 ? 's' : ''} &#8595;
        </button>
    )
}

const chipCategoryStyles: Record<string, string> = {
    todo_check: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30',
    error_analysis: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/30',
    code_review: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/30',
    general: 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/50'
}

function InlineSuggestionChips(props: {
    chips: SuggestionChip[]
    reason?: string
    onSelect: (chipId: string) => void
    onDismiss: () => void
    // MiniMax Layer 2
    minimaxStatus?: MinimaxStatus
    minimaxChips?: SuggestionChip[]
    minimaxError?: string
}) {
    const hasLayer1Chips = props.chips.length > 0
    const hasLayer2Chips = props.minimaxChips && props.minimaxChips.length > 0
    const isMinimaxReviewing = props.minimaxStatus === 'reviewing'
    const hasMinimaxError = props.minimaxStatus === 'error'

    // 如果两层都没内容且不在审查中，不显示
    if (!hasLayer1Chips && !hasLayer2Chips && !isMinimaxReviewing && !hasMinimaxError) {
        return null
    }

    return (
        <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl bg-[var(--app-subtle-bg)] px-4 py-3">
                {/* AI 标识和原因 */}
                <div className="flex items-center gap-2 mb-2 text-xs text-[var(--app-hint)]">
                    <span className="flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 8V4H8" />
                            <rect width="16" height="12" x="4" y="8" rx="2" />
                            <path d="M2 14h2" />
                            <path d="M20 14h2" />
                            <path d="M15 13v2" />
                            <path d="M9 13v2" />
                        </svg>
                        <span className="font-medium">AI 建议</span>
                    </span>
                    {props.reason && (
                        <>
                            <span className="opacity-40">·</span>
                            <span className="opacity-60">{props.reason}</span>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={props.onDismiss}
                        className="ml-auto p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                        aria-label="关闭建议"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                        </svg>
                    </button>
                </div>

                {/* Layer 1 芯片列表 */}
                {hasLayer1Chips && (
                    <div className="flex flex-wrap gap-1.5">
                        {props.chips.map((chip) => (
                            <button
                                key={chip.id}
                                type="button"
                                onClick={() => props.onSelect(chip.id)}
                                className={`
                                    inline-flex items-center gap-1 px-2.5 py-1
                                    rounded-full border text-xs font-medium
                                    transition-all duration-150 ease-out
                                    active:scale-[0.97]
                                    ${chipCategoryStyles[chip.category] || chipCategoryStyles.general}
                                `}
                                title={chip.text}
                            >
                                {chip.icon && <span>{chip.icon}</span>}
                                <span className="whitespace-nowrap">{chip.label}</span>
                            </button>
                        ))}
                    </div>
                )}

                {/* Layer 2: MiniMax 审查状态 */}
                {isMinimaxReviewing && (
                    <div className={`flex items-center gap-2 text-xs text-[var(--app-hint)] ${hasLayer1Chips ? 'mt-3 pt-3 border-t border-[var(--app-border)]' : ''}`}>
                        <Spinner className="w-3 h-3" />
                        <span>MiniMax 正在审查...</span>
                    </div>
                )}

                {/* Layer 2: MiniMax 芯片 */}
                {hasLayer2Chips && (
                    <div className={`${hasLayer1Chips ? 'mt-3 pt-3 border-t border-[var(--app-border)]' : ''}`}>
                        <div className="flex items-center gap-1 mb-2 text-xs text-[var(--app-hint)]">
                            <span>✨</span>
                            <span>MiniMax 建议</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {props.minimaxChips!.map((chip) => (
                                <button
                                    key={chip.id}
                                    type="button"
                                    onClick={() => props.onSelect(chip.id)}
                                    className={`
                                        inline-flex items-center gap-1 px-2.5 py-1
                                        rounded-full border text-xs font-medium
                                        transition-all duration-150 ease-out
                                        active:scale-[0.97]
                                        ${chipCategoryStyles[chip.category] || chipCategoryStyles.general}
                                    `}
                                    title={chip.text}
                                >
                                    {chip.icon && <span>{chip.icon}</span>}
                                    <span className="whitespace-nowrap">{chip.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Layer 2: MiniMax 错误 */}
                {hasMinimaxError && (
                    <div className={`flex items-center gap-2 text-xs text-orange-600 dark:text-orange-400 ${hasLayer1Chips ? 'mt-3 pt-3 border-t border-[var(--app-border)]' : ''}`}>
                        <span>⚠️</span>
                        <span>MiniMax 审查失败</span>
                    </div>
                )}
            </div>
        </div>
    )
}

function MessageSkeleton() {
    const rows = [
        { align: 'end', width: 'w-2/3', height: 'h-10' },
        { align: 'start', width: 'w-3/4', height: 'h-12' },
        { align: 'end', width: 'w-1/2', height: 'h-9' },
        { align: 'start', width: 'w-5/6', height: 'h-14' }
    ]

    return (
        <div role="status" aria-live="polite">
            <span className="sr-only">Loading messages…</span>
            <div className="space-y-3 animate-pulse">
                {rows.map((row, index) => (
                    <div key={`skeleton-${index}`} className={row.align === 'end' ? 'flex justify-end' : 'flex justify-start'}>
                        <div className={`${row.height} ${row.width} rounded-xl bg-[var(--app-subtle-bg)]`} />
                    </div>
                ))}
            </div>
        </div>
    )
}

const THREAD_MESSAGE_COMPONENTS = {
    UserMessage: HappyUserMessage,
    AssistantMessage: HappyAssistantMessage,
    SystemMessage: HappySystemMessage
} as const

export function HappyThread(props: {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    disabled: boolean
    onRefresh: () => void
    onRetryMessage?: (localId: string) => void
    isLoadingMessages: boolean
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMoreMessages: boolean
    onLoadMore: () => Promise<unknown>
    rawMessagesCount: number
    normalizedMessagesCount: number
    renderedMessagesCount: number
    onApplyChip?: (text: string) => void
}) {
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const topSentinelRef = useRef<HTMLDivElement | null>(null)
    const loadLockRef = useRef(false)
    const pendingScrollRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
    const prevLoadingMoreRef = useRef(false)
    const loadStartedRef = useRef(false)
    const isLoadingMoreRef = useRef(props.isLoadingMoreMessages)

    // Smart scroll state: autoScroll enabled when user is near bottom
    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
    const [newMessageCount, setNewMessageCount] = useState(0)
    const prevRenderedCountRef = useRef(props.renderedMessagesCount)
    const autoScrollEnabledRef = useRef(autoScrollEnabled)
    const newMessageCountRef = useRef(newMessageCount)
    const hasBootstrappedRef = useRef(false)

    // Keep refs in sync with state
    useEffect(() => {
        autoScrollEnabledRef.current = autoScrollEnabled
    }, [autoScrollEnabled])
    useEffect(() => {
        newMessageCountRef.current = newMessageCount
    }, [newMessageCount])

    // Track scroll position to toggle autoScroll (stable listener using refs)
    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return

        const THRESHOLD_PX = 120

        const handleScroll = () => {
            const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
            const isNearBottom = distanceFromBottom < THRESHOLD_PX

            if (isNearBottom) {
                if (!autoScrollEnabledRef.current) setAutoScrollEnabled(true)
                if (newMessageCountRef.current > 0) setNewMessageCount(0)
            } else {
                if (autoScrollEnabledRef.current) setAutoScrollEnabled(false)
            }
        }

        viewport.addEventListener('scroll', handleScroll, { passive: true })
        return () => viewport.removeEventListener('scroll', handleScroll)
    }, []) // Stable: no dependencies, reads from refs

    // Track new messages when autoScroll is disabled
    const wasLoadingMoreRef = useRef(props.isLoadingMoreMessages)
    useEffect(() => {
        const prevCount = prevRenderedCountRef.current
        const currentCount = props.renderedMessagesCount
        const wasLoadingMore = wasLoadingMoreRef.current
        wasLoadingMoreRef.current = props.isLoadingMoreMessages

        if (props.isLoadingMessages) {
            prevRenderedCountRef.current = currentCount
            return
        }

        if (!hasBootstrappedRef.current) {
            hasBootstrappedRef.current = true
            prevRenderedCountRef.current = currentCount
            return
        }

        prevRenderedCountRef.current = currentCount

        // Skip during loading states
        if (props.isLoadingMoreMessages) {
            return
        }

        // Skip if load-more just finished (older messages, not new ones)
        if (wasLoadingMore) {
            return
        }

        const newCount = currentCount - prevCount
        if (newCount > 0 && !autoScrollEnabled) {
            setNewMessageCount((prev) => prev + newCount)
        }
    }, [props.renderedMessagesCount, props.isLoadingMoreMessages, props.isLoadingMessages, autoScrollEnabled])

    // Scroll to bottom handler for the indicator button
    const scrollToBottom = useCallback(() => {
        const viewport = viewportRef.current
        if (viewport) {
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
        }
        setAutoScrollEnabled(true)
        setNewMessageCount(0)
    }, [])

    // Reset state when session changes
    useEffect(() => {
        setAutoScrollEnabled(true)
        setNewMessageCount(0)
        prevRenderedCountRef.current = 0
        hasBootstrappedRef.current = false
    }, [props.sessionId])

    // Idle suggestion chips (Layer 1 + Layer 2)
    const {
        suggestion: idleSuggestion,
        chips: idleChips,
        hasChips: hasIdleChips,
        applyChip: applyIdleChip,
        dismiss: dismissIdleSuggestion,
        markViewed: markIdleSuggestionViewed,
        // MiniMax Layer 2
        minimaxStatus,
        minimaxChips,
        minimaxError,
        hasMinimaxChips,
        applyMinimaxChip
    } = useIdleSuggestion(props.sessionId)

    // Mark suggestion as viewed when displayed
    useEffect(() => {
        if (hasIdleChips || minimaxStatus !== 'idle') {
            markIdleSuggestionViewed()
        }
    }, [hasIdleChips, minimaxStatus, markIdleSuggestionViewed])

    const handleChipSelect = useCallback((chipId: string) => {
        // 先尝试 Layer 1 芯片
        let text = applyIdleChip(chipId)
        // 如果不是 Layer 1 芯片，尝试 Layer 2
        if (!text) {
            text = applyMinimaxChip(chipId)
        }
        if (text && props.onApplyChip) {
            props.onApplyChip(text)
        }
    }, [applyIdleChip, applyMinimaxChip, props.onApplyChip])

    // 是否显示建议区域（Layer 1 有芯片 或 Layer 2 正在审查/有芯片/有错误）
    const showSuggestionArea = hasIdleChips || minimaxStatus === 'reviewing' || hasMinimaxChips || minimaxStatus === 'error'

    const handleLoadMore = useCallback(() => {
        if (props.isLoadingMessages || !props.hasMoreMessages || props.isLoadingMoreMessages || loadLockRef.current) {
            return
        }
        const viewport = viewportRef.current
        if (!viewport) {
            return
        }
        pendingScrollRef.current = {
            scrollTop: viewport.scrollTop,
            scrollHeight: viewport.scrollHeight
        }
        loadLockRef.current = true
        loadStartedRef.current = false
        let loadPromise: Promise<unknown>
        try {
            loadPromise = props.onLoadMore()
        } catch (error) {
            pendingScrollRef.current = null
            loadLockRef.current = false
            throw error
        }
        void loadPromise.catch((error) => {
            pendingScrollRef.current = null
            loadLockRef.current = false
            console.error('Failed to load older messages:', error)
        }).finally(() => {
            if (!loadStartedRef.current && !isLoadingMoreRef.current && pendingScrollRef.current) {
                pendingScrollRef.current = null
                loadLockRef.current = false
            }
        })
    }, [props.hasMoreMessages, props.isLoadingMoreMessages, props.isLoadingMessages, props.onLoadMore])

    useEffect(() => {
        const sentinel = topSentinelRef.current
        const viewport = viewportRef.current
        if (!sentinel || !viewport || !props.hasMoreMessages || props.isLoadingMessages) {
            return
        }
        if (typeof IntersectionObserver === 'undefined') {
            return
        }

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        handleLoadMore()
                    }
                }
            },
            {
                root: viewport,
                rootMargin: '200px 0px 0px 0px'
            }
        )

        observer.observe(sentinel)
        return () => observer.disconnect()
    }, [handleLoadMore, props.hasMoreMessages, props.isLoadingMessages])

    useLayoutEffect(() => {
        const pending = pendingScrollRef.current
        const viewport = viewportRef.current
        if (!pending || !viewport) {
            return
        }
        const delta = viewport.scrollHeight - pending.scrollHeight
        viewport.scrollTop = pending.scrollTop + delta
        pendingScrollRef.current = null
        loadLockRef.current = false
    }, [props.rawMessagesCount])

    useEffect(() => {
        isLoadingMoreRef.current = props.isLoadingMoreMessages
        if (props.isLoadingMoreMessages) {
            loadStartedRef.current = true
        }
        if (prevLoadingMoreRef.current && !props.isLoadingMoreMessages && pendingScrollRef.current) {
            pendingScrollRef.current = null
            loadLockRef.current = false
        }
        prevLoadingMoreRef.current = props.isLoadingMoreMessages
    }, [props.isLoadingMoreMessages])

    return (
        <HappyChatProvider value={{
            api: props.api,
            sessionId: props.sessionId,
            metadata: props.metadata,
            disabled: props.disabled,
            onRefresh: props.onRefresh,
            onRetryMessage: props.onRetryMessage
        }}>
            <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col relative">
                <ThreadPrimitive.Viewport asChild autoScroll={autoScrollEnabled}>
                    <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                        <div className="mx-auto w-full max-w-content min-w-0 p-3">
                            <div ref={topSentinelRef} className="h-px w-full" aria-hidden="true" />
                            {props.isLoadingMessages ? (
                                <MessageSkeleton />
                            ) : (
                                <>
                                    {props.messagesWarning ? (
                                        <div className="mb-3 rounded-md bg-amber-500/10 p-2 text-xs">
                                            {props.messagesWarning}
                                        </div>
                                    ) : null}

                                    {props.hasMoreMessages && !props.isLoadingMessages ? (
                                        <div className="py-1 mb-2">
                                            <div className="mx-auto w-fit">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleLoadMore}
                                                    disabled={props.isLoadingMoreMessages || props.isLoadingMessages}
                                                    aria-busy={props.isLoadingMoreMessages}
                                                    className="gap-1.5 text-xs opacity-80 hover:opacity-100"
                                                >
                                                    {props.isLoadingMoreMessages ? (
                                                        <>
                                                            <Spinner size="sm" label={null} className="text-current" />
                                                            Loading…
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span aria-hidden="true">↑</span>
                                                            Load older
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : null}

                                    {import.meta.env.DEV && props.normalizedMessagesCount === 0 && props.rawMessagesCount > 0 ? (
                                        <div className="mb-2 rounded-md bg-amber-500/10 p-2 text-xs">
                                            Message normalization returned 0 items for {props.rawMessagesCount} messages (see `web/src/chat/normalize.ts`).
                                        </div>
                                    ) : null}
                                </>
                            )}
                            <div className="flex flex-col gap-3">
                                <ThreadPrimitive.Messages components={THREAD_MESSAGE_COMPONENTS} />
                                {/* AI 建议芯片 - 融入对话流 (Layer 1 + Layer 2) */}
                                {showSuggestionArea && (
                                    <InlineSuggestionChips
                                        chips={idleChips}
                                        reason={idleSuggestion?.reason}
                                        onSelect={handleChipSelect}
                                        onDismiss={dismissIdleSuggestion}
                                        minimaxStatus={minimaxStatus}
                                        minimaxChips={minimaxChips}
                                        minimaxError={minimaxError}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                </ThreadPrimitive.Viewport>
                <NewMessagesIndicator count={newMessageCount} onClick={scrollToBottom} />
            </ThreadPrimitive.Root>
        </HappyChatProvider>
    )
}
