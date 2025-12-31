import { useCallback, useRef } from 'react'
import type { ApiClient } from '@/api/client'
import type { Suggestion } from '@/hooks/useActiveSuggestions'

/**
 * Hook that provides file suggestions for @ mentions.
 * Uses ripgrep via the API which automatically respects .gitignore.
 */
export function useFileSuggestions(
    api: ApiClient | null,
    sessionId: string | null
): {
    getSuggestions: (query: string) => Promise<Suggestion[]>
} {
    const cacheRef = useRef<Map<string, Suggestion[]>>(new Map())

    const getSuggestions = useCallback(async (queryText: string): Promise<Suggestion[]> => {
        if (!api || !sessionId) {
            return []
        }

        // queryText will be like "@foo" - strip the leading @
        const searchTerm = queryText.startsWith('@')
            ? queryText.slice(1)
            : queryText

        const cacheKey = searchTerm.toLowerCase()

        try {
            const response = await api.searchSessionFiles(sessionId, searchTerm, 50)

            if (!response.success || !response.files) {
                return []
            }

            const suggestions: Suggestion[] = response.files.map(file => ({
                key: `@${file.fullPath}`,
                text: `@${file.fullPath} `,
                label: `${file.fileType === 'folder' ? '📁 ' : ''}${file.fullPath}`,
                description: undefined
            }))

            // Cache the results
            cacheRef.current.set(cacheKey, suggestions)

            // Limit cache size
            if (cacheRef.current.size > 100) {
                const firstKey = cacheRef.current.keys().next().value
                if (firstKey) {
                    cacheRef.current.delete(firstKey)
                }
            }

            return suggestions
        } catch (error) {
            console.error('Failed to fetch file suggestions:', error)
            return []
        }
    }, [api, sessionId])

    return { getSuggestions }
}
