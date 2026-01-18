import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { ReviewPanel } from '@/components/Review'
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
    const { abortSession, switchSession, setPermissionMode, setModelMode, deleteSession, refreshAccount, isPending } = useSessionActions(props.api, props.session.id)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [isResuming, setIsResuming] = useState(false)
    const [resumeError, setResumeError] = useState<string | null>(null)
    // Review 面板状态 (试验性功能)
    const [reviewSessionId, setReviewSessionId] = useState<string | null>(null)
    // 用户手动关闭的标记，防止 activeReviewSession 重新设置 reviewSessionId
    const userClosedReviewRef = useRef(false)
    const pendingMessageRef = useRef<string | null>(null)
    const composerSetTextRef = useRef<((text: string) => void) | null>(null)

    // 移动端检测 - 初始值使用 window.innerWidth 检测（SSR 安全）
    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window === 'undefined') return false
        return window.innerWidth < 768
    })
    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    // 查询当前 Session 的活跃 Review Session（试验性功能）
    const { data: activeReviewSession } = useQuery({
        queryKey: ['review-sessions', 'active', props.session.id],
        queryFn: async () => {
            try {
                return await props.api.getActiveReviewSession(props.session.id)
            } catch {
                return null
            }
        },
        staleTime: 10_000  // 10 秒内不重复请求，避免频繁刷新
    })

    // 如果有活跃的 Review Session，自动显示面板（移动端不自动打开）
    useEffect(() => {
        // 移动端不自动打开 Review 面板
        if (isMobile) return
        // 用户手动关闭后，不再自动恢复
        if (userClosedReviewRef.current) return
        // 当 activeReviewSession 数据返回时，设置或清除 reviewSessionId
        if (activeReviewSession?.reviewSessionId) {
            setReviewSessionId(activeReviewSession.reviewSessionId)
        } else if (activeReviewSession === null) {
            // 明确没有活跃的 Review Session 时清除
            setReviewSessionId(null)
        }
        // 注意：activeReviewSession 为 undefined 时（加载中）不做任何操作
    }, [activeReviewSession, isMobile])

    useEffect(() => {
        normalizedCacheRef.current.clear()
        blocksByIdRef.current.clear()
        setIsResuming(false)
        setResumeError(null)
        // 不在这里清除 reviewSessionId，让它由 activeReviewSession 数据控制
        // setReviewSessionId(null)
        userClosedReviewRef.current = false  // 切换 session 时重置
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

    const handleRefreshAccount = useCallback(async () => {
        try {
            const result = await refreshAccount()
            haptic.notification('success')
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            // Navigate to the new session
            navigate({
                to: '/sessions/$sessionId',
                params: { sessionId: result.newSessionId }
            })
        } catch (error) {
            haptic.notification('error')
            console.error('Failed to refresh account:', error)
        }
    }, [refreshAccount, haptic, queryClient, navigate])

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

    // 处理 Review 创建
    const handleReviewCreated = useCallback((newReviewSessionId: string) => {
        userClosedReviewRef.current = false  // 创建新 Review 时重置关闭标记
        setReviewSessionId(newReviewSessionId)
    }, [])

    // 切换 Review 面板
    const handleToggleReviewPanel = useCallback(() => {
        if (reviewSessionId) {
            // 有面板打开，关闭它
            userClosedReviewRef.current = true
            setReviewSessionId(null)
        } else if (activeReviewSession?.reviewSessionId) {
            // 有活跃 Review Session，打开面板
            userClosedReviewRef.current = false
            setReviewSessionId(activeReviewSession.reviewSessionId)
        }
    }, [reviewSessionId, activeReviewSession?.reviewSessionId])

    return (
        <div className="flex h-full">
            {/* 主聊天区域 */}
            <div className="flex h-full flex-1 flex-col min-w-0">
                <SessionHeader
                    session={props.session}
                    viewers={props.viewers}
                    onBack={props.onBack}
                    onDelete={handleDeleteClick}
                    onRefreshAccount={props.session.metadata?.flavor === 'claude' ? handleRefreshAccount : undefined}
                    onReviewCreated={handleReviewCreated}
                    isReviewPanelOpen={Boolean(reviewSessionId)}
                    onToggleReviewPanel={handleToggleReviewPanel}
                    deleteDisabled={isPending}
                    refreshAccountDisabled={isPending}
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
                        hasMoreMessages={props.hasMoreMessages}
                        isLoadingMoreMessages={props.isLoadingMoreMessages}
                        onLoadMore={props.onLoadMore}
                        rawMessagesCount={props.messages.length}
                        normalizedMessagesCount={normalizedMessages.length}
                        renderedMessagesCount={reconciled.blocks.length}
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

            {/* Review 面板 */}
            {reviewSessionId && (
                <ReviewPanel
                    mainSessionId={props.session.id}
                    reviewSessionId={reviewSessionId}
                    onClose={() => {
                        userClosedReviewRef.current = true
                        setReviewSessionId(null)
                    }}
                />
            )}
        </div>
    )
}
