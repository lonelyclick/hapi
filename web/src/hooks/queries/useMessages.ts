import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ApiError, type ApiClient } from '@/api/client'
import type { DecryptedMessage, MessagesResponse } from '@/types/api'
import { mergeMessages } from '@/lib/messages'
import { queryKeys } from '@/lib/query-keys'

export function useMessages(api: ApiClient | null, sessionId: string | null): {
    messages: DecryptedMessage[]
    isLoading: boolean
    isLoadingMore: boolean
    hasMore: boolean
    loadMore: () => Promise<unknown>
    refetch: () => Promise<unknown>
} {
    const resolvedSessionId = sessionId ?? 'unknown'
    const query = useInfiniteQuery<MessagesResponse>({
        queryKey: queryKeys.messages(resolvedSessionId),
        queryFn: async ({ pageParam }) => {
            if (!api || !sessionId) {
                throw new Error('Messages unavailable')
            }
            const beforeSeq = typeof pageParam === 'number' ? pageParam : null
            return await api.getMessages(sessionId, { limit: 50, beforeSeq })
        },
        initialPageParam: null,
        getNextPageParam: (lastPage) =>
            lastPage?.page?.hasMore ? lastPage.page.nextBeforeSeq : undefined,
        retry: (failureCount, error) => {
            if (error instanceof ApiError && error.status === 404) {
                return false
            }
            return failureCount < 2
        },
        enabled: Boolean(api && sessionId),
        // Prevent showing stale messages from a different session when switching
        placeholderData: undefined,
        staleTime: 0,
    })

    const messages = useMemo(() => {
        const pages = query.data?.pages ?? []
        let merged: DecryptedMessage[] = []
        for (const page of pages) {
            merged = mergeMessages(merged, page?.messages ?? [])
        }
        return merged
    }, [query.data?.pages])

    const loadMore = async () => {
        if (!query.hasNextPage || query.isFetchingNextPage) return
        await query.fetchNextPage()
    }

    return {
        messages,
        isLoading: query.isLoading,
        isLoadingMore: query.isFetchingNextPage,
        hasMore: Boolean(query.hasNextPage),
        loadMore,
        refetch: query.refetch,
    }
}
