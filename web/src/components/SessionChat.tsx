import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type { DecryptedMessage, ModelMode, ModelReasoningEffort, PermissionMode, Session, SessionViewer, TypingUser } from '@/types/api'
import type { ChatBlock, NormalizedMessage } from '@/chat/types'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { reconcileChatBlocks } from '@/chat/reconcile'
import { HappyComposer } from '@/components/AssistantChat/HappyComposer'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { SessionHeader } from '@/components/SessionHeader'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { queryKeys } from '@/lib/query-keys'

const MODEL_MODE_VALUES = new Set([
    'default',
    'sonnet',
    'opus',
    'gpt-5.2-codex',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex-mini',
    'gpt-5.2'
])

function coerceModelMode(value: string | null | undefined): ModelMode | undefined {
    if (!value) {
        return undefined
    }
    if (MODEL_MODE_VALUES.has(value)) {
        return value as ModelMode
    }
    const normalized = value.toLowerCase()
    if (normalized.includes('sonnet')) {
        return 'sonnet'
    }
    if (normalized.includes('opus')) {
        return 'opus'
    }
    return undefined
}

export function SessionChat(props: {
    api: ApiClient
    session: Session
    viewers?: SessionViewer[]
    messages: DecryptedMessage[]
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMessages: boolean
    isLoadingMoreMessages: boolean
    isSending: boolean
    onBack: () => void
    onRefresh: () => void
    onLoadMore: () => Promise<unknown>
    onSend: (text: string) => void
    onRetryMessage?: (localId: string) => void
    autocompleteSuggestions?: (query: string) => Promise<Suggestion[]>
    otherUserTyping?: TypingUser | null
}) {
    const { haptic } = usePlatform()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const controlsDisabled = !props.session.active
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const blocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())
    const { abortSession, switchSession, setPermissionMode, setModelMode, deleteSession, clearMessages, isPending } = useSessionActions(props.api, props.session.id)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [clearDialogOpen, setClearDialogOpen] = useState(false)
    const [clearSuggestionDismissed, setClearSuggestionDismissed] = useState(false)
    const [isResuming, setIsResuming] = useState(false)
    const [resumeError, setResumeError] = useState<string | null>(null)
    const pendingMessageRef = useRef<string | null>(null)
    const composerSetTextRef = useRef<((text: string) => void) | null>(null)

    useEffect(() => {
        normalizedCacheRef.current.clear()
        blocksByIdRef.current.clear()
        setIsResuming(false)
        setResumeError(null)
        setClearSuggestionDismissed(false)
        pendingMessageRef.current = null
    }, [props.session.id])

    // Update browser title with AI name
    useEffect(() => {
        const name = props.session.metadata?.name
        if (name) {
            document.title = name
        }
        return () => {
            document.title = 'Yoho Remote'
        }
    }, [props.session.metadata?.name])

    const normalizedMessages: NormalizedMessage[] = useMemo(() => {
        const cache = normalizedCacheRef.current
        const normalized: NormalizedMessage[] = []
        const seen = new Set<string>()
        for (const message of props.messages) {
            seen.add(message.id)
            const cached = cache.get(message.id)
            if (cached && cached.source === message) {
                if (cached.normalized) normalized.push(cached.normalized)
                continue
            }
            const next = normalizeDecryptedMessage(message)
            cache.set(message.id, { source: message, normalized: next })
            if (next) normalized.push(next)
        }
        for (const id of cache.keys()) {
            if (!seen.has(id)) {
                cache.delete(id)
            }
        }
        return normalized
    }, [props.messages])

    const reduced = useMemo(
        () => reduceChatBlocks(normalizedMessages, props.session.agentState),
        [normalizedMessages, props.session.agentState]
    )
    const reconciled = useMemo(
        () => reconcileChatBlocks(reduced.blocks, blocksByIdRef.current),
        [reduced.blocks]
    )

    useEffect(() => {
        blocksByIdRef.current = reconciled.byId
    }, [reconciled.byId])

    // Permission mode change handler
    const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
        try {
            await setPermissionMode(mode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set permission mode:', e)
        }
    }, [setPermissionMode, props.onRefresh, haptic])

    // Model mode change handler
    const handleModelModeChange = useCallback(async (config: { model: ModelMode; reasoningEffort?: ModelReasoningEffort | null }) => {
        try {
            await setModelMode(config)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set model mode:', e)
        }
    }, [setModelMode, props.onRefresh, haptic])

    // Abort handler
    const handleAbort = useCallback(async () => {
        await abortSession()
        props.onRefresh()
    }, [abortSession, props.onRefresh])

    // Switch to remote handler
    const handleSwitchToRemote = useCallback(async () => {
        await switchSession()
        props.onRefresh()
    }, [switchSession, props.onRefresh])

    const handleViewFiles = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId: props.session.id }
        })
    }, [navigate, props.session.id])

    const handleViewTerminal = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId/terminal',
            params: { sessionId: props.session.id }
        })
    }, [navigate, props.session.id])

    const handleDeleteClick = useCallback(() => {
        setDeleteDialogOpen(true)
    }, [])

    const handleDeleteConfirm = useCallback(async () => {
        setDeleteDialogOpen(false)
        try {
            await deleteSession()
            haptic.notification('success')
            props.onBack()
        } catch (error) {
            haptic.notification('error')
            console.error('Failed to delete session:', error)
        }
    }, [deleteSession, haptic, props])

    const handleClearMessagesClick = useCallback(() => {
        setClearDialogOpen(true)
    }, [])

    const handleClearMessagesConfirm = useCallback(async (compact: boolean) => {
        setClearDialogOpen(false)
        try {
            await clearMessages(30, compact)
            haptic.notification('success')
            props.onRefresh()
        } catch (error) {
            haptic.notification('error')
            console.error('Failed to clear messages:', error)
        }
    }, [clearMessages, haptic, props])

    const sendPendingMessage = useCallback(async (sessionId: string, text: string) => {
        const trimmed = text.trim()
        if (!trimmed) return
        if (sessionId === props.session.id) {
            props.onSend(trimmed)
            return
        }
        await props.api.sendMessage(sessionId, trimmed)
    }, [props.api, props.onSend, props.session.id])

    const resumeSession = useCallback(async (pendingText?: string) => {
        if (pendingText) {
            pendingMessageRef.current = pendingText
        }
        if (isResuming) {
            return
        }
        if (props.session.active) {
            const queued = pendingMessageRef.current
            pendingMessageRef.current = null
            if (queued) {
                void sendPendingMessage(props.session.id, queued)
            }
            return
        }

        setIsResuming(true)
        setResumeError(null)
        try {
            const result = await props.api.resumeSession(props.session.id)
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            props.onRefresh()

            const queued = pendingMessageRef.current
            pendingMessageRef.current = null
            if (queued) {
                await sendPendingMessage(result.sessionId, queued)
            }

            if (result.type === 'created' && result.sessionId !== props.session.id) {
                navigate({
                    to: '/sessions/$sessionId',
                    params: { sessionId: result.sessionId }
                })
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to resume session'
            setResumeError(message)
            haptic.notification('error')
            console.error('Failed to resume session:', error)
        } finally {
            setIsResuming(false)
        }
    }, [
        haptic,
        isResuming,
        navigate,
        props.api,
        props.onRefresh,
        props.session.active,
        props.session.id,
        queryClient,
        sendPendingMessage
    ])

    const handleResumeRequest = useCallback(() => {
        void resumeSession()
    }, [resumeSession])

    const handleSendMessage = useCallback((text: string) => {
        if (props.session.active) {
            props.onSend(text)
            return
        }
        void resumeSession(text)
    }, [props.session.active, props.onSend, resumeSession])

    // Handle chip selection from HappyThread
    const handleApplyChip = useCallback((text: string) => {
        if (composerSetTextRef.current) {
            composerSetTextRef.current(text)
        }
    }, [])

    const runtime = useHappyRuntime({
        session: props.session,
        blocks: reconciled.blocks,
        isSending: props.isSending,
        onSendMessage: handleSendMessage,
        onAbort: handleAbort
    })
    const resolvedModelMode = useMemo(() => {
        const fallbackMode = coerceModelMode(props.session.metadata?.runtimeModel)
        if (props.session.modelMode && props.session.modelMode !== 'default') {
            return props.session.modelMode
        }
        return fallbackMode ?? props.session.modelMode
    }, [props.session.modelMode, props.session.metadata?.runtimeModel])
    const resolvedReasoningEffort = props.session.modelReasoningEffort
        ?? props.session.metadata?.runtimeModelReasoningEffort

    return (
        <div className="flex h-full flex-col">
            <SessionHeader
                session={props.session}
                viewers={props.viewers}
                onBack={props.onBack}
                onViewFiles={props.session.metadata?.path ? handleViewFiles : undefined}
                onClearMessages={handleClearMessagesClick}
                onDelete={handleDeleteClick}
                clearDisabled={isPending}
                deleteDisabled={isPending}
            />

            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Session</DialogTitle>
                        <DialogDescription>
                            {props.session.active
                                ? 'This session is still active. Delete it and remove all messages? This will stop the session.'
                                : 'Delete this session and all messages? This cannot be undone.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="mt-4 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setDeleteDialogOpen(false)}
                            className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleDeleteConfirm}
                            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
                        >
                            Delete
                        </button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>清空聊天记录</DialogTitle>
                        <DialogDescription>
                            清空显示的聊天记录？将保留最近 30 条消息。
                            {props.session.active && (
                                <span className="block mt-1 text-xs">
                                    建议先 Compact（压缩总结），可保留更多上下文信息。
                                </span>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="mt-4 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setClearDialogOpen(false)}
                            className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                        >
                            取消
                        </button>
                        {props.session.active && (
                            <button
                                type="button"
                                onClick={() => handleClearMessagesConfirm(true)}
                                className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                            >
                                Compact 后清空
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => handleClearMessagesConfirm(false)}
                            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
                        >
                            直接清空
                        </button>
                    </div>
                </DialogContent>
            </Dialog>

            {controlsDisabled ? (
                <div className="px-3 pt-3">
                    <div className="mx-auto w-full max-w-content rounded-md bg-[var(--app-subtle-bg)] p-3 text-sm text-[var(--app-hint)]">
                        {isResuming
                            ? 'Resuming session...'
                            : resumeError
                                ? 'Resume failed. Tap the composer to retry.'
                                : props.messages.length === 0
                                    ? 'Starting session...'
                                    : 'Session is inactive. Tap the composer to resume.'}
                    </div>
                </div>
            ) : null}

            {/* 消息过多提示横幅 */}
            {props.messages.length >= 200 && !clearSuggestionDismissed ? (
                <div className="px-3 pt-2">
                    <div className="mx-auto w-full max-w-content flex items-center justify-between gap-2 rounded-md bg-orange-500/10 border border-orange-500/20 px-3 py-2 text-sm text-orange-600 dark:text-orange-400">
                        <span>
                            聊天记录较多 ({props.messages.length} 条)，可能导致页面卡顿。建议清空旧消息。
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setClearDialogOpen(true)}
                                className="rounded px-2 py-1 text-xs font-medium bg-orange-500 text-white hover:bg-orange-600"
                            >
                                清空
                            </button>
                            <button
                                type="button"
                                onClick={() => setClearSuggestionDismissed(true)}
                                className="rounded px-2 py-1 text-xs font-medium hover:bg-orange-500/20"
                            >
                                忽略
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            <AssistantRuntimeProvider runtime={runtime}>
                <div className="relative flex min-h-0 flex-1 flex-col">
                    <HappyThread
                        key={props.session.id}
                        api={props.api}
                        sessionId={props.session.id}
                        metadata={props.session.metadata}
                        disabled={controlsDisabled}
                        onRefresh={props.onRefresh}
                        onRetryMessage={props.onRetryMessage}
                        isLoadingMessages={props.isLoadingMessages}
                        messagesWarning={props.messagesWarning}
                        hasMoreMessages={props.hasMoreMessages}
                        isLoadingMoreMessages={props.isLoadingMoreMessages}
                        onLoadMore={props.onLoadMore}
                        rawMessagesCount={props.messages.length}
                        normalizedMessagesCount={normalizedMessages.length}
                        renderedMessagesCount={reconciled.blocks.length}
                        onApplyChip={handleApplyChip}
                    />

                    <HappyComposer
                        apiClient={props.api}
                        sessionId={props.session.id}
                        disabled={props.isSending || isResuming || controlsDisabled}
                        permissionMode={props.session.permissionMode}
                        modelMode={resolvedModelMode}
                        modelReasoningEffort={resolvedReasoningEffort}
                        agentFlavor={props.session.metadata?.flavor ?? 'claude'}
                        active={props.session.active}
                        thinking={props.session.thinking}
                        agentState={props.session.agentState}
                        contextSize={reduced.latestUsage?.contextSize}
                        controlledByUser={props.session.agentState?.controlledByUser === true}
                        onRequestResume={handleResumeRequest}
                        resumePending={isResuming}
                        resumeError={resumeError}
                        onPermissionModeChange={handlePermissionModeChange}
                        onModelModeChange={handleModelModeChange}
                        onSwitchToRemote={handleSwitchToRemote}
                        onTerminal={props.session.active ? handleViewTerminal : undefined}
                        autocompleteSuggestions={props.autocompleteSuggestions}
                        otherUserTyping={props.otherUserTyping}
                        setTextRef={composerSetTextRef}
                    />
                </div>
            </AssistantRuntimeProvider>
        </div>
    )
}
