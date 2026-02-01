import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { YohoCredentialFile } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

interface UseYohoCredentialsOptions {
    type?: string
    name?: string
    limit?: number
    enabled?: boolean
}

export function useYohoCredentials(
    api: ApiClient | null,
    options: UseYohoCredentialsOptions = {}
): {
    files: YohoCredentialFile[]
    availableTypes: string[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const { type, name, limit = 100, enabled = true } = options

    const query = useQuery({
        queryKey: queryKeys.yohoCredentials(type, name, limit),
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.searchYohoCredentials({ type, name, limit })
        },
        enabled: Boolean(api) && enabled,
    })

    return {
        files: query.data?.files ?? [],
        availableTypes: query.data?.availableTypes ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : null,
        refetch: query.refetch,
    }
}

export function useYohoCredentialTypes(
    api: ApiClient | null
): {
    types: string[]
    rootPath: string | null
    isLoading: boolean
    error: string | null
} {
    const query = useQuery({
        queryKey: queryKeys.yohoCredentialTypes(),
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getYohoCredentialTypes()
        },
        enabled: Boolean(api),
    })

    return {
        types: query.data?.types ?? [],
        rootPath: query.data?.rootPath ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : null,
    }
}
