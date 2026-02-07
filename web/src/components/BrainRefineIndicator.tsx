import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { Spinner } from '@/components/Spinner'

interface BrainRefineState {
    isRefining: boolean
    noMessage: boolean
}

/**
 * 主 session 侧的 Brain 状态指示器。
 * - refine 进行中：显示 loading
 * - review 完成且 noMessage：显示 "Brain: 没有问题"，3秒后消失
 */
export function BrainRefineIndicator({ sessionId }: { sessionId: string }) {
    const queryClient = useQueryClient()
    const [state, setState] = useState<BrainRefineState>({ isRefining: false, noMessage: false })
    const [showNoMessage, setShowNoMessage] = useState(false)

    useEffect(() => {
        const data = queryClient.getQueryData<BrainRefineState>(queryKeys.brainRefine(sessionId))
        if (data) setState(data)

        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
            if (event.type === 'updated' && event.query.queryKey[0] === 'brain-refine' && event.query.queryKey[1] === sessionId) {
                const updated = queryClient.getQueryData<BrainRefineState>(queryKeys.brainRefine(sessionId))
                if (updated) setState(updated)
            }
        })
        return unsubscribe
    }, [queryClient, sessionId])

    // noMessage 变为 true 时显示提示，3秒后自动消失
    useEffect(() => {
        if (state.noMessage) {
            setShowNoMessage(true)
            const timer = setTimeout(() => setShowNoMessage(false), 3000)
            return () => clearTimeout(timer)
        } else {
            setShowNoMessage(false)
        }
    }, [state.noMessage])

    if (state.isRefining) {
        return (
            <div className="flex items-center gap-2 py-2 px-1">
                <Spinner size="sm" label="Brain processing" />
                <span className="text-xs text-[var(--app-hint)]">Brain is processing your message...</span>
            </div>
        )
    }

    if (showNoMessage) {
        return (
            <div className="flex items-center gap-2 py-2 px-1">
                <span className="text-xs text-[var(--app-hint)]">🧠 Brain: 没有问题</span>
            </div>
        )
    }

    return null
}
