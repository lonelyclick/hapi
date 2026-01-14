/**
 * Review 面板组件
 *
 * 显示建议列表 + 完整对话界面
 */

import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { useAppContext } from '@/lib/app-context'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { reconcileChatBlocks } from '@/chat/reconcile'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import type { DecryptedMessage, Session } from '@/types/api'
import type { ChatBlock, NormalizedMessage } from '@/chat/types'

// Icons
function ReviewIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M8 10h.01" />
            <path d="M12 10h.01" />
            <path d="M16 10h.01" />
        </svg>
    )
}

function MinimizeIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M8 3v3a2 2 0 0 1-2 2H3" />
            <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
            <path d="M3 16h3a2 2 0 0 1 2 2v3" />
            <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
        </svg>
    )
}

function GripIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <circle cx="9" cy="12" r="1" />
            <circle cx="9" cy="5" r="1" />
            <circle cx="9" cy="19" r="1" />
            <circle cx="15" cy="12" r="1" />
            <circle cx="15" cy="5" r="1" />
            <circle cx="15" cy="19" r="1" />
        </svg>
    )
}

function LoadingIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`animate-spin ${props.className ?? ''}`}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
    )
}

export function ReviewPanel(props: {
    mainSessionId: string
    reviewSessionId: string
}) {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const panelRef = useRef<HTMLDivElement>(null)
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const blocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())

    const [isExpanded, setIsExpanded] = useState(true)
    const [panelWidth, setPanelWidth] = useState(500)
    const [panelX, setPanelX] = useState<number | null>(null)

    // 拖拽状态
    const [dragMode, setDragMode] = useState<'none' | 'resize' | 'move'>('none')
    const dragStartRef = useRef({ x: 0, width: 0, panelX: 0 })

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragMode('resize')
        dragStartRef.current = {
            x: e.clientX,
            width: panelWidth,
            panelX: panelX ?? window.innerWidth - panelWidth
        }
    }, [panelWidth, panelX])

    const handleMoveStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setDragMode('move')
        dragStartRef.current = {
            x: e.clientX,
            width: panelWidth,
            panelX: panelX ?? window.innerWidth - panelWidth
        }
    }, [panelWidth, panelX])

    useEffect(() => {
        if (dragMode === 'none') return

        const handleMouseMove = (e: MouseEvent) => {
            if (dragMode === 'resize') {
                const delta = dragStartRef.current.x - e.clientX
                const newWidth = Math.max(400, Math.min(900, dragStartRef.current.width + delta))
                setPanelWidth(newWidth)
                const newX = dragStartRef.current.panelX - delta
                setPanelX(Math.max(0, newX))
            } else if (dragMode === 'move') {
                const delta = e.clientX - dragStartRef.current.x
                const newX = dragStartRef.current.panelX + delta
                setPanelX(Math.max(0, Math.min(window.innerWidth - panelWidth, newX)))
            }
        }

        const handleMouseUp = () => {
            setDragMode('none')
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [dragMode, panelWidth])

    // 获取 Review Session 详情
    const { data: reviewSessions } = useQuery({
        queryKey: ['review-sessions', props.mainSessionId],
        queryFn: async () => {
            const result = await api.getReviewSessions(props.mainSessionId)
            return result.reviewSessions
        },
        refetchInterval: 2000
    })

    // 获取当前 Review Session 的 ID（用于检查未汇总轮次）
    const currentReviewForPending = reviewSessions?.find(r => r.reviewSessionId === props.reviewSessionId)

    // 检查未汇总的轮次（pending 和 active 状态都需要查询）
    const { data: pendingRoundsData } = useQuery({
        queryKey: ['review-pending-rounds', currentReviewForPending?.id],
        queryFn: async () => {
            if (!currentReviewForPending?.id) throw new Error('No review ID')
            return await api.getReviewPendingRounds(currentReviewForPending.id)
        },
        enabled: Boolean(currentReviewForPending?.id) && (currentReviewForPending?.status === 'pending' || currentReviewForPending?.status === 'active'),
        refetchInterval: 5000  // 每 5 秒检查一次
    })

    // 获取 Review Session 信息（更快刷新）
    const { data: reviewSession } = useQuery({
        queryKey: ['session', props.reviewSessionId],
        queryFn: async () => {
            return await api.getSession(props.reviewSessionId)
        },
        enabled: Boolean(props.reviewSessionId),
        refetchInterval: 1000
    })

    // 获取 Review Session 的消息（更快刷新）
    const { data: reviewMessagesData, isLoading: isLoadingMessages } = useQuery({
        queryKey: ['messages', props.reviewSessionId],
        queryFn: async () => {
            return await api.getMessages(props.reviewSessionId, { limit: 100 })
        },
        enabled: Boolean(props.reviewSessionId),
        refetchInterval: 1000
    })

    const currentReview = reviewSessions?.find(r => r.reviewSessionId === props.reviewSessionId)
    const messages = (reviewMessagesData?.messages ?? []) as DecryptedMessage[]

    // 调试日志
    useEffect(() => {
        console.log('[ReviewPanel] Debug:', {
            reviewSessionId: props.reviewSessionId,
            messagesCount: messages.length,
            messages: messages.map(m => ({
                id: m.id,
                role: (m.content as Record<string, unknown>)?.role,
                contentKeys: Object.keys(m.content as Record<string, unknown> || {})
            }))
        })
    }, [messages, props.reviewSessionId])

    // 消息规范化管道
    const normalizedMessages: NormalizedMessage[] = useMemo(() => {
        const cache = normalizedCacheRef.current
        const normalized: NormalizedMessage[] = []
        const seen = new Set<string>()
        for (const message of messages) {
            seen.add(message.id)
            const cached = cache.get(message.id)
            if (cached && cached.source === message) {
                if (cached.normalized) normalized.push(cached.normalized)
                continue
            }
            const next = normalizeDecryptedMessage(message)
            console.log('[ReviewPanel] Normalize:', { messageId: message.id, result: next ? 'OK' : 'NULL', next })
            cache.set(message.id, { source: message, normalized: next })
            if (next) normalized.push(next)
        }
        for (const id of cache.keys()) {
            if (!seen.has(id)) {
                cache.delete(id)
            }
        }
        console.log('[ReviewPanel] Normalized messages:', normalized.length)
        return normalized
    }, [messages])

    const session = reviewSession?.session
    const reduced = useMemo(() => {
        const result = reduceChatBlocks(normalizedMessages, session?.agentState ?? null)
        console.log('[ReviewPanel] Reduced blocks:', result.blocks.length, result.blocks.map(b => ({ id: b.id, kind: b.kind })))
        return result
    }, [normalizedMessages, session?.agentState])

    const reconciled = useMemo(
        () => reconcileChatBlocks(reduced.blocks, blocksByIdRef.current),
        [reduced.blocks]
    )

    useEffect(() => {
        console.log('[ReviewPanel] Reconciled blocks:', reconciled.blocks.length)
        blocksByIdRef.current = reconciled.byId
    }, [reconciled.byId])

    // 发送消息到 Review Session
    const handleSendMessage = useCallback((text: string) => {
        api.sendMessage(props.reviewSessionId, text)
    }, [api, props.reviewSessionId])

    // 中止 Review Session
    const handleAbort = useCallback(async () => {
        await api.abortSession(props.reviewSessionId)
    }, [api, props.reviewSessionId])

    // 创建虚拟 Session 对象用于 Runtime
    const virtualSession: Session = useMemo(() => ({
        id: props.reviewSessionId,
        active: session?.active ?? true,  // 默认 true，确保组件可用
        thinking: session?.thinking ?? false,
        agentState: session?.agentState ?? null,
        permissionMode: session?.permissionMode ?? 'default',
        modelMode: session?.modelMode ?? 'default',
        modelReasoningEffort: session?.modelReasoningEffort ?? undefined,
        metadata: session?.metadata ?? null,
        createdAt: session?.createdAt ?? Date.now(),
        updatedAt: session?.updatedAt ?? Date.now()
    }), [props.reviewSessionId, session])

    // 创建 runtime
    const runtime = useHappyRuntime({
        session: virtualSession,
        blocks: reconciled.blocks,
        isSending: false,
        onSendMessage: handleSendMessage,
        onAbort: handleAbort
    })

    // 同步数据（汇总到数据库）
    const syncRoundsMutation = useMutation({
        mutationFn: async () => {
            if (!currentReview) {
                throw new Error('No current review found')
            }
            return await api.syncReviewRounds(currentReview.id)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-pending-rounds', currentReview?.id] })
        }
    })

    // 开始 Review（发送给 Review AI）
    const startReviewMutation = useMutation({
        mutationFn: async () => {
            if (!currentReview) {
                throw new Error('No current review found')
            }
            return await api.startReviewSession(currentReview.id)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-sessions', props.mainSessionId] })
            queryClient.invalidateQueries({ queryKey: ['review-pending-rounds', currentReview?.id] })
        }
    })

    // 刷新
    const handleRefresh = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['messages', props.reviewSessionId] })
    }, [queryClient, props.reviewSessionId])

    // 气泡模式
    if (!isExpanded) {
        return (
            <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-[var(--app-secondary-bg)] text-[var(--app-fg)] shadow-lg border border-[var(--app-divider)] hover:bg-[var(--app-subtle-bg)] hover:scale-105 transition-all flex items-center justify-center"
                title="打开 Review AI"
            >
                <ReviewIcon className="w-6 h-6" />
                {(currentReview?.status === 'active' || session?.thinking) && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full animate-pulse" />
                )}
            </button>
        )
    }

    const rightPos = panelX === null ? 0 : undefined
    const leftPos = panelX !== null ? panelX : undefined

    return (
        <div
            ref={panelRef}
            className="fixed top-0 bottom-0 z-50 shadow-2xl border-l border-[var(--app-divider)] bg-[var(--app-bg)] flex flex-col"
            style={{
                width: `${panelWidth}px`,
                right: rightPos,
                left: leftPos,
                cursor: dragMode === 'move' ? 'grabbing' : undefined
            }}
        >
            {/* 左边缘拖拽调整宽度 */}
            <div
                className="absolute top-0 bottom-0 left-0 w-1 cursor-ew-resize hover:bg-[var(--app-divider)] z-10"
                onMouseDown={handleResizeStart}
                style={{ backgroundColor: dragMode === 'resize' ? 'var(--app-divider)' : undefined }}
            />

            {/* Header */}
            <div
                className="flex items-center justify-between px-3 py-2 border-b border-[var(--app-divider)] bg-[var(--app-subtle-bg)] cursor-grab active:cursor-grabbing select-none"
                onMouseDown={handleMoveStart}
            >
                <div className="flex items-center gap-2">
                    <GripIcon className="w-4 h-4 text-[var(--app-hint)]" />
                    <ReviewIcon className="w-4 h-4 text-[var(--app-fg)]" />
                    <span className="text-sm font-medium">Review AI</span>
                    {session?.thinking && (
                        <LoadingIcon className="w-4 h-4 text-green-500" />
                    )}
                </div>
                <div className="flex items-center gap-1" onMouseDown={e => e.stopPropagation()}>
                    <button
                        type="button"
                        onClick={() => setIsExpanded(false)}
                        className="p-1.5 rounded hover:bg-[var(--app-bg)] text-[var(--app-hint)]"
                        title="收起"
                    >
                        <MinimizeIcon />
                    </button>
                </div>
            </div>

            {/* 对话界面 - 复用 HappyThread */}
            <AssistantRuntimeProvider runtime={runtime}>
                <div className="relative flex min-h-0 flex-1 flex-col">
                    <HappyThread
                        key={props.reviewSessionId}
                        api={api}
                        sessionId={props.reviewSessionId}
                        metadata={session?.metadata ?? null}
                        disabled={false}
                        onRefresh={handleRefresh}
                        onRetryMessage={undefined}
                        isLoadingMessages={isLoadingMessages}
                        messagesWarning={null}
                        hasMoreMessages={false}
                        isLoadingMoreMessages={false}
                        onLoadMore={async () => {}}
                        rawMessagesCount={messages.length}
                        normalizedMessagesCount={normalizedMessages.length}
                        renderedMessagesCount={reconciled.blocks.length}
                    />
                </div>
            </AssistantRuntimeProvider>

            {/* 底部操作栏 */}
            <div className="border-t border-[var(--app-divider)] p-4 bg-[var(--app-subtle-bg)]">
                {/* pending 状态 - 显示同步和开始 Review 两个按钮 */}
                {currentReview?.status === 'pending' && (
                    <div className="flex flex-col gap-3">
                        {/* 同步数据按钮 */}
                        <button
                            type="button"
                            onClick={() => syncRoundsMutation.mutate()}
                            disabled={syncRoundsMutation.isPending}
                            className="w-full px-5 py-3 text-sm font-semibold rounded-xl bg-gradient-to-r from-slate-500 to-slate-600 text-white shadow-lg hover:from-slate-600 hover:to-slate-700 hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
                        >
                            {syncRoundsMutation.isPending ? (
                                <span className="flex items-center justify-center gap-3">
                                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    正在同步数据...
                                </span>
                            ) : (
                                <span className="flex items-center justify-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                        <path d="M3 3v5h5" />
                                        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                                        <path d="M16 16h5v5" />
                                    </svg>
                                    同步数据
                                </span>
                            )}
                        </button>

                        {/* 开始 Review 按钮 */}
                        <button
                            type="button"
                            onClick={() => startReviewMutation.mutate()}
                            disabled={startReviewMutation.isPending}
                            className="w-full px-5 py-3 text-sm font-semibold rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg hover:from-blue-600 hover:to-indigo-600 hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
                        >
                            {startReviewMutation.isPending ? (
                                <span className="flex items-center justify-center gap-3">
                                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    正在启动 Review...
                                </span>
                            ) : (
                                <span className="flex items-center justify-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polygon points="5 3 19 12 5 21 5 3" />
                                    </svg>
                                    开始 Review
                                </span>
                            )}
                        </button>
                    </div>
                )}

                {/* active 状态且 AI 正在思考 - 显示进行中 */}
                {currentReview?.status === 'active' && session?.thinking && (
                    <div className="flex items-center justify-center gap-3 py-2">
                        <div className="flex gap-1">
                            <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        <span className="text-sm font-medium text-[var(--app-fg)]">AI 正在分析...</span>
                    </div>
                )}

                {/* active 状态但 AI 不在思考 */}
                {currentReview?.status === 'active' && !session?.thinking && (
                    <div className="flex flex-col gap-3">
                        {/* 有未汇总的轮次 - 显示同步新数据按钮 */}
                        {pendingRoundsData?.hasPendingRounds && (
                            <button
                                type="button"
                                onClick={() => syncRoundsMutation.mutate()}
                                disabled={syncRoundsMutation.isPending}
                                className="w-full px-5 py-3 text-sm font-semibold rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg hover:from-amber-600 hover:to-orange-600 hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
                            >
                                {syncRoundsMutation.isPending ? (
                                    <span className="flex items-center justify-center gap-3">
                                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        正在同步新数据...
                                    </span>
                                ) : (
                                    <span className="flex items-center justify-center gap-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                            <path d="M3 3v5h5" />
                                            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                                            <path d="M16 16h5v5" />
                                        </svg>
                                        同步新数据 ({pendingRoundsData.pendingRounds} 个新轮次)
                                    </span>
                                )}
                            </button>
                        )}

                        {/* 继续 Review 按钮（同步完成后可点击） */}
                        <button
                            type="button"
                            onClick={() => startReviewMutation.mutate()}
                            disabled={startReviewMutation.isPending}
                            className="w-full px-5 py-3 text-sm font-semibold rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg hover:from-blue-600 hover:to-indigo-600 hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
                        >
                            {startReviewMutation.isPending ? (
                                <span className="flex items-center justify-center gap-3">
                                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    正在执行 Review...
                                </span>
                            ) : (
                                <span className="flex items-center justify-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polygon points="5 3 19 12 5 21 5 3" />
                                    </svg>
                                    执行 Review
                                </span>
                            )}
                        </button>
                    </div>
                )}

                {/* completed 状态 */}
                {currentReview?.status === 'completed' && (
                    <div className="flex items-center justify-center gap-2 py-2 text-green-500">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                            <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <span className="font-medium">Review 已完成</span>
                    </div>
                )}

                {/* 加载中 */}
                {!currentReview && reviewSessions === undefined && (
                    <div className="flex items-center justify-center gap-2 py-2 text-[var(--app-hint)]">
                        <LoadingIcon />
                        <span className="text-sm">加载中...</span>
                    </div>
                )}
            </div>
        </div>
    )
}
