import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { Spinner } from '@/components/Spinner'
import type { ApiClient } from '@/api/client'
import type { BrainSession } from '@/types/api'

interface BrainRefineState {
    isRefining: boolean
    noMessage: boolean
    brainInitializing?: boolean
}

/**
 * 主 session 侧的 Brain 状态指示器。
 * - brainInitializing：Brain 正在初始化，显示 loading
 * - refine 进行中：显示 loading + 进度步骤
 * - review 完成且 noMessage：持久显示 "Brain: 没有问题"（从 DB 恢复）
 */
export function BrainRefineIndicator({ sessionId, api, onBrainBusy }: { sessionId: string; api?: ApiClient | null; onBrainBusy?: (busy: boolean) => void }) {
    const queryClient = useQueryClient()
    const [state, setState] = useState<BrainRefineState>({ isRefining: false, noMessage: false })

    // 从 brainSession 数据恢复持久化状态（isRefining + brainInitializing）
    // noMessage 不恢复：它会自动消失，刷新后无需再显示
    useEffect(() => {
        const brainData = queryClient.getQueryData<BrainSession | null>(['brain-active-session', sessionId])
        if (brainData?.isRefining) {
            setState(prev => prev.isRefining ? prev : { ...prev, isRefining: true })
        }
        // 刷新后恢复：brain session 存在但 status 为 pending，说明还在初始化
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
            // 当 brain-active-session 查询完成时恢复持久化状态
            if (event.type === 'updated' && event.query.queryKey[0] === 'brain-active-session' && event.query.queryKey[1] === sessionId) {
                const brainData = queryClient.getQueryData<BrainSession | null>(['brain-active-session', sessionId])
                if (brainData?.isRefining) {
                    setState(prev => prev.isRefining ? prev : { ...prev, isRefining: true })
                }
                // brain session 存在但 status 为 pending → 还在初始化；否则清除初始化状态
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
            <BrainProgressSteps sessionId={sessionId} api={api} />
        )
    }

    // noMessage 的显示已移到 SessionChat 中作为 AgentEventBlock 插入消息流
    return null
}

type ProgressEntry = {
    id: string
    type: string
    content: string
    toolName?: string
    timestamp: number
}

/**
 * Brain 审查进度步骤指示器
 * 显示: 汇总对话 → 审查代码 → 处理结果
 * 审查阶段可展开查看实际 review 进度
 */
function BrainProgressSteps({ sessionId, api }: { sessionId: string; api?: ApiClient | null }) {
    const queryClient = useQueryClient()
    const [step, setStep] = useState<'summarizing' | 'reviewing' | 'refining'>('summarizing')
    const [expanded, setExpanded] = useState(false)
    const [progressEntries, setProgressEntries] = useState<ProgressEntry[]>([])
    const [brainSessionId, setBrainSessionId] = useState<string | null>(null)

    useEffect(() => {
        const key = queryKeys.brainSdkProgress(sessionId)
        const data = queryClient.getQueryData<{ entries: unknown[]; isActive: boolean }>(key)
        if (data?.isActive) {
            setStep('reviewing')
        }

        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
            if (event.type === 'updated' && event.query.queryKey[0] === 'brain-sdk-progress' && event.query.queryKey[1] === sessionId) {
                const updated = queryClient.getQueryData<{ entries: unknown[]; isActive: boolean }>(key)
                if (updated?.isActive) {
                    setStep('reviewing')
                }
            }
            // refine-started 触发
            if (event.type === 'updated' && event.query.queryKey[0] === 'brain-refine' && event.query.queryKey[1] === sessionId) {
                const refineData = queryClient.getQueryData<BrainRefineState>(queryKeys.brainRefine(sessionId))
                if (refineData?.isRefining) {
                    setStep('refining')
                }
            }
        })
        return unsubscribe
    }, [queryClient, sessionId])

    // 获取 brain session ID 用于轮询进度
    useEffect(() => {
        if (!api) return
        api.getActiveBrainSession(sessionId).then(bs => {
            if (bs?.id) setBrainSessionId(bs.id)
        }).catch(() => {})
    }, [api, sessionId])

    // 轮询 review/refine 进度日志
    useEffect(() => {
        if ((step !== 'reviewing' && step !== 'refining') || !api || !brainSessionId) return

        let cancelled = false
        const poll = async () => {
            try {
                const result = await api.getBrainProgressLog(brainSessionId)
                if (!cancelled && result?.entries) {
                    setProgressEntries(result.entries as ProgressEntry[])
                }
            } catch {
                // ignore polling errors
            }
        }

        poll()
        const interval = setInterval(poll, 3000)
        return () => {
            cancelled = true
            clearInterval(interval)
        }
    }, [step, api, brainSessionId])

    const steps = [
        { key: 'summarizing', label: '汇总对话' },
        { key: 'reviewing', label: '审查代码' },
        { key: 'refining', label: '处理结果' },
    ] as const

    const currentIndex = steps.findIndex(s => s.key === step)

    // 过滤出有意义的进度条目
    const displayEntries = progressEntries.filter(
        e => e.type === 'tool-use' || e.type === 'assistant-message'
    )

    return (
        <div className="flex flex-col items-center py-4 gap-2.5">
            <div className="inline-flex items-center gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-4 py-2 shadow-sm">
                {/* Dot stepper */}
                <div className="flex items-center gap-0">
                    {steps.map((s, i) => (
                        <div key={s.key} className="flex items-center">
                            {/* Step dot */}
                            <div className="flex flex-col items-center gap-1">
                                <div className="flex items-center gap-1.5">
                                    {i < currentIndex ? (
                                        <div className="h-2 w-2 rounded-full bg-emerald-500/70" />
                                    ) : i === currentIndex ? (
                                        <div className="relative h-2 w-2">
                                            <div className="absolute inset-0 rounded-full bg-violet-400 animate-pulse" />
                                            <div className="absolute inset-0 rounded-full bg-violet-400" />
                                        </div>
                                    ) : (
                                        <div className="h-1.5 w-1.5 rounded-full bg-[var(--app-hint)] opacity-25" />
                                    )}
                                    <span className={`text-[11px] tracking-wide transition-colors ${
                                        i < currentIndex ? 'text-emerald-600/70 ' :
                                        i === currentIndex ? 'text-[var(--app-fg)] opacity-80' :
                                        'text-[var(--app-hint)] opacity-50'
                                    }`}>
                                        {s.label}
                                    </span>
                                </div>
                            </div>
                            {/* Connector line */}
                            {i < steps.length - 1 && (
                                <div className={`w-4 h-px mx-1.5 ${
                                    i < currentIndex ? 'bg-emerald-500/30' : 'bg-[var(--app-hint)] opacity-15'
                                }`} />
                            )}
                        </div>
                    ))}
                </div>
                {(step === 'reviewing' || step === 'refining') && displayEntries.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setExpanded(!expanded)}
                        className="text-[10px] text-[var(--app-hint)] opacity-60 hover:opacity-100 transition-opacity ml-0.5"
                    >
                        {expanded ? '收起' : `${displayEntries.length} 步`}
                    </button>
                )}
            </div>
            {expanded && displayEntries.length > 0 && (
                <div className="w-full max-w-sm space-y-0.5 px-6">
                    {displayEntries.map((entry) => (
                        <div key={entry.id} className="flex items-center gap-2 justify-center py-0.5">
                            <div className={`h-1 w-1 rounded-full shrink-0 ${
                                entry.type === 'tool-use' ? 'bg-violet-400/60' : 'bg-emerald-400/60'
                            }`} />
                            <span className="text-[10px] text-[var(--app-hint)] opacity-60 truncate">
                                {entry.type === 'tool-use'
                                    ? (entry.toolName || entry.content)
                                    : `${entry.content.slice(0, 60)}${entry.content.length > 60 ? '...' : ''}`
                                }
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
