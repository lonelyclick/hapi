import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { Spinner } from '@/components/Spinner'

/**
 * 主 session 侧的 Brain refine loading 指示器。
 * 当用户从 webapp 发消息被 Brain 拦截时显示，refine 完成后自动消失。
 */
export function BrainRefineIndicator({ sessionId }: { sessionId: string }) {
    const queryClient = useQueryClient()
    const [isRefining, setIsRefining] = useState(false)

    useEffect(() => {
        // 读取初始状态
        const data = queryClient.getQueryData<{ isRefining: boolean }>(queryKeys.brainRefine(sessionId))
        setIsRefining(data?.isRefining ?? false)

        // 监听 cache 变化
        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
            if (event.type === 'updated' && event.query.queryKey[0] === 'brain-refine' && event.query.queryKey[1] === sessionId) {
                const updated = queryClient.getQueryData<{ isRefining: boolean }>(queryKeys.brainRefine(sessionId))
                setIsRefining(updated?.isRefining ?? false)
            }
        })
        return unsubscribe
    }, [queryClient, sessionId])

    if (!isRefining) return null

    return (
        <div className="flex items-center gap-2 py-2 px-1">
            <Spinner size="sm" label="Brain processing" />
            <span className="text-xs text-[var(--app-hint)]">Brain is processing your message...</span>
        </div>
    )
}
