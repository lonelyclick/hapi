import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { Spinner } from '@/components/Spinner'
import type { BrainSession } from '@/types/api'

interface BrainRefineState {
    isRefining: boolean
    noMessage: boolean
    brainInitializing?: boolean
}

/**
 * 主 session 侧的 Brain 状态指示器（trailing）。
 * - brainInitializing：Brain 正在初始化，显示 loading
 * - isRefining：Brain 正在处理（汇总/审查/refine），显示 loading
 * - noMessage 的显示已移到 SessionChat 中作为 AgentEventBlock 插入消息流
 */
export function BrainRefineIndicator({ sessionId, onBrainBusy }: { sessionId: string; api?: unknown; onBrainBusy?: (busy: boolean) => void }) {
    const queryClient = useQueryClient()
    const [state, setState] = useState<BrainRefineState>({ isRefining: false, noMessage: false })

    // 从 brainSession 数据恢复持久化状态（isRefining + brainInitializing）
    useEffect(() => {
        const brainData = queryClient.getQueryData<BrainSession | null>(['brain-active-session', sessionId])
        if (brainData?.isRefining) {
            setState(prev => prev.isRefining ? prev : { ...prev, isRefining: true })
        }
        if (brainData?.status === 'pending') {
            setState(prev => prev.brainInitializing ? prev : { ...prev, brainInitializing: true })
        }
    }, [queryClient, sessionId])

    useEffect(() => {
        const data = queryClient.getQueryData<BrainRefineState>(queryKeys.brainRefine(sessionId))
        if (data) setState(data)

        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
            if (event.type === 'updated' && event.query.queryKey[0] === 'brain-refine' && event.query.queryKey[1] === sessionId) {
                const updated = queryClient.getQueryData<BrainRefineState>(queryKeys.brainRefine(sessionId))
                if (updated) setState(updated)
            }
            if (event.type === 'updated' && event.query.queryKey[0] === 'brain-active-session' && event.query.queryKey[1] === sessionId) {
                const brainData = queryClient.getQueryData<BrainSession | null>(['brain-active-session', sessionId])
                if (brainData?.isRefining) {
                    setState(prev => prev.isRefining ? prev : { ...prev, isRefining: true })
                }
                if (brainData?.status === 'pending') {
                    setState(prev => prev.brainInitializing ? prev : { ...prev, brainInitializing: true })
                } else if (brainData) {
                    setState(prev => prev.brainInitializing ? { ...prev, brainInitializing: false } : prev)
                }
            }
        })
        return unsubscribe
    }, [queryClient, sessionId])

    // 通知父组件 brain 是否忙碌（initializing 或 refining），用于禁用输入
    useEffect(() => {
        onBrainBusy?.(state.brainInitializing === true || state.isRefining)
    }, [state.brainInitializing, state.isRefining, onBrainBusy])

    if (state.brainInitializing) {
        return (
            <div className="flex justify-center py-4">
                <div className="inline-flex items-center gap-2.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-4 py-2 shadow-sm">
                    <Spinner size="sm" label="Brain initializing" className="text-violet-400" />
                    <span className="text-[11px] tracking-wide text-[var(--app-hint)]">Brain 初始化中</span>
                </div>
            </div>
        )
    }

    if (state.isRefining) {
        return (
            <div className="flex justify-center py-4">
                <div className="inline-flex items-center gap-2.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-4 py-2 shadow-sm">
                    <Spinner size="sm" label="Brain processing" className="text-violet-400" />
                    <span className="text-[11px] tracking-wide text-[var(--app-hint)]">Brain 处理中</span>
                </div>
            </div>
        )
    }

    return null
}
