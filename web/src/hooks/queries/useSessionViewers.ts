import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { OnlineUsersResponse, SessionViewer } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useSessionViewers(sessionId: string | null): SessionViewer[] {
    const { data } = useQuery<OnlineUsersResponse>({
        queryKey: queryKeys.onlineUsers,
        enabled: false, // Data is set by SSE events, not fetched
        staleTime: Infinity,
    })

    return useMemo(() => {
        if (!sessionId || !data?.users) {
            return []
        }
        return data.users
            .filter(user => user.sessionId === sessionId)
            .map(user => ({
                email: user.email,
                clientId: user.clientId,
                deviceType: user.deviceType
            }))
    }, [sessionId, data?.users])
}
