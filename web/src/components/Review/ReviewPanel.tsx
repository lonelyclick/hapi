/**
 * Review 面板组件
 *
 * 简化流程：
 * 1. 点击"开始 Review" → 发送对话+diff 给 AI
 * 2. AI 返回 JSON 建议列表
 * 3. 用户选择建议 → 发送到主 Session
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'

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

function CheckIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <polyline points="20 6 9 17 4 12" />
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

// 建议类型
interface ReviewSuggestion {
    id: string
    type: 'bug' | 'security' | 'performance' | 'improvement' | 'question'
    severity: 'high' | 'medium' | 'low'
    title: string
    description: string
    action: string
}

interface ReviewResult {
    suggestions: ReviewSuggestion[]
    summary: string
}

// 从 AI 回复中解析 JSON 建议
function parseReviewResult(text: string): ReviewResult | null {
    try {
        // 尝试找到 JSON 块
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
        const jsonStr = jsonMatch ? jsonMatch[1] : text

        const parsed = JSON.parse(jsonStr)
        if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
            return parsed as ReviewResult
        }
    } catch {
        // 解析失败
    }
    return null
}

// 从消息中提取 AI 回复文本
function extractAIResponse(messagesData: { messages: Array<{ id: string; content: unknown }> } | undefined): string | null {
    if (!messagesData?.messages) return null

    for (let i = messagesData.messages.length - 1; i >= 0; i--) {
        const m = messagesData.messages[i]
        const content = m.content as Record<string, unknown>
        const role = content?.role

        if (role === 'agent') {
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
                        return item.text
                    }
                }
            }
        }
    }

    return null
}

function getSeverityColor(severity: string) {
    switch (severity) {
        case 'high':
            return 'text-red-500 bg-red-500/10'
        case 'medium':
            return 'text-yellow-500 bg-yellow-500/10'
        case 'low':
            return 'text-green-500 bg-green-500/10'
        default:
            return 'text-gray-500 bg-gray-500/10'
    }
}

function getTypeLabel(type: string) {
    switch (type) {
        case 'bug':
            return 'Bug'
        case 'security':
            return '安全'
        case 'performance':
            return '性能'
        case 'improvement':
            return '改进'
        case 'question':
            return '问题'
        default:
            return type
    }
}

export function ReviewPanel(props: {
    mainSessionId: string
    reviewSessionId: string
}) {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const panelRef = useRef<HTMLDivElement>(null)

    const [isExpanded, setIsExpanded] = useState(true)
    const [panelWidth, setPanelWidth] = useState(400)
    const [panelX, setPanelX] = useState<number | null>(null)
    const [appliedSuggestions, setAppliedSuggestions] = useState<Set<string>>(new Set())

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
                const newWidth = Math.max(320, Math.min(800, dragStartRef.current.width + delta))
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
        refetchInterval: 5000
    })

    // 获取 Review Session 的消息
    const { data: reviewMessagesData } = useQuery({
        queryKey: ['messages', props.reviewSessionId],
        queryFn: async () => {
            return await api.getMessages(props.reviewSessionId, { limit: 50 })
        },
        enabled: Boolean(props.reviewSessionId),
        refetchInterval: 3000
    })

    const currentReview = reviewSessions?.find(r => r.reviewSessionId === props.reviewSessionId)

    // Debug log
    console.log('[ReviewPanel] reviewSessions:', reviewSessions?.length, 'currentReview:', currentReview?.status, 'reviewSessionId:', props.reviewSessionId)

    // 解析 AI 回复中的建议
    const aiResponse = extractAIResponse(reviewMessagesData)
    const reviewResult = aiResponse ? parseReviewResult(aiResponse) : null

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

    // 应用建议
    const applySuggestionMutation = useMutation({
        mutationFn: async (suggestion: ReviewSuggestion) => {
            return await api.applyReviewSuggestion(currentReview!.id, suggestion.action)
        },
        onSuccess: (_, suggestion) => {
            setAppliedSuggestions(prev => new Set(prev).add(suggestion.id))
        }
    })

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
                {currentReview?.status === 'active' && (
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

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* 状态栏 */}
                <div className="text-xs text-[var(--app-hint)] px-2">
                    状态: {currentReview?.status ?? '加载中...'}
                </div>

                {/* 开始 Review 按钮 - pending 状态时显示 */}
                {currentReview?.status === 'pending' && (
                    <div className="text-center py-6">
                        <button
                            type="button"
                            onClick={() => startReviewMutation.mutate()}
                            disabled={startReviewMutation.isPending}
                            className="px-6 py-2.5 text-sm font-medium rounded-lg bg-[var(--app-secondary-bg)] text-[var(--app-fg)] hover:bg-[var(--app-divider)] disabled:opacity-50 transition-colors"
                        >
                            {startReviewMutation.isPending ? (
                                <span className="flex items-center gap-2">
                                    <LoadingIcon />
                                    启动中...
                                </span>
                            ) : (
                                '开始 Review'
                            )}
                        </button>
                    </div>
                )}

                {/* 加载中 */}
                {!currentReview && (
                    <div className="text-center py-8">
                        <LoadingIcon className="w-6 h-6 mx-auto mb-2 text-[var(--app-hint)]" />
                        <p className="text-sm text-[var(--app-hint)]">
                            正在加载 Review Session...
                        </p>
                    </div>
                )}

                {/* 正在分析 - active 状态且没有 AI 回复 */}
                {currentReview?.status === 'active' && !aiResponse && (
                    <div className="text-center py-8">
                        <LoadingIcon className="w-8 h-8 mx-auto mb-4 text-[var(--app-hint)]" />
                        <p className="text-sm text-[var(--app-hint)]">
                            Review AI 正在分析代码...
                        </p>
                    </div>
                )}

                {/* 建议列表 - 如果解析成功 */}
                {reviewResult && (
                    <div className="space-y-4">
                        {/* 总结 */}
                        {reviewResult.summary && (
                            <div className="p-3 rounded-lg bg-[var(--app-subtle-bg)] text-sm">
                                <p className="text-[var(--app-fg)]">{reviewResult.summary}</p>
                            </div>
                        )}

                        {/* 建议卡片 */}
                        {reviewResult.suggestions.length === 0 ? (
                            <div className="text-center py-4 text-sm text-[var(--app-hint)]">
                                没有发现问题，代码看起来不错！
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {reviewResult.suggestions.map((suggestion) => {
                                    const isApplied = appliedSuggestions.has(suggestion.id)
                                    return (
                                        <div
                                            key={suggestion.id}
                                            className={`p-3 rounded-lg border ${isApplied ? 'border-green-500/30 bg-green-500/5' : 'border-[var(--app-divider)] bg-[var(--app-bg)]'}`}
                                        >
                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getSeverityColor(suggestion.severity)}`}>
                                                        {suggestion.severity.toUpperCase()}
                                                    </span>
                                                    <span className="text-xs text-[var(--app-hint)]">
                                                        {getTypeLabel(suggestion.type)}
                                                    </span>
                                                </div>
                                                {isApplied ? (
                                                    <span className="flex items-center gap-1 text-xs text-green-500">
                                                        <CheckIcon className="w-3 h-3" />
                                                        已发送
                                                    </span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => applySuggestionMutation.mutate(suggestion)}
                                                        disabled={applySuggestionMutation.isPending}
                                                        className="px-2 py-1 text-xs rounded bg-[var(--app-secondary-bg)] text-[var(--app-fg)] hover:bg-[var(--app-divider)] disabled:opacity-50"
                                                    >
                                                        应用
                                                    </button>
                                                )}
                                            </div>
                                            <h4 className="text-sm font-medium text-[var(--app-fg)] mb-1">
                                                {suggestion.title}
                                            </h4>
                                            <p className="text-xs text-[var(--app-hint)] leading-relaxed">
                                                {suggestion.description}
                                            </p>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* AI 原始回复 - 总是显示（如果有的话）*/}
                {aiResponse && (
                    <div className="space-y-2">
                        <p className="text-xs text-[var(--app-hint)]">Review AI 回复：</p>
                        <div className="p-3 rounded-lg bg-[var(--app-subtle-bg)] text-sm whitespace-pre-wrap text-[var(--app-fg)] leading-relaxed">
                            {aiResponse}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
