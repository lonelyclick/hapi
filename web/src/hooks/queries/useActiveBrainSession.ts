import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { BrainSession } from '@/types/api'

export function useActiveBrainSession(
    api: ApiClient | null,
    mainSessionId: string | null | undefined
): {
    brainSession: BrainSession | null
    isLoading: boolean
    error: string | null
} {
    const query = useQuery({
        queryKey: ['brain-active-session', mainSessionId],
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (!mainSessionId) {
                return null
            }
            return await api.getActiveBrainSession(mainSessionId)
        },
        enabled: Boolean(api && mainSessionId),
    })

    return {
        brainSession: (query.data ?? null) as BrainSession | null,
        isLoading: query.isLoading,
        error: query.error instanceof Error
            ? query.error.message
            : query.error
                ? 'Failed to load brain session'
                : null
    }
}

