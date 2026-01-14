/**
 * Review 面板组件
 *
 * 这是一个试验性功能，用于显示 Review AI 的输出
 */

import { useRef } from 'react'
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

function formatTime(timestamp: number): string {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return '刚刚'
    if (diffMins < 60) return `${diffMins} 分钟前`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} 小时前`
    return date.toLocaleDateString()
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

    // 获取 Review Session 详情
    const { data: reviewSessions, isLoading, refetch } = useQuery({
        queryKey: ['review-sessions', props.mainSessionId],
        queryFn: async () => {
            const result = await api.getReviewSessions(props.mainSessionId)
            return result.reviewSessions
        },
        refetchInterval: 5000  // 每 5 秒刷新一次
    })

    // 开始 Review
    const startMutation = useMutation({
        mutationFn: async (reviewId: string) => {
            return await api.startReviewSession(reviewId)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-sessions', props.mainSessionId] })
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

    // 找到当前的 review session
    const currentReview = reviewSessions?.find(r => r.reviewSessionId === props.reviewSessionId)

    // 获取 Review Session 的消息
    const { data: messagesData } = useQuery({
        queryKey: ['messages', props.reviewSessionId],
        queryFn: async () => {
            return await api.getMessages(props.reviewSessionId, { limit: 50 })
        },
        enabled: Boolean(props.reviewSessionId),
        refetchInterval: 3000  // 每 3 秒刷新
    })

    // 提取 AI 的回复内容
    const reviewOutput = messagesData?.messages
        ?.filter((m: { content: unknown }) => {
            const content = m.content as Record<string, unknown>
            return content?.role === 'agent'
        })
        .map((m: { content: unknown }) => {
            const content = m.content as Record<string, unknown>
            const payload = content?.content as Record<string, unknown>
            const data = payload?.data
            if (typeof data === 'string') return data
            if (typeof data === 'object' && data) {
                const d = data as Record<string, unknown>
                if (typeof d.message === 'string') return d.message
            }
            return ''
        })
        .filter(Boolean)
        .join('\n\n') || ''

    return (
        <div
            ref={panelRef}
            className="flex flex-col h-full border-l border-[var(--app-divider)] bg-[var(--app-bg)] w-full sm:w-[360px] sm:min-w-[300px] sm:max-w-[50vw]"
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--app-divider)]">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Review AI</span>
                    {currentReview && getStatusBadge(currentReview.status)}
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

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3">
                {isLoading && (
                    <div className="text-center text-sm text-[var(--app-hint)] py-8">
                        加载中...
                    </div>
                )}

                {currentReview && (
                    <div className="space-y-4">
                        {/* Meta info */}
                        <div className="text-xs text-[var(--app-hint)] space-y-1">
                            <div>模型: {currentReview.reviewModel}{currentReview.reviewModelVariant ? ` (${currentReview.reviewModelVariant})` : ''}</div>
                            <div>创建于: {formatTime(currentReview.createdAt)}</div>
                        </div>

                        {/* Context summary */}
                        <div className="space-y-1">
                            <div className="text-xs font-medium text-[var(--app-hint)]">任务上下文</div>
                            <div className="text-xs bg-[var(--app-subtle-bg)] rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
                                {currentReview.contextSummary}
                            </div>
                        </div>

                        {/* Review output */}
                        <div className="space-y-1">
                            <div className="text-xs font-medium text-[var(--app-hint)]">Review 输出</div>
                            {reviewOutput ? (
                                <div className="text-sm bg-[var(--app-subtle-bg)] rounded p-3 whitespace-pre-wrap">
                                    {reviewOutput}
                                </div>
                            ) : (
                                <div className="text-xs text-[var(--app-hint)] bg-[var(--app-subtle-bg)] rounded p-3">
                                    {currentReview.status === 'pending' || currentReview.status === 'active'
                                        ? 'Review AI 正在分析代码...'
                                        : '暂无输出'}
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        {currentReview.status === 'pending' && (
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => startMutation.mutate(currentReview.id)}
                                    disabled={startMutation.isPending}
                                    className="flex-1 px-3 py-1.5 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                                >
                                    {startMutation.isPending ? '启动中...' : '开始 Review'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => cancelMutation.mutate(currentReview.id)}
                                    disabled={cancelMutation.isPending}
                                    className="px-3 py-1.5 text-xs rounded bg-red-500/10 text-red-600 hover:bg-red-500/20 disabled:opacity-50"
                                >
                                    取消
                                </button>
                            </div>
                        )}
                        {currentReview.status === 'active' && (
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => cancelMutation.mutate(currentReview.id)}
                                    disabled={cancelMutation.isPending}
                                    className="flex-1 px-3 py-1.5 text-xs rounded bg-red-500/10 text-red-600 hover:bg-red-500/20 disabled:opacity-50"
                                >
                                    取消 Review
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {!isLoading && !currentReview && (
                    <div className="text-center text-sm text-[var(--app-hint)] py-8">
                        Review Session 未找到
                    </div>
                )}
            </div>

            {/* History */}
            {reviewSessions && reviewSessions.length > 1 && (
                <div className="border-t border-[var(--app-divider)] p-3">
                    <div className="text-xs font-medium text-[var(--app-hint)] mb-2">历史 Reviews</div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                        {reviewSessions
                            .filter(r => r.reviewSessionId !== props.reviewSessionId)
                            .slice(0, 5)
                            .map((review) => (
                                <button
                                    key={review.id}
                                    type="button"
                                    onClick={() => props.onOpenReviewSession?.(review.reviewSessionId)}
                                    className="flex w-full items-center justify-between px-2 py-1 rounded text-xs hover:bg-[var(--app-subtle-bg)]"
                                >
                                    <span className="truncate">{review.reviewModel}</span>
                                    <span className="text-[var(--app-hint)]">{formatTime(review.createdAt)}</span>
                                </button>
                            ))
                        }
                    </div>
                </div>
            )}
        </div>
    )
}
