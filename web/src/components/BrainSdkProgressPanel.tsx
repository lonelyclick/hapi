import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { queryKeys } from '@/lib/query-keys'
import type { ApiClient } from '@/api/client'
import { Card, CardHeader, CardDescription, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { CodeBlock } from '@/components/CodeBlock'
import { Spinner } from '@/components/Spinner'
import { getToolPresentation } from '@/components/ToolCard/knownTools'

type ProgressEntry = {
    id: string
    type: string
    content: string
    toolName?: string
    toolInput?: Record<string, unknown>
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

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

function ToolUseEntry({ entry }: { entry: ProgressEntry }) {
    const toolName = entry.toolName || (() => {
        const idx = entry.content.indexOf(' ')
        return idx === -1 ? entry.content : entry.content.slice(0, idx)
    })()
    const input = entry.toolInput ?? {}
    const fallbackDesc = !entry.toolName ? (() => {
        const idx = entry.content.indexOf(' ')
        return idx === -1 ? null : entry.content.slice(idx + 1)
    })() : null

    const presentation = getToolPresentation({
        toolName,
        input,
        result: null,
        childrenCount: 0,
        description: fallbackDesc,
        metadata: null
    })

    const subtitle = presentation.subtitle ?? fallbackDesc

    return (
        <Card className="overflow-hidden shadow-sm">
            <CardHeader className="p-3 space-y-0">
                <Dialog>
                    <DialogTrigger asChild>
                        <button
                            type="button"
                            className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                        >
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0 flex items-center gap-2">
                                        <div className="shrink-0 flex h-3.5 w-3.5 items-center justify-center text-[var(--app-hint)] leading-none">
                                            {presentation.icon}
                                        </div>
                                        <CardTitle className="min-w-0 text-sm font-medium leading-tight break-words">
                                            {presentation.title}
                                        </CardTitle>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-emerald-600">
                                            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                                                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                                                <path d="M5.2 8.3l1.8 1.8 3.8-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </span>
                                        <span className="text-[var(--app-hint)]">
                                            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
                                                <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </span>
                                    </div>
                                </div>
                                {subtitle && (
                                    <CardDescription className="font-mono text-xs break-all opacity-80">
                                        {subtitle.length > 160
                                            ? subtitle.slice(0, 157) + '...'
                                            : subtitle}
                                    </CardDescription>
                                )}
                            </div>
                        </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>{presentation.title}</DialogTitle>
                        </DialogHeader>
                        <div className="mt-3 flex max-h-[75vh] flex-col gap-4 overflow-auto">
                            <div>
                                <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">Input</div>
                                <CodeBlock code={safeStringify(input)} language="json" />
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </CardHeader>
        </Card>
    )
}

function AssistantEntry({ content }: { content: string }) {
    return (
        <div className="px-1 min-w-0 max-w-full overflow-x-hidden">
            <Markdown
                remarkPlugins={[remarkGfm]}
                className="min-w-0 max-w-full break-words text-xs [&>*+*]:mt-1.5"
                components={{
                    pre: (props) => (
                        <div className="min-w-0 w-full max-w-full overflow-x-auto">
                            <pre {...props} className="m-0 w-max min-w-full rounded-md bg-[var(--app-code-bg)] p-2 text-xs" />
                        </div>
                    ),
                    code: (props) => {
                        const { className, children, ...rest } = props
                        const isBlock = className?.startsWith('language-')
                        if (isBlock) {
                            return <code {...rest} className={`font-mono ${className ?? ''}`}>{children}</code>
                        }
                        return <code {...rest} className="break-words rounded bg-[var(--app-inline-code-bg)] px-[0.3em] py-[0.1em] font-mono text-[0.9em]">{children}</code>
                    },
                    p: (props) => <p {...props} className="leading-relaxed" />,
                    ul: (props) => <ul {...props} className="list-disc pl-6" />,
                    ol: (props) => <ol {...props} className="list-decimal pl-6" />,
                    a: (props) => <a {...props} target="_blank" rel="noreferrer" className="text-[var(--app-link)] underline" />,
                    strong: (props) => <strong {...props} className="font-semibold" />,
                }}
            >
                {content}
            </Markdown>
        </div>
    )
}

export function BrainSdkProgressPanel({ mainSessionId, api }: { mainSessionId: string; api: ApiClient }) {
    const queryClient = useQueryClient()
    const data = queryClient.getQueryData<ProgressData>(queryKeys.brainSdkProgress(mainSessionId))
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

    if (!data?.entries?.length && !data?.isActive) {
        return null
    }

    return (
        <div className="flex flex-col gap-3 mt-3">
            {data?.entries?.map(entry => (
                entry.type === 'tool-use' ? (
                    <ToolUseEntry key={entry.id} entry={entry} />
                ) : (
                    <AssistantEntry key={entry.id} content={entry.content} />
                )
            ))}
            {data?.isActive && (
                <div className="flex items-center gap-2 py-1">
                    <Spinner size="sm" label="Brain analyzing" />
                    <span className="text-xs text-[var(--app-hint)]">Brain analyzing...</span>
                </div>
            )}
        </div>
    )
}
