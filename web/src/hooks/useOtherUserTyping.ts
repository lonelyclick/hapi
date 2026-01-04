import { useEffect, useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { TypingUser } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

const TYPING_TIMEOUT_MS = 5000 // 5秒后清除输入状态

type TypingData = {
    typing: TypingUser
    updatedAt: number
}

/**
 * Hook 用于获取其他用户的输入状态
 * 通过 React Query 订阅 SSE 事件更新的数据
 */
export function useOtherUserTyping(sessionId: string | null): TypingUser | null {
    const queryClient = useQueryClient()
    const [typingUser, setTypingUser] = useState<TypingUser | null>(null)
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (!sessionId) {
            setTypingUser(null)
            return
        }

        // 订阅 query 缓存变化
        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
            if (event.type !== 'updated') return

            const queryKey = event.query.queryKey
            if (!Array.isArray(queryKey)) return
            if (queryKey[0] !== 'typing' || queryKey[1] !== sessionId) return

            const data = event.query.state.data as TypingData | null | undefined
            if (!data?.typing) {
                setTypingUser(null)
                return
            }

            // 检查是否过期
            if (Date.now() - data.updatedAt > TYPING_TIMEOUT_MS) {
                setTypingUser(null)
                return
            }

            setTypingUser(data.typing)

            // 设置超时清除
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current)
            }
            timeoutRef.current = setTimeout(() => {
                setTypingUser(null)
            }, TYPING_TIMEOUT_MS)
        })

        return () => {
            unsubscribe()
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current)
            }
        }
    }, [sessionId, queryClient])

    // 切换 session 时清除状态
    useEffect(() => {
        setTypingUser(null)
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
        }
    }, [sessionId])

    return typingUser
}
