import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { OnlineUser } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useOnlineUsers(api: ApiClient | null): {
    users: OnlineUser[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: queryKeys.onlineUsers,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getOnlineUsers()
        },
        enabled: Boolean(api),
    })

    return {
        users: query.data?.users ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load online users' : null,
        refetch: query.refetch,
    }
}
