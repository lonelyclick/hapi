import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ClearMessagesResponse, ModelMode, ModelReasoningEffort, PermissionMode } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type PermissionModeValue = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'read-only' | 'safe-yolo' | 'yolo'
type ModelModeValue = 'default' | 'sonnet' | 'opus' | 'gpt-5.2-codex' | 'gpt-5.1-codex-max' | 'gpt-5.1-codex-mini' | 'gpt-5.2'
type ModelConfig = { model: ModelMode; reasoningEffort?: ModelReasoningEffort | null }

function toPermissionMode(mode: PermissionMode): PermissionModeValue {
    if (mode === 'acceptEdits' || mode === 'bypassPermissions' || mode === 'plan' || mode === 'read-only' || mode === 'safe-yolo' || mode === 'yolo') {
        return mode
    }
    return 'default'
}

function toModelMode(mode: ModelMode): ModelModeValue {
    if (mode === 'sonnet' || mode === 'opus') {
        return mode
    }
    if (mode === 'gpt-5.2-codex' || mode === 'gpt-5.1-codex-max' || mode === 'gpt-5.1-codex-mini' || mode === 'gpt-5.2') {
        return mode
    }
    return 'default'
}

export function useSessionActions(api: ApiClient | null, sessionId: string | null): {
    abortSession: () => Promise<void>
    switchSession: () => Promise<void>
    setPermissionMode: (mode: PermissionMode) => Promise<void>
    setModelMode: (config: ModelConfig) => Promise<void>
    deleteSession: () => Promise<void>
    clearMessages: (keepCount: number) => Promise<ClearMessagesResponse>
    isPending: boolean
} {
    const queryClient = useQueryClient()

    const invalidateSession = async () => {
        if (!sessionId) return
        await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
    }

    const abortMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.abortSession(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const switchMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.switchSession(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const permissionMutation = useMutation({
        mutationFn: async (mode: PermissionMode) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setPermissionMode(sessionId, toPermissionMode(mode))
        },
        onSuccess: () => void invalidateSession(),
    })

    const modelMutation = useMutation({
        mutationFn: async (config: ModelConfig) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setModelMode(sessionId, {
                model: toModelMode(config.model),
                reasoningEffort: config.reasoningEffort ?? undefined
            })
        },
        onSuccess: () => void invalidateSession(),
    })

    const deleteMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.deleteSession(sessionId)
        },
        onSuccess: async () => {
            if (!sessionId) return
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            await queryClient.removeQueries({ queryKey: queryKeys.session(sessionId) })
            await queryClient.removeQueries({ queryKey: queryKeys.messages(sessionId) })
        },
    })

    const clearMessagesMutation = useMutation({
        mutationFn: async (keepCount: number = 30) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            return await api.clearMessages(sessionId, keepCount)
        },
        onSuccess: async () => {
            if (!sessionId) return
            // Reset messages query to refetch fresh data
            await queryClient.resetQueries({ queryKey: queryKeys.messages(sessionId) })
        },
    })

    return {
        abortSession: abortMutation.mutateAsync,
        switchSession: switchMutation.mutateAsync,
        setPermissionMode: permissionMutation.mutateAsync,
        setModelMode: modelMutation.mutateAsync,
        deleteSession: deleteMutation.mutateAsync,
        clearMessages: clearMessagesMutation.mutateAsync,
        isPending: abortMutation.isPending
            || switchMutation.isPending
            || permissionMutation.isPending
            || modelMutation.isPending
            || deleteMutation.isPending
            || clearMessagesMutation.isPending,
    }
}
