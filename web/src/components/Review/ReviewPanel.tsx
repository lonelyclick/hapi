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

    // 开始 Review
    const startReviewMutation = useMutation({
        mutationFn: async () => {
            if (!currentReview) {
                throw new Error('No current review found')
            }
            return await api.startReviewSession(currentReview.id)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-sessions', props.mainSessionId] })
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

            {/* 状态栏 */}
            <div className="border-b border-[var(--app-divider)] p-3 bg-[var(--app-subtle-bg)]">
                {/* pending 状态 - 显示开始按钮 */}
                {currentReview?.status === 'pending' && (
                    <button
                        type="button"
                        onClick={() => startReviewMutation.mutate()}
                        disabled={startReviewMutation.isPending}
                        className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-[var(--app-secondary-bg)] text-[var(--app-fg)] hover:bg-[var(--app-divider)] disabled:opacity-50 transition-colors"
                    >
                        {startReviewMutation.isPending ? (
                            <span className="flex items-center justify-center gap-2">
                                <LoadingIcon />
                                启动中...
                            </span>
                        ) : (
                            '开始 Review'
                        )}
                    </button>
                )}

                {/* active 状态 - 显示正在进行 */}
                {currentReview?.status === 'active' && (
                    <div className="flex items-center justify-center gap-2 text-sm text-[var(--app-hint)]">
                        <LoadingIcon className="text-green-500" />
                        <span>Review 进行中...</span>
                        <span className="text-xs">({messages.length} 条消息)</span>
                    </div>
                )}

                {/* completed 状态 */}
                {currentReview?.status === 'completed' && (
                    <div className="flex items-center justify-center gap-2 text-sm text-green-500">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>Review 完成</span>
                    </div>
                )}

                {/* 没有找到 currentReview */}
                {!currentReview && reviewSessions !== undefined && (
                    <div className="text-sm text-[var(--app-hint)] text-center">
                        等待 Review 数据加载...
                    </div>
                )}
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
        </div>
    )
}
