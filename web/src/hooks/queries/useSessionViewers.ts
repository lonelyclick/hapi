import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { SessionViewer } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useSessionViewers(api: ApiClient | null, sessionId: string | null): SessionViewer[] {
    // Query online users - uses same key as useOnlineUsers so data is shared
    const { data } = useQuery({
        queryKey: queryKeys.onlineUsers,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getOnlineUsers()
        },
        enabled: Boolean(api),
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
