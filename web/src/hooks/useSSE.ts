import { useEffect, useMemo, useRef } from 'react'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import type { MessagesResponse, Session, SessionResponse, SessionsResponse, SessionSummary, SyncEvent } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { upsertMessagesInCache } from '@/lib/messages'

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object'
}

type SSESubscription = {
    all?: boolean
    sessionId?: string
    machineId?: string
}

function buildEventsUrl(baseUrl: string, token: string, subscription: SSESubscription): string {
    const params = new URLSearchParams()
    params.set('token', token)
    if (subscription.all) {
        params.set('all', 'true')
    }
    if (subscription.sessionId) {
        params.set('sessionId', subscription.sessionId)
    }
    if (subscription.machineId) {
        params.set('machineId', subscription.machineId)
    }

    const path = `/api/events?${params.toString()}`
    try {
        return new URL(path, baseUrl).toString()
    } catch {
        return path
    }
}

export function useSSE(options: {
    enabled: boolean
    token: string
    baseUrl: string
    subscription?: SSESubscription
    onEvent: (event: SyncEvent) => void
    onConnect?: () => void
    onDisconnect?: (reason: string) => void
    onError?: (error: unknown) => void
}): void {
    const queryClient = useQueryClient()
    const onEventRef = useRef(options.onEvent)
    const onConnectRef = useRef(options.onConnect)
    const onDisconnectRef = useRef(options.onDisconnect)
    const onErrorRef = useRef(options.onError)
    const eventSourceRef = useRef<EventSource | null>(null)

    useEffect(() => {
        onEventRef.current = options.onEvent
    }, [options.onEvent])

    useEffect(() => {
        onErrorRef.current = options.onError
    }, [options.onError])

    useEffect(() => {
        onConnectRef.current = options.onConnect
    }, [options.onConnect])

    useEffect(() => {
        onDisconnectRef.current = options.onDisconnect
    }, [options.onDisconnect])

    const subscription = options.subscription ?? {}
    const subscriptionKey = useMemo(() => {
        return `${subscription.all ? '1' : '0'}|${subscription.sessionId ?? ''}|${subscription.machineId ?? ''}`
    }, [subscription.all, subscription.sessionId, subscription.machineId])

    useEffect(() => {
        if (!options.enabled) {
            eventSourceRef.current?.close()
            eventSourceRef.current = null
            return
        }

        const url = buildEventsUrl(options.baseUrl, options.token, subscription)
        const eventSource = new EventSource(url)
        eventSourceRef.current = eventSource

        const handleSyncEvent = (event: SyncEvent) => {
            if (import.meta.env.DEV) {
                const sessionId = 'sessionId' in event ? event.sessionId : undefined
                console.log('[sse] event', event.type, sessionId)
            }
            if (event.type === 'message-received') {
                queryClient.setQueryData<InfiniteData<MessagesResponse>>(
                    queryKeys.messages(event.sessionId),
                    (data) => upsertMessagesInCache(data, [event.message])
                )
                // Mark stale so the initial query still fetches history when it mounts.
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.messages(event.sessionId),
                    refetchType: 'none'
                })
            }

            if (event.type === 'session-added' || event.type === 'session-updated' || event.type === 'session-removed') {
                if ('sessionId' in event) {
                    if (event.type === 'session-removed') {
                        if (import.meta.env.DEV) {
                            console.log('[sse] remove session queries', event.sessionId)
                        }
                        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
                        void queryClient.removeQueries({ queryKey: queryKeys.session(event.sessionId) })
                        void queryClient.removeQueries({ queryKey: queryKeys.messages(event.sessionId) })
                    } else if (event.type === 'session-added') {
                        // New session added - invalidate to fetch fresh data
                        if (import.meta.env.DEV) {
                            console.log('[sse] invalidate sessions (new session)', event.sessionId)
                        }
                        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
                        void queryClient.invalidateQueries({ queryKey: queryKeys.session(event.sessionId) })
                    } else if (event.type === 'session-updated') {
                        // Session updated - update cache directly instead of invalidating
                        // Only for heartbeat events that contain active/thinking status
                        const data = ('data' in event ? event.data : null) as {
                            active?: boolean
                            activeAt?: number
                            thinking?: boolean
                            wasThinking?: boolean
                            permissionMode?: string
                            modelMode?: string
                            modelReasoningEffort?: string
                        } | null

                        // Check if this is a heartbeat-style event with status fields we can update directly
                        // If it only has 'sid' or other non-status fields, we should invalidate instead
                        const hasStatusFields = data && (
                            data.active !== undefined ||
                            data.thinking !== undefined ||
                            data.permissionMode !== undefined ||
                            data.modelMode !== undefined ||
                            data.modelReasoningEffort !== undefined
                        )

                        if (hasStatusFields) {
                            if (import.meta.env.DEV) {
                                console.log('[sse] update session cache directly', event.sessionId, data)
                            }
                            // Update individual session cache
                            queryClient.setQueryData<SessionResponse>(
                                queryKeys.session(event.sessionId),
                                (prev) => {
                                    if (!prev?.session) return prev
                                    return {
                                        ...prev,
                                        session: {
                                            ...prev.session,
                                            ...(data.active !== undefined && { active: data.active }),
                                            ...(data.thinking !== undefined && { thinking: data.thinking }),
                                            ...(data.permissionMode !== undefined && { permissionMode: data.permissionMode as Session['permissionMode'] }),
                                            ...(data.modelMode !== undefined && { modelMode: data.modelMode as Session['modelMode'] }),
                                            ...(data.modelReasoningEffort !== undefined && { modelReasoningEffort: data.modelReasoningEffort as Session['modelReasoningEffort'] }),
                                        }
                                    }
                                }
                            )
                            // Update sessions list cache (only fields that exist in SessionSummary)
                            queryClient.setQueryData<SessionsResponse>(
                                queryKeys.sessions,
                                (prev) => {
                                    if (!prev?.sessions) return prev
                                    return {
                                        ...prev,
                                        sessions: prev.sessions.map((s) =>
                                            s.id === event.sessionId
                                                ? {
                                                    ...s,
                                                    ...(data.active !== undefined && { active: data.active }),
                                                    ...(data.activeAt !== undefined && { activeAt: data.activeAt }),
                                                    ...(data.modelMode !== undefined && { modelMode: data.modelMode as SessionSummary['modelMode'] }),
                                                    ...(data.modelReasoningEffort !== undefined && { modelReasoningEffort: data.modelReasoningEffort as SessionSummary['modelReasoningEffort'] }),
                                                }
                                                : s
                                        )
                                    }
                                }
                            )
                        } else {
                            // No status fields in event (e.g., todos/metadata update), fallback to invalidation
                            if (import.meta.env.DEV) {
                                console.log('[sse] invalidate session (no status fields)', event.sessionId, data)
                            }
                            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
                            void queryClient.invalidateQueries({ queryKey: queryKeys.session(event.sessionId) })
                        }
                    }
                } else {
                    // No sessionId in event, invalidate all
                    if (import.meta.env.DEV) {
                        console.log('[sse] invalidate sessions (no sessionId)')
                    }
                    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
                }
            }

            if (event.type === 'machine-updated') {
                void queryClient.invalidateQueries({ queryKey: queryKeys.machines })
            }

            // 处理 typing-changed 事件，更新其他用户输入状态
            if (event.type === 'typing-changed' && 'sessionId' in event && 'typing' in event && event.sessionId && event.typing) {
                queryClient.setQueryData(
                    queryKeys.typing(event.sessionId),
                    { typing: event.typing, updatedAt: Date.now() }
                )
            }

            onEventRef.current(event)
        }

        const handleMessage = (message: MessageEvent<string>) => {
            if (typeof message.data !== 'string') {
                return
            }

            let parsed: unknown
            try {
                parsed = JSON.parse(message.data)
            } catch {
                return
            }

            if (!isObject(parsed)) {
                return
            }
            if (typeof parsed.type !== 'string') {
                return
            }

            handleSyncEvent(parsed as SyncEvent)
        }

        eventSource.onmessage = handleMessage
        eventSource.onopen = () => {
            onConnectRef.current?.()
        }
        eventSource.onerror = (error) => {
            onErrorRef.current?.(error)
            const reason = eventSource.readyState === EventSource.CLOSED ? 'closed' : 'error'
            onDisconnectRef.current?.(reason)
        }

        return () => {
            eventSource.close()
            if (eventSourceRef.current === eventSource) {
                eventSourceRef.current = null
            }
        }
    }, [options.baseUrl, options.enabled, options.token, subscriptionKey, queryClient])
}
