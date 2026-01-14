/**
 * Review 面板组件
 *
 * 这是一个试验性功能，用于显示 Review AI 的对话
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import type { ReviewSession } from '@/api/client'

function XIcon(props: { className?: string }) {
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

function ExternalLinkIcon(props: { className?: string }) {
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
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
    )
}

function RefreshIcon(props: { className?: string }) {
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
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
        </svg>
    )
}

function SendIcon(props: { className?: string }) {
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
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
    )
}

function getStatusBadge(status: ReviewSession['status']) {
    switch (status) {
        case 'pending':
            return <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/10 text-yellow-600">等待中</span>
        case 'active':
            return <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-600">进行中</span>
        case 'completed':
            return <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/10 text-green-600">已完成</span>
        case 'cancelled':
            return <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-500/10 text-gray-600">已取消</span>
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
            const payload = content?.content as Record<string, unknown>
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
            const payload = content?.content as Record<string, unknown>
            const data = payload?.data
            let text = ''
            if (typeof data === 'string') {
                text = data
            } else if (typeof data === 'object' && data) {
                const d = data as Record<string, unknown>
                if (typeof d.message === 'string') text = d.message
            }
            if (text) {
                result.push({
                    id: m.id,
                    role: 'assistant',
                    content: text,
                    timestamp: m.createdAt || Date.now()
                })
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
    const panelRef = useRef<HTMLDivElement>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const [panelWidth, setPanelWidth] = useState(400)
    const [isDragging, setIsDragging] = useState(false)

    // 拖拽调整宽度
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }, [])

    useEffect(() => {
        if (!isDragging) return

        const handleMouseMove = (e: MouseEvent) => {
            const newWidth = window.innerWidth - e.clientX
            setPanelWidth(Math.max(300, Math.min(800, newWidth)))
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

    // 获取主 Session 的消息（用于检测新消息）
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

    // 找到当前的 review session
    const currentReview = reviewSessions?.find(r => r.reviewSessionId === props.reviewSessionId)

    // 解析消息
    const chatMessages = parseMessages(reviewMessagesData)

    // 滚动到底部
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [chatMessages.length])

    // 总结对话 mutation
    const summarizeMutation = useMutation({
        mutationFn: async () => {
            return await api.sendReviewSummary(currentReview!.id)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['messages', props.reviewSessionId] })
        }
    })

    // 执行 Review mutation
    const executeReviewMutation = useMutation({
        mutationFn: async () => {
            return await api.executeReview(currentReview!.id)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['messages', props.mainSessionId] })
        }
    })

    // 取消 Review
    const cancelMutation = useMutation({
        mutationFn: async (reviewId: string) => {
            return await api.cancelReviewSession(reviewId)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-sessions', props.mainSessionId] })
        }
    })

    // 计算主 Session 是否有新消息（简单判断消息数量）
    const mainMessageCount = mainMessagesData?.messages?.length || 0
    const hasNewMessages = mainMessageCount > 0

    return (
        <div
            ref={panelRef}
            className="flex flex-col h-full border-l border-[var(--app-divider)] bg-[var(--app-bg)] relative"
            style={{ width: window.innerWidth < 640 ? '100%' : `${panelWidth}px` }}
        >
            {/* 拖拽手柄 */}
            <div
                className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500/30 hidden sm:block"
                onMouseDown={handleMouseDown}
                style={{ backgroundColor: isDragging ? 'rgba(59, 130, 246, 0.3)' : undefined }}
            />

            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--app-divider)]">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Review AI</span>
                    {currentReview && getStatusBadge(currentReview.status)}
                    {currentReview && (
                        <span className="text-[10px] text-[var(--app-hint)]">
                            {currentReview.reviewModel}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => refetch()}
                        className="p-1 rounded hover:bg-[var(--app-subtle-bg)] text-[var(--app-hint)]"
                        title="刷新"
                    >
                        <RefreshIcon />
                    </button>
                    {props.onOpenReviewSession && (
                        <button
                            type="button"
                            onClick={() => props.onOpenReviewSession?.(props.reviewSessionId)}
                            className="p-1 rounded hover:bg-[var(--app-subtle-bg)] text-[var(--app-hint)]"
                            title="在新窗口打开"
                        >
                            <ExternalLinkIcon />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="p-1 rounded hover:bg-[var(--app-subtle-bg)] text-[var(--app-hint)]"
                        title="关闭"
                    >
                        <XIcon />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {isLoading && (
                    <div className="text-center text-sm text-[var(--app-hint)] py-8">
                        加载中...
                    </div>
                )}

                {!isLoading && chatMessages.length === 0 && currentReview && (
                    <div className="text-center text-sm text-[var(--app-hint)] py-8">
                        {currentReview.status === 'pending'
                            ? '点击下方按钮开始 Review'
                            : '暂无消息'}
                    </div>
                )}

                {chatMessages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div
                            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                                msg.role === 'user'
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]'
                            }`}
                        >
                            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                        </div>
                    </div>
                ))}

                <div ref={messagesEndRef} />
            </div>

            {/* Actions */}
            {currentReview && (
                <div className="border-t border-[var(--app-divider)] p-3 space-y-2">
                    {currentReview.status === 'pending' && (
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => summarizeMutation.mutate()}
                                disabled={summarizeMutation.isPending || !hasNewMessages}
                                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                                title={hasNewMessages ? '总结主 Session 对话并发送给 Review AI' : '主 Session 暂无新消息'}
                            >
                                <SendIcon />
                                {summarizeMutation.isPending ? '发送中...' : '总结对话'}
                            </button>
                            <button
                                type="button"
                                onClick={() => cancelMutation.mutate(currentReview.id)}
                                disabled={cancelMutation.isPending}
                                className="px-3 py-2 text-xs rounded bg-red-500/10 text-red-600 hover:bg-red-500/20 disabled:opacity-50"
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
                                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs rounded bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 disabled:opacity-50"
                                title={hasNewMessages ? '发送新的对话摘要' : '主 Session 暂无新消息'}
                            >
                                <SendIcon />
                                {summarizeMutation.isPending ? '发送中...' : '更新对话'}
                            </button>
                            <button
                                type="button"
                                onClick={() => executeReviewMutation.mutate()}
                                disabled={executeReviewMutation.isPending || chatMessages.length === 0}
                                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs rounded bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
                                title="将 Review 结果发送到主 Session"
                            >
                                <SendIcon />
                                {executeReviewMutation.isPending ? '发送中...' : '发送 Review'}
                            </button>
                        </div>
                    )}

                    {currentReview.status === 'active' && (
                        <button
                            type="button"
                            onClick={() => cancelMutation.mutate(currentReview.id)}
                            disabled={cancelMutation.isPending}
                            className="w-full px-3 py-1.5 text-xs rounded bg-red-500/10 text-red-600 hover:bg-red-500/20 disabled:opacity-50"
                        >
                            取消 Review
                        </button>
                    )}

                    {(currentReview.status === 'completed' || currentReview.status === 'cancelled') && (
                        <div className="text-center text-xs text-[var(--app-hint)]">
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
