import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import type { ApiClient } from '@/api/client'
import type { InputPreset } from '@/types/api'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { queryKeys } from '@/lib/query-keys'

export function useInputPresets(
    api: ApiClient | null
): {
    presets: InputPreset[]
    isLoading: boolean
    error: string | null
    getSuggestions: (query: string) => Promise<Suggestion[]>
} {
    const query = useQuery({
        queryKey: queryKeys.inputPresets(),
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getInputPresets()
        },
        enabled: Boolean(api),
        staleTime: 5 * 60 * 1000, // 5 minutes
        gcTime: 30 * 60 * 1000,
    })

    const presets = useMemo(() => {
        return query.data?.presets ?? []
    }, [query.data])

    const getSuggestions = useCallback(async (queryText: string): Promise<Suggestion[]> => {
        // queryText will be like "/loopr" - strip the leading slash
        const searchTerm = queryText.startsWith('/')
            ? queryText.slice(1).toLowerCase()
            : queryText.toLowerCase()

        return presets
            .filter(preset => preset.trigger.toLowerCase().startsWith(searchTerm))
            .map(preset => ({
                key: `preset:${preset.id}`,
                text: preset.prompt, // The full prompt text to insert
                label: `/${preset.trigger}`,
                description: preset.title
            }))
    }, [presets])

    return {
        presets,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load presets' : null,
        getSuggestions,
    }
}
