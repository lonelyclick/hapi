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
import { ReviewSuggestions, parseReviewResult, type SuggestionWithStatus } from './ReviewSuggestions'

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

    // 获取 Review Session 详情（不需要频繁轮询）
    const { data: reviewSessions } = useQuery({
        queryKey: ['review-sessions', props.mainSessionId],
        queryFn: async () => {
            const result = await api.getReviewSessions(props.mainSessionId)
            return result.reviewSessions
        },
        staleTime: 30000  // 30 秒内不重新获取
    })

    // 获取当前 Review Session 的 ID（用于检查未汇总轮次）
    const currentReviewForPending = reviewSessions?.find(r => r.reviewSessionId === props.reviewSessionId)

    // 从 SSE 推送获取的自动同步状态
    const { data: autoSyncStatus } = useQuery<{
        status?: 'checking' | 'syncing' | 'complete'
        syncingRounds?: number[]
        savedRounds?: number[]
        updatedAt?: number
    }>({
        queryKey: ['review-sync-status', currentReviewForPending?.id],
        enabled: Boolean(currentReviewForPending?.id),
        staleTime: Infinity
    })

    // 检查未汇总的轮次（pending 和 active 状态都需要查询）
    // 不需要轮询，只在用户点击同步或同步完成后手动刷新
    const { data: pendingRoundsData } = useQuery({
        queryKey: ['review-pending-rounds', currentReviewForPending?.id],
        queryFn: async () => {
            if (!currentReviewForPending?.id) throw new Error('No review ID')
            return await api.getReviewPendingRounds(currentReviewForPending.id)
        },
        enabled: Boolean(currentReviewForPending?.id) && (currentReviewForPending?.status === 'pending' || currentReviewForPending?.status === 'active'),
        staleTime: Infinity  // 数据不会自动过期
    })

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

    // 保存 AI 的汇总结果
    const saveSummaryMutation = useMutation({
        mutationFn: async () => {
            if (!currentReview) {
                throw new Error('No current review found')
            }
            return await api.saveReviewSummary(currentReview.id)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-pending-rounds', currentReview?.id] })
        },
        onError: (error) => {
            // noSummary 错误通常是因为消息还没同步完成，静默忽略
            const errMsg = String(error)
            if (!errMsg.includes('noSummary')) {
                console.error('[ReviewPanel] saveReviewSummary error:', error)
            }
        }
    })

    // 当 AI 完成思考后自动尝试保存汇总
    const prevThinkingRef = useRef<boolean | undefined>(undefined)
    useEffect(() => {
        const wasThinking = prevThinkingRef.current
        const isThinking = session?.thinking
        prevThinkingRef.current = isThinking

        // 从思考中变为不思考 -> AI 刚完成回复
        if (wasThinking === true && isThinking === false && currentReview?.status === 'active') {
            // 延迟 3 秒再保存，确保消息已经完全同步到服务器
            setTimeout(() => {
                saveSummaryMutation.mutate()
            }, 3000)
        }
    }, [session?.thinking, currentReview?.status, saveSummaryMutation])

    // 开始 Review（发送给 Review AI）
    const startReviewMutation = useMutation({
        mutationFn: async (previousSuggestions?: SuggestionWithStatus[]) => {
            if (!currentReview) {
                throw new Error('No current review found')
            }
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
        }
    })

    // 从已处理的 blocks 中提取最后一个包含 suggestions JSON 的文本（覆盖而非累加）
    const allReviewTexts = useMemo(() => {
        // 倒序查找第一个有效的 review 结果
        for (let i = reconciled.blocks.length - 1; i >= 0; i--) {
            const block = reconciled.blocks[i]
            if (block.kind !== 'agent-text') continue

            const result = parseReviewResult(block.text)
            // 只要能解析出 suggestions（包括空数组），就认为是有效结果
            // 空数组表示所有问题都已修复，应该清空建议列表
            if (result && result.suggestions) {
                // 如果 suggestions 为空数组，返回空，表示没有建议需要显示
                if (result.suggestions.length === 0) {
                    return []
                }
                // 只返回最后一个 review 结果
                return [block.text]
            }
        }
        return []
    }, [reconciled.blocks])

    // 应用建议到主 Session
    const applySuggestionsMutation = useMutation({
        mutationFn: async (details: string[]) => {
            // 合并所有选中的建议详情
            const combined = details.join('\n\n---\n\n')
            await api.sendMessage(props.mainSessionId, combined)
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
                </div>
            </div>

            {/* 对话界面 - 复用 HappyThread */}
            <AssistantRuntimeProvider runtime={runtime}>
                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto">
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
                        {/* 建议卡片 - 显示在对话列表下方（合并所有 review 结果） */}
                        {allReviewTexts.length > 0 && (
                            <div className="mx-auto w-full max-w-content min-w-0 px-3 pb-4">
                                <ReviewSuggestions
                                    reviewTexts={allReviewTexts}
                                    onApply={(details) => applySuggestionsMutation.mutate(details)}
                                    isApplying={applySuggestionsMutation.isPending}
                                    onReview={(previousSuggestions) => startReviewMutation.mutate(previousSuggestions)}
                                    isReviewing={startReviewMutation.isPending}
                                    reviewDisabled={pendingRoundsData?.hasPendingRounds || !pendingRoundsData?.hasUnreviewedRounds || session?.thinking || autoSyncStatus?.status === 'syncing'}
                                    unreviewedRounds={pendingRoundsData?.unreviewedRounds}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </AssistantRuntimeProvider>

            {/* 底部操作栏 */}
            <div className="border-t border-[var(--app-divider)] px-3 py-2 bg-[var(--app-subtle-bg)]">
                {/* pending 或 active 状态 - 显示同步和 Review 按钮 */}
                {(currentReview?.status === 'pending' || currentReview?.status === 'active') && (
                    <div className="flex flex-col gap-2">
                        {/* 同步状态提示 - 仅在同步/检查时显示 */}
                        {(autoSyncStatus?.status === 'syncing' || autoSyncStatus?.status === 'checking') && pendingRoundsData && (
                            <div className="text-xs text-center text-[var(--app-hint)]">
                                {autoSyncStatus?.status === 'syncing' ? (
                                    <span className="flex items-center justify-center gap-1.5">
                                        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        同步中 {pendingRoundsData.summarizedRounds}/{pendingRoundsData.totalRounds}
                                    </span>
                                ) : (
                                    <span className="flex items-center justify-center gap-1.5">
                                        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        检查中...
                                    </span>
                                )}
                            </div>
                        )}

                        {/* AI 正在思考时显示进度 */}
                        {session?.thinking && autoSyncStatus?.status !== 'syncing' && (
                            <div className="flex items-center justify-center gap-2 py-1">
                                <div className="flex gap-0.5">
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                                <span className="text-xs text-[var(--app-fg)]">AI 处理中...</span>
                            </div>
                        )}

                        {/* 没有建议时显示独立的 Review 按钮 */}
                        {allReviewTexts.length === 0 && pendingRoundsData?.hasUnreviewedRounds && (
                            <button
                                type="button"
                                onClick={() => startReviewMutation.mutate()}
                                disabled={startReviewMutation.isPending || pendingRoundsData?.hasPendingRounds || session?.thinking || autoSyncStatus?.status === 'syncing'}
                                className="w-full px-3 py-1.5 text-xs font-medium rounded-md bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-sm hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {startReviewMutation.isPending ? (
                                    <span className="flex items-center justify-center gap-1.5">
                                        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        执行中...
                                    </span>
                                ) : (
                                    `Review ${pendingRoundsData.unreviewedRounds} 轮`
                                )}
                            </button>
                        )}
                    </div>
                )}

                {/* 加载中 */}
                {!currentReview && reviewSessions === undefined && (
                    <div className="flex items-center justify-center gap-2 py-2 text-[var(--app-hint)]">
                        <LoadingIcon />
                        <span className="text-sm">加载中...</span>
                    </div>
                )}

                {/* 找不到 currentReview 但 reviewSessions 已加载 */}
                {!currentReview && reviewSessions !== undefined && (
                    <div className="text-sm text-center text-[var(--app-hint)]">
                        未找到 Review 会话信息
                    </div>
                )}
            </div>
        </div>
    )
}
