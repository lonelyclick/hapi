import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AgentGroupMessage, GroupSenderType, GroupMessageType } from '@/types/api'

type GroupMessageEvent = {
    type: 'group-message'
    groupId: string
    groupMessage: {
        id: string
        groupId: string
        sourceSessionId: string | null
        senderType: GroupSenderType
        content: string
        messageType: GroupMessageType
        createdAt: number
        senderName?: string
        agentType?: string
    }
}

function isGroupMessageEvent(data: unknown): data is GroupMessageEvent {
    return (
        typeof data === 'object' &&
        data !== null &&
        'type' in data &&
        (data as { type: unknown }).type === 'group-message'
    )
}

export function useGroupSSE(options: {
    enabled: boolean
    groupId: string
    token: string
    baseUrl: string
    onMessage?: (message: AgentGroupMessage) => void
}): void {
    const queryClient = useQueryClient()
    const eventSourceRef = useRef<EventSource | null>(null)
    const onMessageRef = useRef(options.onMessage)

    useEffect(() => {
        onMessageRef.current = options.onMessage
    }, [options.onMessage])

    const handleGroupMessage = useCallback((event: GroupMessageEvent) => {
        const message: AgentGroupMessage = {
            id: event.groupMessage.id,
            groupId: event.groupMessage.groupId,
            sourceSessionId: event.groupMessage.sourceSessionId,
            senderType: event.groupMessage.senderType,
            content: event.groupMessage.content,
            messageType: event.groupMessage.messageType,
            createdAt: event.groupMessage.createdAt,
            senderName: event.groupMessage.senderName
        }

        // 更新消息缓存
        queryClient.setQueryData<{ messages: AgentGroupMessage[] }>(
            ['group-messages', options.groupId],
            (old) => {
                if (!old) return { messages: [message] }
                // 检查是否已存在
                if (old.messages.some(m => m.id === message.id)) {
                    return old
                }
                return { messages: [...old.messages, message] }
            }
        )

        // 同时更新群组列表中的最后消息
        queryClient.invalidateQueries({
            queryKey: ['groups'],
            refetchType: 'none'
        })

        onMessageRef.current?.(message)
    }, [queryClient, options.groupId])

    useEffect(() => {
        if (!options.enabled || !options.groupId) {
            eventSourceRef.current?.close()
            eventSourceRef.current = null
            return
        }

        const url = new URL(`/api/groups/${options.groupId}/events`, options.baseUrl)
        url.searchParams.set('token', options.token)

        const eventSource = new EventSource(url.toString())
        eventSourceRef.current = eventSource

        eventSource.onmessage = (event) => {
            if (typeof event.data !== 'string') return
            try {
                const parsed = JSON.parse(event.data)
                if (isGroupMessageEvent(parsed)) {
                    handleGroupMessage(parsed)
                }
            } catch {
                // ignore
            }
        }

        eventSource.onerror = () => {
            // SSE 断开时会自动重连
            console.log('[useGroupSSE] connection error, will reconnect')
        }

        return () => {
            eventSource.close()
            if (eventSourceRef.current === eventSource) {
                eventSourceRef.current = null
            }
        }
    }, [options.enabled, options.groupId, options.token, options.baseUrl, handleGroupMessage])
}
