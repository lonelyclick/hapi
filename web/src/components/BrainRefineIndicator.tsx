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

    // 从 brainSession 数据恢复持久化状态（noMessage + isRefining + brainInitializing）
    useEffect(() => {
        const brainData = queryClient.getQueryData<BrainSession | null>(['brain-active-session', sessionId])
        if (brainData?.status === 'completed' && brainData.brainResult?.includes('[NO_MESSAGE]')) {
            setState(prev => prev.noMessage ? prev : { ...prev, noMessage: true })
        }
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
                if (brainData?.status === 'completed' && brainData.brainResult?.includes('[NO_MESSAGE]')) {
                    setState(prev => prev.noMessage ? prev : { ...prev, noMessage: true })
                }
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
            <div className="flex justify-center py-3">
                <div className="inline-flex items-center gap-2 rounded-full bg-[var(--app-bg-secondary,rgba(128,128,128,0.08))] px-4 py-1.5">
                    <Spinner size="sm" label="Brain initializing" />
                    <span className="text-xs text-[var(--app-fg)] opacity-70">Brain 初始化中</span>
                </div>
            </div>
        )
    }

    if (state.isRefining) {
        return (
            <BrainProgressSteps sessionId={sessionId} api={api} />
        )
    }

    if (state.noMessage) {
        return (
            <div className="flex justify-center py-3">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/8 px-4 py-1.5">
                    <svg className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm3.78-9.72a.75.75 0 0 0-1.06-1.06L7 8.94 5.28 7.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.06 0l4.25-4.25z" />
                    </svg>
                    <span className="text-xs text-emerald-600 font-medium">Brain 审查通过</span>
                </div>
            </div>
        )
    }

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
        <div className="flex flex-col items-center py-3 gap-2">
            <div className="inline-flex items-center gap-2.5 rounded-full bg-[var(--app-bg-secondary,rgba(128,128,128,0.08))] pl-3 pr-4 py-1.5">
                <Spinner size="sm" label="Brain processing" className="text-indigo-500" />
                <div className="flex items-center gap-1">
                    {steps.map((s, i) => (
                        <span key={s.key} className="flex items-center gap-1">
                            <span className={`text-xs transition-colors ${
                                i < currentIndex ? 'text-emerald-600' :
                                i === currentIndex ? 'text-[var(--app-fg)] font-medium' :
                                'text-[var(--app-hint)]'
                            }`}>
                                {i < currentIndex && (
                                    <svg className="inline h-3 w-3 mr-0.5 -mt-px" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                                    </svg>
                                )}
                                {s.label}
                            </span>
                            {i < steps.length - 1 && (
                                <svg className="h-3 w-3 text-[var(--app-hint)] opacity-40" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z" />
                                </svg>
                            )}
                        </span>
                    ))}
                </div>
                {(step === 'reviewing' || step === 'refining') && displayEntries.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setExpanded(!expanded)}
                        className="text-[10px] text-[var(--app-hint)] hover:text-[var(--app-fg)] transition-colors ml-1"
                    >
                        {expanded ? '收起' : `${displayEntries.length} 步`}
                    </button>
                )}
            </div>
            {expanded && displayEntries.length > 0 && (
                <div className="w-full max-w-md space-y-1 px-4">
                    {displayEntries.map((entry) => (
                        <div key={entry.id} className="text-[11px] text-[var(--app-hint)] flex items-center gap-1.5 justify-center">
                            {entry.type === 'tool-use' ? (
                                <>
                                    <svg className="shrink-0 h-3 w-3 text-indigo-500" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z" />
                                    </svg>
                                    <span className="truncate">{entry.toolName || entry.content}</span>
                                </>
                            ) : (
                                <>
                                    <svg className="shrink-0 h-3 w-3 text-emerald-500" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25v-7.5z" />
                                    </svg>
                                    <span className="truncate">{entry.content.slice(0, 80)}{entry.content.length > 80 ? '...' : ''}</span>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
