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
import { ReviewSuggestions, parseReviewResult, getMergedSuggestions, type SuggestionWithStatus } from './ReviewSuggestions'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

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

function CloseIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    )
}

function TrashIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
    )
}

function ChevronIcon(props: { className?: string; expanded?: boolean }) {
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
            className={`transition-transform ${props.expanded ? 'rotate-180' : ''} ${props.className ?? ''}`}
        >
            <path d="m6 9 6 6 6-6" />
        </svg>
    )
}

/**
 * 汇总卡片组件 - 默认折叠成一行，展开后显示轮次列表
 */
function SummaryCards(props: { summaries: Array<{ round: number; summary: string }> }) {
    // 整体是否展开（默认折叠）
    const [isListExpanded, setIsListExpanded] = useState(false)
    // 单个轮次是否展开
    const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set())

    const toggleRound = (round: number) => {
        setExpandedRounds(prev => {
            const next = new Set(prev)
            if (next.has(round)) {
                next.delete(round)
            } else {
                next.add(round)
            }
            return next
        })
    }

    const expandAll = () => {
        setExpandedRounds(new Set(props.summaries.map(s => s.round)))
    }

    const collapseAll = () => {
        setExpandedRounds(new Set())
    }

    const allExpanded = expandedRounds.size === props.summaries.length
    const noneExpanded = expandedRounds.size === 0

    return (
        <div className="px-3 py-2">
            <div className="rounded-lg bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border border-green-200 dark:border-green-700 shadow-sm overflow-hidden">
                {/* 头部 - 点击展开/折叠整个列表 */}
                <div
                    className={`flex items-center justify-between px-2 py-1.5 bg-green-100/50 dark:bg-green-800/30 cursor-pointer hover:bg-green-100 dark:hover:bg-green-800/50 transition-colors ${isListExpanded ? 'border-b border-green-200 dark:border-green-700' : ''}`}
                    onClick={() => setIsListExpanded(!isListExpanded)}
                >
                    <div className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-xs font-medium text-green-700 dark:text-green-300">
                            已汇总 {props.summaries.length} 轮
                        </span>
                    </div>
                    <ChevronIcon expanded={isListExpanded} className="text-green-500" />
                </div>
                {/* 汇总列表 - 仅在展开时显示 */}
                {isListExpanded && (
                    <>
                        {/* 展开/收起全部按钮 */}
                        <div className="flex items-center justify-end gap-2 px-2 py-1 bg-green-50/50 dark:bg-green-800/20 border-b border-green-100 dark:border-green-700/50">
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); expandAll() }}
                                disabled={allExpanded}
                                className="text-[10px] text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                全部展开
                            </button>
                            <span className="text-green-300 dark:text-green-600">|</span>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); collapseAll() }}
                                disabled={noneExpanded}
                                className="text-[10px] text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                全部收起
                            </button>
                        </div>
                        <div className="p-1.5 space-y-1">
                            {props.summaries.map(summary => {
                                const expanded = expandedRounds.has(summary.round)
                                return (
                                    <div key={summary.round} className="rounded bg-white dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 overflow-hidden">
                                        <div
                                            className="flex items-center gap-1.5 px-2 py-1 bg-green-50 dark:bg-green-800/30 cursor-pointer hover:bg-green-100 dark:hover:bg-green-800/50 transition-colors"
                                            onClick={() => toggleRound(summary.round)}
                                        >
                                            <div className="flex items-center justify-center w-4 h-4 rounded-full bg-green-500 text-white text-[9px] font-bold shrink-0">
                                                {summary.round}
                                            </div>
                                            <span className="flex-1 text-[11px] text-slate-600 dark:text-slate-300 truncate">
                                                {summary.summary.slice(0, 60)}{summary.summary.length > 60 ? '...' : ''}
                                            </span>
                                            <ChevronIcon expanded={expanded} className="text-green-500 shrink-0" />
                                        </div>
                                        {expanded && (
                                            <div className="px-2 py-1.5 border-t border-green-100 dark:border-green-700/50">
                                                <div className="text-[11px] text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                                                    {summary.summary}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

export function ReviewPanel(props: {
    mainSessionId: string
    reviewSessionId: string
    onClose?: () => void
}) {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const panelRef = useRef<HTMLDivElement>(null)
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const blocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())
    const threadContainerRef = useRef<HTMLDivElement>(null)

    const [isExpanded, setIsExpanded] = useState(true)
    const [panelWidth, setPanelWidth] = useState(500)
    const [panelX, setPanelX] = useState<number | null>(null)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())
    const [appliedIdsInitialized, setAppliedIdsInitialized] = useState(false)
    const [isReviewing, setIsReviewing] = useState(false)  // 追踪是否正在执行 Review

    // 移动端检测
    const [isMobile, setIsMobile] = useState(false)
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768)
        }
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    // 同步进度状态（手动同步时使用）
    const [syncProgress, setSyncProgress] = useState<{
        isRunning: boolean
        totalRounds: number
        summarizedRounds: number
        currentBatch: number
    } | null>(null)

    // 停止同步标志
    const stopSyncRef = useRef(false)

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
        staleTime: 0  // 总是立即获取，确保从 session 列表点进来时能正确显示
    })

    // 获取当前 Review Session 的 ID（用于检查未汇总轮次）
    const currentReviewForPending = reviewSessions?.find(r => r.reviewSessionId === props.reviewSessionId)

    // 从 SSE 推送获取的自动同步状态
    const { data: autoSyncStatus } = useQuery<{
        status?: 'checking' | 'syncing' | 'complete'
        syncingRounds?: number[]
        savedRounds?: number[]
        savedSummaries?: Array<{ round: number; summary: string }>
        updatedAt?: number
    }>({
        queryKey: ['review-sync-status', currentReviewForPending?.id],
        enabled: Boolean(currentReviewForPending?.id),
        staleTime: Infinity
    })

    // 检查未汇总的轮次（pending 和 active 状态都需要查询）
    // 不需要轮询，只在用户点击同步或同步完成后手动刷新
    const pendingRoundsEnabled = Boolean(currentReviewForPending?.id) && (currentReviewForPending?.status === 'pending' || currentReviewForPending?.status === 'active')

    const { data: pendingRoundsData } = useQuery({
        queryKey: ['review-pending-rounds', currentReviewForPending?.id],
        queryFn: async () => {
            if (!currentReviewForPending?.id) throw new Error('No review ID')
            return await api.getReviewPendingRounds(currentReviewForPending.id)
        },
        enabled: pendingRoundsEnabled,
        staleTime: 30000  // 30 秒后重新获取，确保刷新页面后数据是最新的
    })

    // 合并 savedSummaries：API 初始数据 + SSE 实时推送的新数据
    const savedSummaries = useMemo(() => {
        const merged: Array<{ round: number; summary: string }> = []
        const seen = new Set<number>()

        // 先添加 API 返回的初始数据
        if (pendingRoundsData?.savedSummaries) {
            for (const s of pendingRoundsData.savedSummaries) {
                if (!seen.has(s.round)) {
                    merged.push(s)
                    seen.add(s.round)
                }
            }
        }

        // 再添加 SSE 实时推送的新数据（累积的）
        if (autoSyncStatus?.savedSummaries) {
            for (const s of autoSyncStatus.savedSummaries) {
                if (!seen.has(s.round)) {
                    merged.push(s)
                    seen.add(s.round)
                }
            }
        }

        // 按轮次排序
        merged.sort((a, b) => a.round - b.round)
        return merged
    }, [autoSyncStatus?.savedSummaries, pendingRoundsData?.savedSummaries])

    // 获取已发送的建议 ID（从后端持久化数据）
    const { data: appliedSuggestionsData } = useQuery({
        queryKey: ['review-applied-suggestions', currentReviewForPending?.id],
        queryFn: async () => {
            if (!currentReviewForPending?.id) throw new Error('No review ID')
            return await api.getAppliedSuggestionIds(currentReviewForPending.id)
        },
        enabled: Boolean(currentReviewForPending?.id),
        staleTime: Infinity  // 只在首次加载时获取
    })

    // 初始化 appliedIds（只执行一次）
    useEffect(() => {
        if (appliedIdsInitialized) return
        if (!appliedSuggestionsData?.appliedIds) return
        if (appliedSuggestionsData.appliedIds.length > 0) {
            setAppliedIds(new Set(appliedSuggestionsData.appliedIds))
        }
        setAppliedIdsInitialized(true)
    }, [appliedSuggestionsData, appliedIdsInitialized])

    // 页面加载后，如果有 pendingRounds 且不在同步中，自动触发同步
    const autoSyncTriggeredRef = useRef(false)
    useEffect(() => {
        // 只触发一次
        if (autoSyncTriggeredRef.current) return
        // 需要有 review session 和 pending rounds 数据
        if (!currentReviewForPending?.id || !pendingRoundsData) return
        // 有待同步的轮次
        if (!pendingRoundsData.hasPendingRounds) return
        // 不在同步中
        if (autoSyncStatus?.status === 'syncing' || autoSyncStatus?.status === 'checking') return

        autoSyncTriggeredRef.current = true
        console.log('[ReviewPanel] Auto triggering sync for pending rounds:', pendingRoundsData.pendingRounds)
        api.syncReviewRounds(currentReviewForPending.id).catch(err => {
            console.error('[ReviewPanel] Auto sync failed:', err)
        })
    }, [currentReviewForPending?.id, pendingRoundsData, autoSyncStatus?.status, api])

    // 获取 Review Session 信息
    const { data: reviewSession } = useQuery({
        queryKey: ['session', props.reviewSessionId],
        queryFn: async () => {
            return await api.getSession(props.reviewSessionId)
        },
        enabled: Boolean(props.reviewSessionId),
        refetchInterval: (query) => {
            // 只在 AI 思考时快速轮询
            const thinking = query.state.data?.thinking
            return thinking ? 1000 : 5000
        }
    })

    // 获取 Review Session 的消息
    const { data: reviewMessagesData, isLoading: isLoadingMessages } = useQuery({
        queryKey: ['messages', props.reviewSessionId],
        queryFn: async () => {
            return await api.getMessages(props.reviewSessionId, { limit: 100 })
        },
        enabled: Boolean(props.reviewSessionId),
        refetchInterval: (query) => {
            // 只在 AI 思考时快速轮询
            const thinking = reviewSession?.thinking
            return thinking ? 1000 : 5000
        }
    })

    const currentReview = reviewSessions?.find(r => r.reviewSessionId === props.reviewSessionId)
    const messages = (reviewMessagesData?.messages ?? []) as DecryptedMessage[]

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
            cache.set(message.id, { source: message, normalized: next })
            if (next) normalized.push(next)
        }
        for (const id of cache.keys()) {
            if (!seen.has(id)) {
                cache.delete(id)
            }
        }
        return normalized
    }, [messages])

    const session = reviewSession?.session
    const reduced = useMemo(() => {
        return reduceChatBlocks(normalizedMessages, session?.agentState ?? null)
    }, [normalizedMessages, session?.agentState])

    const reconciled = useMemo(
        () => reconcileChatBlocks(reduced.blocks, blocksByIdRef.current),
        [reduced.blocks]
    )

    useEffect(() => {
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

    // 可中断的等待函数
    const interruptibleWait = useCallback((ms: number): Promise<boolean> => {
        return new Promise(resolve => {
            const checkInterval = 100 // 每 100ms 检查一次停止标志
            let elapsed = 0
            const timer = setInterval(() => {
                elapsed += checkInterval
                if (stopSyncRef.current || elapsed >= ms) {
                    clearInterval(timer)
                    resolve(!stopSyncRef.current) // 返回 true 表示正常完成，false 表示被中断
                }
            }, checkInterval)
        })
    }, [])

    // 停止同步
    const handleStopSync = useCallback(async () => {
        stopSyncRef.current = true
        // 同时中止正在进行的 AI 请求
        try {
            await api.abortSession(props.reviewSessionId)
        } catch {
            // 忽略中止错误
        }
        setSyncProgress(null)
    }, [api, props.reviewSessionId])

    // 同步数据（发送给 Review AI 做汇总）- 自动循环直到完成
    const syncRoundsMutation = useMutation({
        mutationFn: async () => {
            if (!currentReview) {
                throw new Error('No current review found')
            }

            // 重置停止标志
            stopSyncRef.current = false

            // 获取初始状态
            const initialStatus = await api.getReviewPendingRounds(currentReview.id)
            if (!initialStatus.hasPendingRounds) {
                return { success: true, message: '没有待汇总的轮次' }
            }

            let batchCount = 0

            // 初始化进度
            setSyncProgress({
                isRunning: true,
                totalRounds: initialStatus.totalRounds,
                summarizedRounds: initialStatus.summarizedRounds,
                currentBatch: 1
            })

            // 循环执行直到所有轮次都同步完成
            while (!stopSyncRef.current) {
                batchCount++

                // 更新当前批次
                setSyncProgress(prev => prev ? { ...prev, currentBatch: batchCount } : null)

                // 执行一次同步
                const result = await api.syncReviewRounds(currentReview.id)

                // 检查是否被停止
                if (stopSyncRef.current) break

                // 如果 AI 正忙，等待后重试
                if (result.error === 'busy') {
                    if (!await interruptibleWait(2000)) break
                    continue
                }

                // 等待 AI 思考完成
                let waitCount = 0
                const maxWait = 120 // 最多等待 2 分钟
                while (waitCount < maxWait && !stopSyncRef.current) {
                    if (!await interruptibleWait(1000)) break
                    const sessionStatus = await api.getSession(props.reviewSessionId)
                    if (!sessionStatus?.session?.thinking) {
                        break
                    }
                    waitCount++
                }

                if (stopSyncRef.current) break

                // 等待 AI 回复被同步到数据库（初始等待 3 秒）
                if (!await interruptibleWait(3000)) break

                // 尝试保存汇总结果，最多重试 15 次，每次等待 2 秒（共 30 秒）
                let saveSuccess = false
                for (let saveAttempt = 0; saveAttempt < 15 && !stopSyncRef.current; saveAttempt++) {
                    try {
                        const saveResult = await api.saveReviewSummary(currentReview.id)
                        if (saveResult.success || saveResult.alreadyExists) {
                            saveSuccess = true
                            break
                        }
                        // noSummary 错误表示 AI 回复还没准备好，继续等待重试
                    } catch {
                        // 网络错误，继续重试
                    }
                    // 等待后再重试
                    if (!await interruptibleWait(2000)) break
                }

                if (stopSyncRef.current) break

                // 如果保存失败，不继续下一批（避免重复发送相同轮次）
                if (!saveSuccess) {
                    break
                }

                // 刷新 pending rounds 数据
                queryClient.invalidateQueries({ queryKey: ['review-pending-rounds', currentReview?.id] })

                // 检查是否还有待汇总的轮次
                const status = await api.getReviewPendingRounds(currentReview.id)

                // 更新进度
                setSyncProgress(prev => prev ? {
                    ...prev,
                    totalRounds: status.totalRounds,
                    summarizedRounds: status.summarizedRounds
                } : null)

                if (!status.hasPendingRounds) {
                    // 全部完成
                    break
                }

                // 短暂延迟后继续下一批（可中断）
                if (!await interruptibleWait(1000)) break
            }

            return { success: true, stopped: stopSyncRef.current, batches: batchCount }
        },
        onSuccess: () => {
            setSyncProgress(null)
            stopSyncRef.current = false
            queryClient.invalidateQueries({ queryKey: ['review-pending-rounds', currentReview?.id] })
        },
        onError: () => {
            setSyncProgress(null)
            stopSyncRef.current = false
        }
    })

    // 滚动到底部的辅助函数
    const scrollToBottom = useCallback(() => {
        const container = threadContainerRef.current
        if (container) {
            requestAnimationFrame(() => {
                container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
            })
        }
    }, [])

    // 开始 Review（发送给 Review AI）
    // 注意：Review AI 回复结束后，后端会自动用 MiniMax 解析结果并注入到 Review Session
    const startReviewMutation = useMutation({
        mutationFn: async (previousSuggestions?: SuggestionWithStatus[]) => {
            if (!currentReview) {
                throw new Error('No current review found')
            }
            // 标记正在 Review
            setIsReviewing(true)
            // 转换 previousSuggestions 格式
            const formattedSuggestions = previousSuggestions?.map(s => ({
                id: s.id,
                type: s.type,
                severity: s.severity,
                title: s.title,
                detail: s.detail,
                applied: s.applied,
                deleted: s.deleted
            }))
            return await api.startReviewSession(currentReview.id, formattedSuggestions)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-sessions', props.mainSessionId] })
            queryClient.invalidateQueries({ queryKey: ['review-pending-rounds', currentReview?.id] })
            // 执行 review 时滚动到底部
            scrollToBottom()
        },
        onError: () => {
            // 出错时重置状态
            setIsReviewing(false)
        }
    })

    // 追踪 AI 是否曾经开始思考（用于判断 Review 是否真正结束）
    const hasStartedThinkingRef = useRef(false)

    // 当 AI 开始思考时，标记已开始
    useEffect(() => {
        if (session?.thinking && isReviewing) {
            hasStartedThinkingRef.current = true
        }
    }, [session?.thinking, isReviewing])

    // 当 AI 完成思考时，重置 isReviewing 状态（只有在 AI 曾经开始过思考后才重置）
    useEffect(() => {
        if (!session?.thinking && isReviewing && hasStartedThinkingRef.current) {
            setIsReviewing(false)
            hasStartedThinkingRef.current = false
        }
    }, [session?.thinking, isReviewing])

    // 从已处理的 blocks 中提取最后一个包含 suggestions JSON 的文本（覆盖而非累加）
    const allReviewTexts = useMemo(() => {
        // 倒序查找第一个有效的 review 结果
        for (let i = reconciled.blocks.length - 1; i >= 0; i--) {
            const block = reconciled.blocks[i]
            if (block.kind !== 'agent-text') continue

            const result = parseReviewResult(block.text)
            // 只要能解析出 suggestions（包括空数组），就认为是有效结果
            // 即使 suggestions 为空也返回，这样可以显示统计卡片
            if (result && result.suggestions) {
                return [block.text]
            }
        }
        return []
    }, [reconciled.blocks])

    // 计算选中的建议数量和详情
    const { selectedCount, selectedDetails } = useMemo(() => {
        if (allReviewTexts.length === 0) return { selectedCount: 0, selectedDetails: [] }
        const suggestions = getMergedSuggestions(allReviewTexts)
        const selected = suggestions.filter(s => selectedIds.has(s.id))
        return {
            selectedCount: selected.length,
            selectedDetails: selected.map(s => s.detail)
        }
    }, [allReviewTexts, selectedIds])

    // 自动滚动到底部：当消息数量变化或 AI 正在思考时
    const prevMessagesCountRef = useRef(messages.length)
    useEffect(() => {
        const container = threadContainerRef.current
        if (!container) return

        const shouldScroll = messages.length !== prevMessagesCountRef.current || session?.thinking
        prevMessagesCountRef.current = messages.length

        if (shouldScroll) {
            // 使用 requestAnimationFrame 确保 DOM 更新后再滚动
            requestAnimationFrame(() => {
                container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
            })
        }
    }, [messages.length, session?.thinking])

    // 应用建议到主 Session
    const applySuggestionsMutation = useMutation({
        mutationFn: async (details: string[]) => {
            if (!currentReview) {
                throw new Error('No current review found')
            }
            // 合并所有选中的建议详情
            const combined = details.join('\n\n---\n\n')
            // 获取当前选中的 ID（在 mutationFn 中捕获，避免闭包问题）
            const idsToApply = Array.from(selectedIds)
            // 调用新 API，同时发送消息和保存已发送的建议 ID
            await api.applyReviewSuggestion(currentReview.id, combined, idsToApply)
        },
        onSuccess: () => {
            // 将已选中的 ID 加入已发送集合
            setAppliedIds(prev => {
                const next = new Set(prev)
                for (const id of selectedIds) {
                    next.add(id)
                }
                return next
            })
            // 清空选中状态
            setSelectedIds(new Set())
        }
    })

    // 关闭 Review Session（取消但保留数据）
    const cancelReviewMutation = useMutation({
        mutationFn: async () => {
            if (!currentReview) {
                throw new Error('No current review found')
            }
            // 先中止 Review AI
            try {
                await api.abortSession(props.reviewSessionId)
            } catch {
                // 忽略中止错误
            }
            // 将状态设为 cancelled
            return await api.cancelReviewSession(currentReview.id)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-sessions', props.mainSessionId] })
            props.onClose?.()
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
                className={`fixed z-50 rounded-full bg-[var(--app-secondary-bg)] text-[var(--app-fg)] shadow-lg border border-[var(--app-divider)] hover:bg-[var(--app-subtle-bg)] hover:scale-105 transition-all flex items-center justify-center ${
                    isMobile ? 'bottom-20 right-4 w-12 h-12' : 'bottom-5 right-5 w-14 h-14'
                }`}
                title="打开 Review AI"
            >
                <ReviewIcon className={isMobile ? 'w-5 h-5' : 'w-6 h-6'} />
                {(currentReview?.status === 'active' || session?.thinking) && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full animate-pulse" />
                )}
            </button>
        )
    }

    // 移动端全屏，桌面端保持可拖拽
    const rightPos = isMobile ? 0 : (panelX === null ? 0 : undefined)
    const leftPos = isMobile ? 0 : (panelX !== null ? panelX : undefined)
    const actualWidth = isMobile ? '100%' : `${panelWidth}px`

    return (
        <div
            ref={panelRef}
            className={`fixed top-0 bottom-0 z-50 shadow-2xl bg-[var(--app-bg)] flex flex-col ${
                isMobile ? '' : 'border-l border-[var(--app-divider)]'
            }`}
            style={{
                width: actualWidth,
                right: rightPos,
                left: leftPos,
                cursor: !isMobile && dragMode === 'move' ? 'grabbing' : undefined
            }}
        >
            {/* 左边缘拖拽调整宽度 - 仅桌面端 */}
            {!isMobile && (
                <div
                    className="absolute top-0 bottom-0 left-0 w-1 cursor-ew-resize hover:bg-[var(--app-divider)] z-10"
                    onMouseDown={handleResizeStart}
                    style={{ backgroundColor: dragMode === 'resize' ? 'var(--app-divider)' : undefined }}
                />
            )}

            {/* Header */}
            <div
                className={`flex items-center justify-between px-3 py-2 border-b border-[var(--app-divider)] bg-[var(--app-subtle-bg)] select-none ${
                    isMobile ? '' : 'cursor-grab active:cursor-grabbing'
                }`}
                onMouseDown={isMobile ? undefined : handleMoveStart}
            >
                <div className="flex items-center gap-2">
                    {!isMobile && <GripIcon className="w-4 h-4 text-[var(--app-hint)]" />}
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
                    <button
                        type="button"
                        onClick={() => setDeleteDialogOpen(true)}
                        disabled={cancelReviewMutation.isPending}
                        className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-[var(--app-hint)] hover:text-red-500 disabled:opacity-50"
                        title="删除 Review"
                    >
                        <TrashIcon />
                    </button>
                </div>
            </div>

            {/* 已完成汇总的结果卡片 - 默认收起，展开时可抵达底部 */}
            {savedSummaries.length > 0 && (
                <div className="min-h-0 flex-shrink border-b border-[var(--app-divider)] overflow-y-auto">
                    <SummaryCards summaries={savedSummaries} />
                </div>
            )}

            {/* 对话界面 - 复用 HappyThread */}
            <AssistantRuntimeProvider runtime={runtime}>
                {/* 可滚动的对话区域 */}
                <div ref={threadContainerRef} className="min-h-0 flex-1 overflow-y-auto">
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

            {/* 固定在底部的建议列表/结果卡片 */}
            {/* 有建议时显示建议列表，或者 Review 完成时显示完成卡片（正在 Review 时不显示完成卡片） */}
            {(allReviewTexts.length > 0 || (!isReviewing && currentReview && !pendingRoundsData?.hasUnreviewedRounds && !pendingRoundsData?.hasPendingRounds && pendingRoundsData?.summarizedRounds && pendingRoundsData.summarizedRounds > 0)) && (
                <div className="flex-shrink-0 border-t border-[var(--app-divider)] bg-[var(--app-bg)]">
                    <div className="px-3 py-2">
                        {allReviewTexts.length > 0 ? (
                            <ReviewSuggestions
                                key={allReviewTexts.join('|').substring(0, 100)}
                                reviewTexts={allReviewTexts}
                                onApply={(details) => applySuggestionsMutation.mutate(details)}
                                isApplying={applySuggestionsMutation.isPending}
                                onReview={(previousSuggestions) => startReviewMutation.mutate(previousSuggestions)}
                                isReviewing={startReviewMutation.isPending}
                                reviewDisabled={pendingRoundsData?.hasPendingRounds || !pendingRoundsData?.hasUnreviewedRounds || session?.thinking || (autoSyncStatus?.status === 'syncing' && autoSyncStatus?.syncingRounds && autoSyncStatus.syncingRounds.length > 0)}
                                unreviewedRounds={pendingRoundsData?.unreviewedRounds}
                                selectedIds={selectedIds}
                                onSelectedIdsChange={setSelectedIds}
                                appliedIds={appliedIds}
                                onAppliedIdsChange={setAppliedIds}
                            />
                        ) : (
                            /* Review 完成但没有解析到建议时显示完成卡片 */
                            <div className="rounded-md border border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-2.5 py-1.5">
                                <div className="flex items-center gap-2 text-xs">
                                    <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span className="font-medium text-green-700 dark:text-green-300">
                                        Review 完成
                                    </span>
                                    <span className="text-green-600 dark:text-green-400">
                                        已审查 {pendingRoundsData?.summarizedRounds} 轮对话
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 底部状态栏 - 左侧 Review 按钮，中间状态信息，右侧发送按钮 */}
            <div className="flex-shrink-0 px-3 py-1.5 border-t border-[var(--app-divider)] bg-[var(--app-subtle-bg)]">
                <div className="flex items-center justify-between gap-2 text-xs">
                    {/* 左侧：Review 按钮 */}
                    <div className="flex items-center gap-2">
                        {/* Review 按钮：有待审轮次或正在同步时都显示 */}
                        {currentReview && (pendingRoundsData?.hasUnreviewedRounds || pendingRoundsData?.hasPendingRounds || session?.thinking) && (
                            <button
                                type="button"
                                onClick={() => startReviewMutation.mutate()}
                                disabled={startReviewMutation.isPending || session?.thinking || autoSyncStatus?.status === 'syncing' || pendingRoundsData?.hasPendingRounds || !pendingRoundsData?.hasUnreviewedRounds}
                                className="px-2 py-1 text-xs font-medium rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {startReviewMutation.isPending ? '执行中...' : `Review (${pendingRoundsData?.unreviewedRounds ?? 0})`}
                            </button>
                        )}
                        {/* 完成状态：没有待审轮次且没有待同步轮次且不在思考 */}
                        {currentReview && !pendingRoundsData?.hasUnreviewedRounds && !pendingRoundsData?.hasPendingRounds && !session?.thinking && (
                            <span className="text-green-500 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                完成
                            </span>
                        )}
                    </div>

                    {/* 中间：状态信息 */}
                    <div className="flex-1 flex items-center justify-center gap-2 text-[var(--app-hint)]">
                        {/* 加载中 */}
                        {!currentReview && reviewSessions === undefined && (
                            <>
                                <LoadingIcon className="w-3 h-3" />
                                <span>加载中...</span>
                            </>
                        )}

                        {/* 找不到 currentReview */}
                        {!currentReview && reviewSessions !== undefined && (
                            <span>未找到 Review 会话</span>
                        )}

                        {/* 同步/检查状态 - 优先显示同步进度，排除 Review 执行中 */}
                        {currentReview && !isReviewing && (autoSyncStatus?.status === 'syncing' || (session?.thinking && pendingRoundsData?.hasPendingRounds)) && pendingRoundsData && (
                            <span className="flex items-center gap-1 text-blue-500">
                                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                同步 {pendingRoundsData.summarizedRounds}/{pendingRoundsData.totalRounds}
                            </span>
                        )}
                        {currentReview && !isReviewing && autoSyncStatus?.status === 'checking' && !session?.thinking && (
                            <span className="flex items-center gap-1 text-blue-500">
                                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                检查中
                            </span>
                        )}
                        {/* Review 执行中状态 - 仅在 isReviewing 为 true 时显示 */}
                        {currentReview && isReviewing && (
                            <span className="flex items-center gap-1 text-green-500">
                                <div className="flex gap-0.5">
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                                正在 Review
                            </span>
                        )}
                        {/* 空闲状态：显示轮次信息 */}
                        {currentReview && !session?.thinking && !isReviewing && autoSyncStatus?.status !== 'syncing' && autoSyncStatus?.status !== 'checking' && pendingRoundsData && (
                            <span>
                                {pendingRoundsData.summarizedRounds}/{pendingRoundsData.totalRounds} 轮汇总
                                {pendingRoundsData.hasUnreviewedRounds && (
                                    <span className="text-amber-500 ml-1">· {pendingRoundsData.unreviewedRounds} 待审</span>
                                )}
                            </span>
                        )}
                    </div>

                    {/* 右侧：发送按钮 */}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => applySuggestionsMutation.mutate(selectedDetails)}
                            disabled={selectedCount === 0 || applySuggestionsMutation.isPending}
                            className="px-2 py-1 text-xs font-medium rounded bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {applySuggestionsMutation.isPending ? '发送中...' : `发送 (${selectedCount})`}
                        </button>
                    </div>
                </div>
            </div>

            {/* 删除确认对话框 */}
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>删除 Review</DialogTitle>
                        <DialogDescription>
                            确定要删除此 Review 会话吗？此操作无法撤销。
                        </DialogDescription>
                    </DialogHeader>
                    <div className="mt-4 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setDeleteDialogOpen(false)}
                            className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setDeleteDialogOpen(false)
                                cancelReviewMutation.mutate()
                            }}
                            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
                        >
                            删除
                        </button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
