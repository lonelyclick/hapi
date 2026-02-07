import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import type { ApiClient } from '@/api/client'

type ProgressEntry = {
    id: string
    type: string
    content: string
    timestamp: number
}

type ProgressData = {
    entries: ProgressEntry[]
    isActive: boolean
}

function useForceUpdate(): [number, () => void] {
    const [tick, setTick] = useState(0)
    return [tick, () => setTick(t => t + 1)]
}

export function BrainSdkProgressPanel({ mainSessionId, api }: { mainSessionId: string; api: ApiClient }) {
    const queryClient = useQueryClient()
    const data = queryClient.getQueryData<ProgressData>(queryKeys.brainSdkProgress(mainSessionId))
    const scrollRef = useRef<HTMLDivElement>(null)
    const loadedRef = useRef(false)

    // 挂载时加载历史进度日志
    useEffect(() => {
        if (loadedRef.current) return
        loadedRef.current = true

        const cached = queryClient.getQueryData<ProgressData>(queryKeys.brainSdkProgress(mainSessionId))
        if (cached?.entries?.length) return

        api.getActiveBrainSession(mainSessionId).then(brainSession => {
            if (!brainSession) return
            return api.getBrainProgressLog(brainSession.id)
        }).then(result => {
            if (!result?.entries?.length) return
            // 过滤掉 done 类型的条目（它只是标记，不需要显示）
            const displayEntries = result.entries.filter(e => e.type !== 'done')
            if (!displayEntries.length) return
            queryClient.setQueryData(queryKeys.brainSdkProgress(mainSessionId), {
                entries: displayEntries,
                isActive: result.isActive
            })
        }).catch(() => {})
    }, [mainSessionId, api, queryClient])

    // 监听 cache 变化来触发重渲染
    const [, forceUpdate] = useForceUpdate()
    useEffect(() => {
        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
            if (event.type === 'updated' && event.query.queryKey[0] === 'brain-sdk-progress' && event.query.queryKey[1] === mainSessionId) {
                forceUpdate()
            }
        })
        return unsubscribe
    }, [queryClient, mainSessionId, forceUpdate])

    // 定时轮询 progress-log API（worker 写 DB，前端轮询读取）
    useEffect(() => {
        if (!data?.isActive) return

        const poll = async () => {
            try {
                const brainSession = await api.getActiveBrainSession(mainSessionId)
                if (!brainSession) return
                const result = await api.getBrainProgressLog(brainSession.id)
                if (!result) return
                const displayEntries = (result.entries || []).filter((e: ProgressEntry) => e.type !== 'done')
                queryClient.setQueryData(queryKeys.brainSdkProgress(mainSessionId), {
                    entries: displayEntries,
                    isActive: result.isActive
                })
            } catch { /* ignore */ }
        }

        const interval = setInterval(poll, 3000)
        return () => clearInterval(interval)
    }, [data?.isActive, mainSessionId, api, queryClient])

    // 自动滚动到底部
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [data?.entries?.length])

    if (!data?.entries?.length && !data?.isActive) {
        return null
    }

    return (
        <div className="mx-auto w-full max-w-content px-3 pb-2">
            <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-indigo-500/10">
                    <span className="text-xs font-medium text-indigo-400">
                        Brain SDK Review
                    </span>
                    {data?.isActive && (
                        <span className="flex items-center gap-1 text-xs text-indigo-400/70">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
                            analyzing...
                        </span>
                    )}
                </div>
                <div ref={scrollRef} className="max-h-48 overflow-y-auto px-3 py-2 space-y-1">
                    {data?.entries?.map(entry => (
                        <div key={entry.id} className="text-xs leading-relaxed">
                            {entry.type === 'tool-use' ? (
                                <span className="text-amber-400/80 font-mono">
                                    <span className="text-amber-500/60">{'>'} </span>
                                    {entry.content}
                                </span>
                            ) : (
                                <span className="text-[var(--app-fg)] opacity-80 whitespace-pre-wrap">
                                    {entry.content.length > 500
                                        ? entry.content.slice(0, 500) + '...'
                                        : entry.content}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
