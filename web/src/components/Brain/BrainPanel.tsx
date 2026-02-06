/**
 * Brain 面板组件
 *
 * 显示汇总卡片 + 完整对话界面
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

// Icons
function BrainIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M8 10h.01" />
            <path d="M12 10h.01" />
            <path d="M16 10h.01" />
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

export function BrainPanel(props: {
    mainSessionId: string
    brainSessionId: string
    onClose?: () => void
}) {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const panelRef = useRef<HTMLDivElement>(null)
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const blocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())
    const threadContainerRef = useRef<HTMLDivElement>(null)

    const [panelWidth, setPanelWidth] = useState(500)
    const [panelX, setPanelX] = useState<number | null>(null)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [isBraining, setIsBraining] = useState(false)  // 追踪是否正在执行 Brain

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

    // 获取 Brain Session 详情
    const { data: brainSessions } = useQuery({
        queryKey: ['brain-sessions', props.mainSessionId],
        queryFn: async () => {
            const result = await api.getBrainSessions(props.mainSessionId)
            return result.brainSessions
        },
        staleTime: 0  // 总是立即获取，确保从 session 列表点进来时能正确显示
    })

    // 获取当前 Brain Session 的 ID（用于检查未汇总轮次）
    const currentBrainForPending = brainSessions?.find(r => r.brainSessionId === props.brainSessionId)

    // 从 SSE 推送获取的自动同步状态
    const { data: autoSyncStatus } = useQuery<{
        status?: 'checking' | 'syncing' | 'complete'
        syncingRounds?: number[]
        savedRounds?: number[]
        savedSummaries?: Array<{ round: number; summary: string }>
        updatedAt?: number
    }>({
        queryKey: ['brain-sync-status', currentBrainForPending?.id],
        enabled: Boolean(currentBrainForPending?.id),
        staleTime: Infinity
    })

    // 检查未汇总的轮次（pending 和 active 状态都需要查询）
    // 不需要轮询，只在用户点击同步或同步完成后手动刷新
    const pendingRoundsEnabled = Boolean(currentBrainForPending?.id) && (currentBrainForPending?.status === 'pending' || currentBrainForPending?.status === 'active')

    const { data: pendingRoundsData } = useQuery({
        queryKey: ['brain-pending-rounds', currentBrainForPending?.id],
        queryFn: async () => {
            if (!currentBrainForPending?.id) throw new Error('No brain ID')
            return await api.getBrainPendingRounds(currentBrainForPending.id)
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

    // 页面加载后，如果有 pendingRounds 且不在同步中，自动触发同步
    const autoSyncTriggeredRef = useRef(false)
    useEffect(() => {
        // 只触发一次
        if (autoSyncTriggeredRef.current) return
        // 需要有 brain session 和 pending rounds 数据
        if (!currentBrainForPending?.id || !pendingRoundsData) return
        // 有待同步的轮次
        if (!pendingRoundsData.hasPendingRounds) return
        // 不在同步中
        if (autoSyncStatus?.status === 'syncing' || autoSyncStatus?.status === 'checking') return

        autoSyncTriggeredRef.current = true
        console.log('[BrainPanel] Auto triggering sync for pending rounds:', pendingRoundsData.pendingRounds)
        api.syncBrainRounds(currentBrainForPending.id).catch(err => {
            console.error('[BrainPanel] Auto sync failed:', err)
        })
    }, [currentBrainForPending?.id, pendingRoundsData, autoSyncStatus?.status, api])

    // 获取 Brain Session 信息
    const { data: brainSession } = useQuery({
        queryKey: ['session', props.brainSessionId],
        queryFn: async () => {
            return await api.getSession(props.brainSessionId)
        },
        enabled: Boolean(props.brainSessionId),
        refetchInterval: (query) => {
            // 只在 AI 思考时快速轮询
            const thinking = query.state.data?.thinking
            return thinking ? 1000 : 5000
        }
    })

    // 获取 Brain Session 的消息
    const { data: brainMessagesData, isLoading: isLoadingMessages } = useQuery({
        queryKey: ['messages', props.brainSessionId],
        queryFn: async () => {
            return await api.getMessages(props.brainSessionId, { limit: 100 })
        },
        enabled: Boolean(props.brainSessionId),
        refetchInterval: (query) => {
            // 只在 AI 思考时快速轮询
            const thinking = brainSession?.thinking
            return thinking ? 1000 : 5000
        }
    })

    const currentBrain = brainSessions?.find(r => r.brainSessionId === props.brainSessionId)
    const messages = (brainMessagesData?.messages ?? []) as DecryptedMessage[]

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

    const session = brainSession?.session
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

    // 发送消息到 Brain Session
    const handleSendMessage = useCallback((text: string) => {
        api.sendMessage(props.brainSessionId, text)
    }, [api, props.brainSessionId])

    // 中止 Brain Session
    const handleAbort = useCallback(async () => {
        await api.abortSession(props.brainSessionId)
    }, [api, props.brainSessionId])

    // 创建虚拟 Session 对象用于 Runtime
    const virtualSession: Session = useMemo(() => ({
        id: props.brainSessionId,
        active: session?.active ?? true,  // 默认 true，确保组件可用
        thinking: session?.thinking ?? false,
        agentState: session?.agentState ?? null,
        permissionMode: session?.permissionMode ?? 'default',
        modelMode: session?.modelMode ?? 'default',
        modelReasoningEffort: session?.modelReasoningEffort ?? undefined,
        metadata: session?.metadata ?? null,
        createdAt: session?.createdAt ?? Date.now(),
        updatedAt: session?.updatedAt ?? Date.now()
    }), [props.brainSessionId, session])

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
            await api.abortSession(props.brainSessionId)
        } catch {
            // 忽略中止错误
        }
        setSyncProgress(null)
    }, [api, props.brainSessionId])

    // 同步数据（发送给 Brain AI 做汇总）- 自动循环直到完成
    const syncRoundsMutation = useMutation({
        mutationFn: async () => {
            if (!currentBrain) {
                throw new Error('No current brain found')
            }

            // 重置停止标志
            stopSyncRef.current = false

            // 获取初始状态
            const initialStatus = await api.getBrainPendingRounds(currentBrain.id)
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
                const result = await api.syncBrainRounds(currentBrain.id)

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
                    const sessionStatus = await api.getSession(props.brainSessionId)
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
                        const saveResult = await api.saveBrainSummary(currentBrain.id)
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
                queryClient.invalidateQueries({ queryKey: ['brain-pending-rounds', currentBrain?.id] })

                // 检查是否还有待汇总的轮次
                const status = await api.getBrainPendingRounds(currentBrain.id)

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
            queryClient.invalidateQueries({ queryKey: ['brain-pending-rounds', currentBrain?.id] })
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

    // 开始 Brain（发送给 Brain AI）
    const startBrainMutation = useMutation({
        mutationFn: async () => {
            if (!currentBrain) {
                throw new Error('No current brain found')
            }
            // 标记正在 Brain
            setIsBraining(true)
            return await api.startBrainSession(currentBrain.id)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['brain-sessions', props.mainSessionId] })
            queryClient.invalidateQueries({ queryKey: ['brain-pending-rounds', currentBrain?.id] })
            // 执行 brain 时滚动到底部
            scrollToBottom()
        },
        onError: () => {
            // 出错时重置状态
            setIsBraining(false)
        }
    })

    // 追踪 Brain 开始时的状态（用于判断是否处理完成）
    const brainStartTimeRef = useRef<number | null>(null)

    // 当开始 Brain 时，记录开始时间
    useEffect(() => {
        if (isBraining && brainStartTimeRef.current === null) {
            brainStartTimeRef.current = Date.now()
        }
    }, [isBraining])

    // 当 AI 完成思考后，重置 isBraining
    const thinkingEndTimeRef = useRef<number | null>(null)
    useEffect(() => {
        if (!isBraining) {
            thinkingEndTimeRef.current = null
            return
        }
        if (brainStartTimeRef.current === null) return

        // AI 还在思考，记录结束时间为 null
        if (session?.thinking) {
            thinkingEndTimeRef.current = null
            return
        }

        // AI 刚完成思考，记录结束时间
        if (thinkingEndTimeRef.current === null) {
            thinkingEndTimeRef.current = Date.now()
        }

        // 如果 AI 完成思考后 5 秒，重置状态
        const elapsed = Date.now() - thinkingEndTimeRef.current
        if (elapsed >= 5000) {
            setIsBraining(false)
            brainStartTimeRef.current = null
            thinkingEndTimeRef.current = null
        }
    }, [isBraining, session?.thinking])

    // 定时检查是否需要重置 isBraining
    useEffect(() => {
        if (!isBraining || session?.thinking) return

        const timer = setInterval(() => {
            if (thinkingEndTimeRef.current !== null) {
                const elapsed = Date.now() - thinkingEndTimeRef.current
                if (elapsed >= 5000) {
                    setIsBraining(false)
                    brainStartTimeRef.current = null
                    thinkingEndTimeRef.current = null
                }
            }
        }, 1000)

        return () => clearInterval(timer)
    }, [isBraining, session?.thinking])

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

    // 关闭 Brain Session（取消但保留数据）
    const cancelBrainMutation = useMutation({
        mutationFn: async () => {
            if (!currentBrain) {
                throw new Error('No current brain found')
            }
            // 先中止 Brain AI
            try {
                await api.abortSession(props.brainSessionId)
            } catch {
                // 忽略中止错误
            }
            // 将状态设为 cancelled
            return await api.cancelBrainSession(currentBrain.id)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['brain-sessions', props.mainSessionId] })
            props.onClose?.()
        }
    })

    // 刷新
    const handleRefresh = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['messages', props.brainSessionId] })
    }, [queryClient, props.brainSessionId])

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
                    <BrainIcon className="w-4 h-4 text-[var(--app-fg)]" />
                    <span className="text-sm font-medium">Brain AI</span>
                    {session?.thinking && (
                        <LoadingIcon className="w-4 h-4 text-green-500" />
                    )}
                </div>
                <div className="flex items-center gap-1" onMouseDown={e => e.stopPropagation()}>
                    <button
                        type="button"
                        onClick={() => setDeleteDialogOpen(true)}
                        disabled={cancelBrainMutation.isPending}
                        className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-[var(--app-hint)] hover:text-red-500 disabled:opacity-50"
                        title="删除 Brain"
                    >
                        <TrashIcon />
                    </button>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="p-1.5 rounded hover:bg-[var(--app-bg)] text-[var(--app-hint)]"
                        title="关闭"
                    >
                        <CloseIcon />
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
                        key={props.brainSessionId}
                        api={api}
                        sessionId={props.brainSessionId}
                        metadata={session?.metadata ?? null}
                        disabled={false}
                        onRefresh={handleRefresh}
                        onRetryMessage={undefined}
                        isLoadingMessages={isLoadingMessages}
                        hasMoreMessages={false}
                        isLoadingMoreMessages={false}
                        onLoadMore={async () => {}}
                        rawMessagesCount={messages.length}
                        normalizedMessagesCount={normalizedMessages.length}
                        renderedMessagesCount={reconciled.blocks.length}
                    />
                </div>
            </AssistantRuntimeProvider>

            {/* Brain 完成时显示完成卡片 */}
            {(!isBraining && currentBrain && !pendingRoundsData?.hasUnreviewedRounds && !pendingRoundsData?.hasPendingRounds && pendingRoundsData?.summarizedRounds && pendingRoundsData.summarizedRounds > 0) && (
                <div className="flex-shrink-0 border-t border-[var(--app-divider)] bg-[var(--app-bg)]">
                    <div className="px-3 py-2">
                        <div className="rounded-md border border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-2.5 py-1.5">
                            <div className="flex items-center gap-2 text-xs">
                                <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="font-medium text-green-700 dark:text-green-300">
                                    Brain 完成
                                </span>
                                <span className="text-green-600 dark:text-green-400">
                                    已审查 {pendingRoundsData?.summarizedRounds} 轮对话
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 底部状态栏 - 左侧 Brain 按钮，中间状态信息 */}
            <div className="flex-shrink-0 px-3 py-1.5 border-t border-[var(--app-divider)] bg-[var(--app-subtle-bg)] pb-[calc(0.375rem+env(safe-area-inset-bottom))]">
                <div className="flex items-center justify-between gap-2 text-xs">
                    {/* 左侧：Brain 按钮 */}
                    <div className="flex items-center gap-2">
                        {/* Brain 按钮：有待审轮次时显示 */}
                        {currentBrain && pendingRoundsData?.hasUnreviewedRounds && (
                            <button
                                type="button"
                                onClick={() => startBrainMutation.mutate()}
                                disabled={startBrainMutation.isPending || session?.thinking || autoSyncStatus?.status === 'syncing' || pendingRoundsData?.hasPendingRounds}
                                className="px-2 py-1 text-xs font-medium rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {startBrainMutation.isPending ? '执行中...' : `Brain (${pendingRoundsData.unreviewedRounds})`}
                            </button>
                        )}
                        {/* 完成状态：有对话轮次、没有待审轮次、没有待同步轮次、不在思考 */}
                        {currentBrain && pendingRoundsData && pendingRoundsData.totalRounds > 0 && !pendingRoundsData.hasUnreviewedRounds && !pendingRoundsData.hasPendingRounds && !session?.thinking && (
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
                        {!currentBrain && brainSessions === undefined && (
                            <>
                                <LoadingIcon className="w-3 h-3" />
                                <span>加载中...</span>
                            </>
                        )}

                        {/* 找不到 currentBrain */}
                        {!currentBrain && brainSessions !== undefined && (
                            <span>未找到 Brain 会话</span>
                        )}

                        {/* 同步/检查状态 - 优先显示同步进度，排除 Brain 执行中 */}
                        {currentBrain && !isBraining && (autoSyncStatus?.status === 'syncing' || (session?.thinking && pendingRoundsData?.hasPendingRounds)) && pendingRoundsData && (
                            <span className="flex items-center gap-1 text-blue-500">
                                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                同步 {pendingRoundsData.summarizedRounds}/{pendingRoundsData.totalRounds}
                            </span>
                        )}
                        {currentBrain && !isBraining && autoSyncStatus?.status === 'checking' && !session?.thinking && (
                            <span className="flex items-center gap-1 text-blue-500">
                                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                检查中
                            </span>
                        )}
                        {/* Brain 执行中状态 - 仅在 isBraining 为 true 时显示 */}
                        {currentBrain && isBraining && (
                            <span className="flex items-center gap-1 text-green-500">
                                <div className="flex gap-0.5">
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                                正在 Brain
                            </span>
                        )}
                        {/* 空闲状态：显示轮次信息 */}
                        {currentBrain && !session?.thinking && !isBraining && autoSyncStatus?.status !== 'syncing' && autoSyncStatus?.status !== 'checking' && pendingRoundsData && (
                            <span>
                                {pendingRoundsData.summarizedRounds}/{pendingRoundsData.totalRounds} 轮汇总
                                {pendingRoundsData.hasUnreviewedRounds && (
                                    <span className="text-amber-500 ml-1">· {pendingRoundsData.unreviewedRounds} 待审</span>
                                )}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* 删除确认对话框 */}
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>删除 Brain</DialogTitle>
                        <DialogDescription>
                            确定要删除此 Brain 会话吗？此操作无法撤销。
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
                                cancelBrainMutation.mutate()
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
