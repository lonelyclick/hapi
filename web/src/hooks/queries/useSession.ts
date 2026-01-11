import { useQuery } from '@tanstack/react-query'
import { ApiError, type ApiClient } from '@/api/client'
import type { Session } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useSession(api: ApiClient | null, sessionId: string | null): {
    session: Session | null
    isLoading: boolean
    error: string | null
    notFound: boolean
    refetch: () => Promise<unknown>
} {
    const resolvedSessionId = sessionId ?? 'unknown'
    const query = useQuery({
        queryKey: queryKeys.session(resolvedSessionId),
        queryFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            return await api.getSession(sessionId)
        },
        retry: (failureCount, error) => {
            if (error instanceof ApiError && error.status === 404) {
                return false
            }
            return failureCount < 2
        },
        enabled: Boolean(api && sessionId),
        // Prevent showing stale data from a different session when switching
        placeholderData: undefined,
        staleTime: 0,
    })

    const notFound = query.error instanceof ApiError && query.error.status === 404

    return {
        session: query.data?.session ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load session' : null,
        notFound,
        refetch: query.refetch,
    }
}
