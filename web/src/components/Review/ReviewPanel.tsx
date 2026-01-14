/**
 * Review 面板组件
 *
 * 悬浮在右下角的 Review AI 面板
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import type { ReviewSession } from '@/api/client'

// Icons
function XIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

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

function ExternalLinkIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
    )
}

function RefreshIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
        </svg>
    )
}

function SendIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
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

function getStatusBadge(status: ReviewSession['status']) {
    switch (status) {
        case 'pending':
            return <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/20 text-yellow-600">等待</span>
        case 'active':
            return <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-600 animate-pulse">进行中</span>
        case 'completed':
            return <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/20 text-green-600">完成</span>
        case 'cancelled':
            return <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-500/20 text-gray-500">取消</span>
    }
}

interface ChatMessage {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
}

function parseMessages(messagesData: { messages: Array<{ id: string; content: unknown; createdAt?: number }> } | undefined): ChatMessage[] {
    if (!messagesData?.messages) return []

    const result: ChatMessage[] = []

    for (const m of messagesData.messages) {
        const content = m.content as Record<string, unknown>
        const role = content?.role

        if (role === 'user') {
            // user 消息的 content 可能是 JSON 字符串
            let payload: Record<string, unknown> | null = null
            const rawContent = content?.content
            if (typeof rawContent === 'string') {
                try {
                    payload = JSON.parse(rawContent)
                } catch {
                    payload = rawContent as unknown as Record<string, unknown>
                }
            } else if (typeof rawContent === 'object' && rawContent) {
                payload = rawContent as Record<string, unknown>
            }

            const text = typeof payload?.text === 'string' ? payload.text : ''
            if (text) {
                result.push({
                    id: m.id,
                    role: 'user',
                    content: text,
                    timestamp: m.createdAt || Date.now()
                })
            }
        } else if (role === 'agent') {
            // agent 消息需要解析 Claude API 格式
            let payload: Record<string, unknown> | null = null
            const rawContent = content?.content
            if (typeof rawContent === 'string') {
                try {
                    payload = JSON.parse(rawContent)
                } catch {
                    payload = null
                }
            } else if (typeof rawContent === 'object' && rawContent) {
                payload = rawContent as Record<string, unknown>
            }

            if (!payload) continue

            const data = payload.data as Record<string, unknown>
            if (!data || data.type !== 'assistant') continue

            const message = data.message as Record<string, unknown>
            if (message?.content) {
                const contentArr = message.content as Array<{ type?: string; text?: string }>
                for (const item of contentArr) {
                    if (item.type === 'text' && item.text) {
                        result.push({
                            id: m.id,
                            role: 'assistant',
                            content: item.text,
                            timestamp: m.createdAt || Date.now()
                        })
                    }
                }
            }
        }
    }

    return result
}

export function ReviewPanel(props: {
    mainSessionId: string
    reviewSessionId: string
    onClose: () => void
    onOpenReviewSession?: (sessionId: string) => void
}) {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const [isExpanded, setIsExpanded] = useState(true)
    const [panelHeight, setPanelHeight] = useState(400)
    const [isDragging, setIsDragging] = useState(false)

    // 拖拽调整高度
    const handleDragStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }, [])

    useEffect(() => {
        if (!isDragging) return

        const handleMouseMove = (e: MouseEvent) => {
            const newHeight = window.innerHeight - e.clientY - 20
            setPanelHeight(Math.max(200, Math.min(600, newHeight)))
        }

        const handleMouseUp = () => {
            setIsDragging(false)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isDragging])

    // 获取 Review Session 详情
    const { data: reviewSessions, isLoading, refetch } = useQuery({
        queryKey: ['review-sessions', props.mainSessionId],
        queryFn: async () => {
            const result = await api.getReviewSessions(props.mainSessionId)
            return result.reviewSessions
        },
        refetchInterval: 5000
    })

    // 获取主 Session 的消息
    const { data: mainMessagesData } = useQuery({
        queryKey: ['messages', props.mainSessionId, 'for-review'],
        queryFn: async () => {
            return await api.getMessages(props.mainSessionId, { limit: 30 })
        },
        refetchInterval: 5000
    })

    // 获取 Review Session 的消息
    const { data: reviewMessagesData } = useQuery({
        queryKey: ['messages', props.reviewSessionId],
        queryFn: async () => {
            return await api.getMessages(props.reviewSessionId, { limit: 100 })
        },
        enabled: Boolean(props.reviewSessionId),
        refetchInterval: 3000
    })

    const currentReview = reviewSessions?.find(r => r.reviewSessionId === props.reviewSessionId)
    const chatMessages = parseMessages(reviewMessagesData)

    // 滚动到底部
    useEffect(() => {
        if (isExpanded) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
    }, [chatMessages.length, isExpanded])

    // Mutations
    const summarizeMutation = useMutation({
        mutationFn: async () => {
            return await api.sendReviewSummary(currentReview!.id)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['messages', props.reviewSessionId] })
        }
    })

    const executeReviewMutation = useMutation({
        mutationFn: async () => {
            return await api.executeReview(currentReview!.id)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['messages', props.mainSessionId] })
        }
    })

    const cancelMutation = useMutation({
        mutationFn: async (reviewId: string) => {
            return await api.cancelReviewSession(reviewId)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-sessions', props.mainSessionId] })
        }
    })

    const mainMessageCount = mainMessagesData?.messages?.length || 0
    const hasNewMessages = mainMessageCount > 0

    // 未展开时显示悬浮图标
    if (!isExpanded) {
        return (
            <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-[var(--app-secondary-bg)] text-[var(--app-fg)] shadow-lg border border-[var(--app-divider)] hover:bg-[var(--app-subtle-bg)] hover:scale-105 transition-all flex items-center justify-center"
                title="打开 Review AI"
            >
                <ReviewIcon className="w-6 h-6" />
                {currentReview?.status === 'active' && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full animate-pulse" />
                )}
            </button>
        )
    }

    // 展开时显示完整面板
    return (
        <div
            className="fixed bottom-5 right-5 z-50 w-[360px] max-w-[calc(100vw-40px)] rounded-xl shadow-2xl border border-[var(--app-divider)] bg-[var(--app-bg)] flex flex-col overflow-hidden"
            style={{ height: `${panelHeight}px` }}
        >
            {/* 拖拽调整高度的手柄 */}
            <div
                className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-500/20"
                onMouseDown={handleDragStart}
                style={{ backgroundColor: isDragging ? 'rgba(59, 130, 246, 0.2)' : undefined }}
            />

            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--app-divider)] bg-[var(--app-subtle-bg)]">
                <div className="flex items-center gap-2">
                    <ReviewIcon className="w-4 h-4 text-[var(--app-fg)]" />
                    <span className="text-sm font-medium">Review AI</span>
                    {currentReview && getStatusBadge(currentReview.status)}
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => refetch()}
                        className="p-1.5 rounded hover:bg-[var(--app-bg)] text-[var(--app-hint)]"
                        title="刷新"
                    >
                        <RefreshIcon />
                    </button>
                    {props.onOpenReviewSession && (
                        <button
                            type="button"
                            onClick={() => props.onOpenReviewSession?.(props.reviewSessionId)}
                            className="p-1.5 rounded hover:bg-[var(--app-bg)] text-[var(--app-hint)]"
                            title="在新窗口打开"
                        >
                            <ExternalLinkIcon />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setIsExpanded(false)}
                        className="p-1.5 rounded hover:bg-[var(--app-bg)] text-[var(--app-hint)]"
                        title="最小化"
                    >
                        <MinimizeIcon />
                    </button>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="p-1.5 rounded hover:bg-[var(--app-bg)] text-[var(--app-hint)]"
                        title="关闭"
                    >
                        <XIcon />
                    </button>
                </div>
            </div>

            {/* Messages - 与主 Session 样式一致 */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
                {isLoading && (
                    <div className="text-center text-sm text-[var(--app-hint)] py-8">
                        加载中...
                    </div>
                )}

                {!isLoading && chatMessages.length === 0 && currentReview && (
                    <div className="text-center text-sm text-[var(--app-hint)] py-8">
                        {currentReview.status === 'pending' ? '点击下方按钮开始 Review' : '暂无消息'}
                    </div>
                )}

                {chatMessages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div
                            className={`max-w-[90%] rounded-xl px-3 py-2 text-sm shadow-sm ${
                                msg.role === 'user'
                                    ? 'bg-[var(--app-secondary-bg)] text-[var(--app-fg)]'
                                    : 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]'
                            }`}
                        >
                            <div className="whitespace-pre-wrap break-words leading-relaxed">
                                {msg.content}
                            </div>
                        </div>
                    </div>
                ))}

                <div ref={messagesEndRef} />
            </div>

            {/* Actions */}
            {currentReview && (
                <div className="border-t border-[var(--app-divider)] p-2 space-y-2 bg-[var(--app-subtle-bg)]">
                    {currentReview.status === 'pending' && (
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => summarizeMutation.mutate()}
                                disabled={summarizeMutation.isPending || !hasNewMessages}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-[var(--app-secondary-bg)] text-[var(--app-fg)] hover:bg-[var(--app-divider)] disabled:opacity-50 transition-colors"
                            >
                                <SendIcon />
                                {summarizeMutation.isPending ? '发送中...' : '开始 Review'}
                            </button>
                            <button
                                type="button"
                                onClick={() => cancelMutation.mutate(currentReview.id)}
                                disabled={cancelMutation.isPending}
                                className="px-3 py-2 text-xs rounded-lg text-[var(--app-hint)] hover:bg-[var(--app-divider)] disabled:opacity-50 transition-colors"
                            >
                                取消
                            </button>
                        </div>
                    )}

                    {currentReview.status === 'active' && (
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => summarizeMutation.mutate()}
                                disabled={summarizeMutation.isPending || !hasNewMessages}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-[var(--app-bg)] text-[var(--app-fg)] hover:bg-[var(--app-divider)] disabled:opacity-50 transition-colors"
                            >
                                <RefreshIcon />
                                {summarizeMutation.isPending ? '更新中...' : '更新对话'}
                            </button>
                            <button
                                type="button"
                                onClick={() => executeReviewMutation.mutate()}
                                disabled={executeReviewMutation.isPending || chatMessages.length === 0}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-[var(--app-secondary-bg)] text-[var(--app-fg)] hover:bg-[var(--app-divider)] disabled:opacity-50 transition-colors"
                            >
                                <SendIcon />
                                {executeReviewMutation.isPending ? '发送中...' : '发送反馈'}
                            </button>
                        </div>
                    )}

                    {currentReview.status === 'active' && (
                        <button
                            type="button"
                            onClick={() => cancelMutation.mutate(currentReview.id)}
                            disabled={cancelMutation.isPending}
                            className="w-full px-3 py-1.5 text-xs rounded-lg text-[var(--app-hint)] hover:bg-[var(--app-divider)] disabled:opacity-50 transition-colors"
                        >
                            取消 Review
                        </button>
                    )}

                    {(currentReview.status === 'completed' || currentReview.status === 'cancelled') && (
                        <div className="text-center text-xs text-[var(--app-hint)] py-1">
                            Review 已{currentReview.status === 'completed' ? '完成' : '取消'}
                        </div>
                    )}
                </div>
            )}

            {!isLoading && !currentReview && (
                <div className="p-3 text-center text-sm text-[var(--app-hint)]">
                    Review Session 未找到
                </div>
            )}
        </div>
    )
}
