import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import type { ApiClient } from '@/api/client'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Spinner } from '@/components/Spinner'
import { EyeIcon, SearchIcon } from '@/components/ToolCard/icons'

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

const ICON_CLASS = 'h-3.5 w-3.5'

/** 根据 tool-use content 解析出 tool name 和参数 */
function parseToolUse(content: string): { toolName: string; args: string } {
    const spaceIdx = content.indexOf(' ')
    if (spaceIdx === -1) return { toolName: content, args: '' }
    return { toolName: content.slice(0, spaceIdx), args: content.slice(spaceIdx + 1) }
}

function ToolIcon({ toolName }: { toolName: string }) {
    if (toolName === 'Read') return <EyeIcon className={ICON_CLASS} />
    if (toolName === 'Grep') return <EyeIcon className={ICON_CLASS} />
    if (toolName === 'Glob') return <SearchIcon className={ICON_CLASS} />
    return <SearchIcon className={ICON_CLASS} />
}

function ToolUseEntry({ content }: { content: string }) {
    const { toolName, args } = parseToolUse(content)
    return (
        <div className="flex items-start gap-2 py-0.5">
            <span className="shrink-0 mt-0.5 text-[var(--app-hint)]">
                <ToolIcon toolName={toolName} />
            </span>
            <span className="min-w-0 font-mono text-xs text-[var(--app-hint)] break-all">
                <span className="font-medium text-[var(--app-fg)]">{toolName}</span>
                {args && <span className="ml-1.5 opacity-70">{args}</span>}
            </span>
        </div>
    )
}

function AssistantEntry({ content }: { content: string }) {
    return (
        <div className="py-1 text-sm leading-relaxed whitespace-pre-wrap break-words">
            {content}
        </div>
    )
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
            <Card>
                <CardHeader className="px-3 py-2 space-y-0">
                    <div className="flex items-center gap-2">
                        {data?.isActive ? (
                            <Spinner size="sm" label="Brain analyzing" />
                        ) : (
                            <span className="text-[var(--app-hint)]">
                                <SearchIcon className={ICON_CLASS} />
                            </span>
                        )}
                        <span className="text-xs font-medium">
                            Brain SDK Review
                        </span>
                        {data?.isActive && (
                            <span className="text-xs text-[var(--app-hint)]">
                                analyzing...
                            </span>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="px-3 pb-3 pt-0">
                    <div ref={scrollRef} className="max-h-64 overflow-y-auto space-y-0.5">
                        {data?.entries?.map(entry => (
                            entry.type === 'tool-use' ? (
                                <ToolUseEntry key={entry.id} content={entry.content} />
                            ) : (
                                <AssistantEntry key={entry.id} content={entry.content} />
                            )
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
