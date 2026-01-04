import { ComposerPrimitive, useAssistantApi, useAssistantState } from '@assistant-ui/react'
import {
    type ChangeEvent as ReactChangeEvent,
    type CSSProperties as ReactCSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type SyntheticEvent as ReactSyntheticEvent,
    type TouchEvent as ReactTouchEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react'
import type { TypingUser } from '@/types/api'
import { useSessionDraft } from '@/hooks/useSessionDraft'
import { useInputHistory } from '@/hooks/useInputHistory'
import { createPortal } from 'react-dom'
import type { AgentState, ModelMode, ModelReasoningEffort, PermissionMode } from '@/types/api'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { useActiveWord } from '@/hooks/useActiveWord'
import { useActiveSuggestions } from '@/hooks/useActiveSuggestions'
import { applySuggestion } from '@/utils/applySuggestion'
import { usePlatform } from '@/hooks/usePlatform'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { useSpeechToText } from '@/hooks/useSpeechToText'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { StatusBar } from '@/components/AssistantChat/StatusBar'
import { ComposerButtons } from '@/components/AssistantChat/ComposerButtons'
import type { ApiClient } from '@/api/client'

export interface TextInputState {
    text: string
    selection: { start: number; end: number }
}

const CLAUDE_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const
const CODEX_PERMISSION_MODES = ['default', 'read-only', 'safe-yolo', 'yolo'] as const
const PERMISSION_MODE_LABELS: Record<string, string> = {
    default: 'Default',
    acceptEdits: 'Accept Edits',
    plan: 'Plan Mode',
    bypassPermissions: 'Yolo',
    'read-only': 'Read Only',
    'safe-yolo': 'Safe Yolo',
    yolo: 'Yolo'
}

const MODEL_MODES = ['default', 'sonnet', 'opus'] as const
const MODEL_MODE_LABELS: Record<string, string> = {
    default: 'Default',
    sonnet: 'Sonnet',
    opus: 'Opus'
}

const CODEX_MODELS = [
    {
        id: 'gpt-5.2-codex',
        label: 'gpt-5.2-codex',
        description: 'Latest frontier agentic coding model.'
    },
    {
        id: 'gpt-5.1-codex-max',
        label: 'gpt-5.1-codex-max',
        description: 'Codex-optimized flagship for deep and fast reasoning.'
    },
    {
        id: 'gpt-5.1-codex-mini',
        label: 'gpt-5.1-codex-mini',
        description: 'Optimized for codex. Cheaper, faster, but less capable.'
    },
    {
        id: 'gpt-5.2',
        label: 'gpt-5.2',
        description: 'Latest frontier model with improvements across knowledge, reasoning and coding.'
    }
] as const

const CODEX_MODEL_IDS = new Set(CODEX_MODELS.map((model) => model.id))

const GROK_MODELS = [
    {
        id: 'grok-4-1-fast-reasoning',
        label: 'grok-4-1-fast-reasoning',
        description: '2M context, fast reasoning model.'
    },
    {
        id: 'grok-4-1-fast-non-reasoning',
        label: 'grok-4-1-fast-non-reasoning',
        description: '2M context, fast non-reasoning model.'
    },
    {
        id: 'grok-code-fast-1',
        label: 'grok-code-fast-1',
        description: '256K context, optimized for coding.'
    },
    {
        id: 'grok-4-fast-reasoning',
        label: 'grok-4-fast-reasoning',
        description: '2M context, fast reasoning.'
    },
    {
        id: 'grok-4-fast-non-reasoning',
        label: 'grok-4-fast-non-reasoning',
        description: '2M context, fast non-reasoning.'
    },
    {
        id: 'grok-4-0709',
        label: 'grok-4-0709',
        description: '256K context, flagship model.'
    },
    {
        id: 'grok-3-mini',
        label: 'grok-3-mini',
        description: '131K context, lightweight model.'
    },
    {
        id: 'grok-3',
        label: 'grok-3',
        description: '131K context, previous generation.'
    }
] as const

const OPENROUTER_MODELS = [
    {
        id: 'anthropic/claude-sonnet-4',
        label: 'Claude Sonnet 4',
        description: 'Anthropic\'s latest efficient model.'
    },
    {
        id: 'anthropic/claude-opus-4',
        label: 'Claude Opus 4',
        description: 'Anthropic\'s most capable model.'
    },
    {
        id: 'anthropic/claude-3.5-sonnet',
        label: 'Claude 3.5 Sonnet',
        description: 'Previous generation Sonnet.'
    },
    {
        id: 'openai/gpt-4o',
        label: 'GPT-4o',
        description: 'OpenAI\'s multimodal flagship.'
    },
    {
        id: 'openai/o1',
        label: 'OpenAI o1',
        description: 'OpenAI\'s reasoning model.'
    },
    {
        id: 'google/gemini-2.0-flash-001',
        label: 'Gemini 2.0 Flash',
        description: 'Google\'s fast model.'
    },
    {
        id: 'deepseek/deepseek-r1',
        label: 'DeepSeek R1',
        description: 'DeepSeek\'s reasoning model.'
    },
    {
        id: 'deepseek/deepseek-chat',
        label: 'DeepSeek Chat',
        description: 'DeepSeek\'s chat model.'
    }
] as const

function isCodexModel(mode: ModelMode | undefined): mode is typeof CODEX_MODELS[number]['id'] {
    return Boolean(mode && CODEX_MODEL_IDS.has(mode as typeof CODEX_MODELS[number]['id']))
}

type CodexReasoningLevel = {
    id: ModelReasoningEffort
    label: string
    description: string
    warning?: string
}

const CODEX_REASONING_LEVELS: CodexReasoningLevel[] = [
    {
        id: 'low',
        label: 'Low',
        description: 'Fast responses with lighter reasoning'
    },
    {
        id: 'medium',
        label: 'Medium (default)',
        description: 'Balances speed and reasoning depth for everyday tasks'
    },
    {
        id: 'high',
        label: 'High',
        description: 'Greater reasoning depth for complex problems'
    },
    {
        id: 'xhigh',
        label: 'Extra high',
        description: 'Extra high reasoning depth for complex problems',
        warning: 'Extra high reasoning effort can quickly consume Plus plan rate limits.'
    }
] as const

const defaultSuggestionHandler = async (): Promise<Suggestion[]> => []

export function HappyComposer(props: {
    apiClient: ApiClient
    sessionId: string
    disabled?: boolean
    permissionMode?: PermissionMode
    modelMode?: ModelMode
    modelReasoningEffort?: ModelReasoningEffort
    active?: boolean
    thinking?: boolean
    agentState?: AgentState | null
    contextSize?: number
    controlledByUser?: boolean
    agentFlavor?: string | null
    onRequestResume?: () => void
    resumePending?: boolean
    resumeError?: string | null
    onPermissionModeChange?: (mode: PermissionMode) => void
    onModelModeChange?: (config: { model: ModelMode; reasoningEffort?: ModelReasoningEffort | null }) => void
    onSwitchToRemote?: () => void
    onTerminal?: () => void
    autocompletePrefixes?: string[]
    autocompleteSuggestions?: (query: string) => Promise<Suggestion[]>
    otherUserTyping?: TypingUser | null
    setTextRef?: React.MutableRefObject<((text: string) => void) | null>
}) {
    const {
        apiClient,
        sessionId,
        disabled = false,
        permissionMode: rawPermissionMode,
        modelMode: rawModelMode,
        modelReasoningEffort,
        active = true,
        thinking = false,
        agentState,
        contextSize,
        controlledByUser = false,
        agentFlavor,
        onRequestResume,
        resumePending = false,
        resumeError = null,
        onPermissionModeChange,
        onModelModeChange,
        onSwitchToRemote,
        onTerminal,
        autocompletePrefixes = ['@', '/'],
        autocompleteSuggestions = defaultSuggestionHandler,
        otherUserTyping = null
    } = props

    // Use ?? so missing values fall back to default (destructuring defaults only handle undefined)
    const permissionMode = rawPermissionMode ?? 'default'
    const modelMode = rawModelMode ?? 'default'

    const assistantApi = useAssistantApi()
    const composerText = useAssistantState(({ composer }) => composer.text)
    const threadIsRunning = useAssistantState(({ thread }) => thread.isRunning)
    const threadIsDisabled = useAssistantState(({ thread }) => thread.isDisabled)

    const [uploadedImages, setUploadedImages] = useState<Array<{ path: string; previewUrl: string }>>([])
    const MAX_IMAGES = 5

    const controlsDisabled = disabled || !active || threadIsDisabled
    const trimmed = composerText.trim()
    const hasText = trimmed.length > 0
    const hasImages = uploadedImages.length > 0
    const canSend = (hasText || hasImages) && !controlsDisabled && !threadIsRunning
    const showResumeOverlay = !active && Boolean(onRequestResume)
    const resumeLabel = resumePending
        ? 'Resuming...'
        : resumeError
            ? 'Resume failed. Tap to retry.'
            : 'Tap to resume session'

    const [inputState, setInputState] = useState<TextInputState>({
        text: '',
        selection: { start: 0, end: 0 }
    })
    const [showSettings, setShowSettings] = useState(false)
    const [isAborting, setIsAborting] = useState(false)
    const [isSwitching, setIsSwitching] = useState(false)
    const [showContinueHint, setShowContinueHint] = useState(false)
    const [voiceMode, setVoiceMode] = useState(false)
    const [isOptimizing, setIsOptimizing] = useState(false)
    const [autoOptimize, setAutoOptimize] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('hapi-auto-optimize') === 'true'
        }
        return false
    })
    const [optimizePreview, setOptimizePreview] = useState<{ original: string; optimized: string } | null>(null)

    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const imageInputRef = useRef<HTMLInputElement>(null)
    const prevControlledByUser = useRef(controlledByUser)
    const sttPrefixRef = useRef<string>('')
    const [isUploading, setIsUploading] = useState(false)

    // Session 草稿管理
    const { getDraft, setDraft, clearDraft } = useSessionDraft(sessionId)

    const draftLoadedRef = useRef(false)
    const prevSessionIdRef = useRef(sessionId)

    // 历史记录管理
    const { addToHistory, navigateUp, navigateDown, resetNavigation, isNavigating } = useInputHistory()

    // 输入同步防抖
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // 加载草稿（切换 session 时）
    useEffect(() => {
        // 保存前一个 session 的草稿
        if (prevSessionIdRef.current !== sessionId && prevSessionIdRef.current) {
            const currentText = composerText.trim()
            if (currentText) {
                // 使用 localStorage 直接保存，因为 setDraft 可能还指向旧的 sessionId
                try {
                    const stored = localStorage.getItem('hapi:sessionDrafts')
                    const data = stored ? JSON.parse(stored) : {}
                    data[prevSessionIdRef.current] = composerText
                    localStorage.setItem('hapi:sessionDrafts', JSON.stringify(data))
                } catch {
                    // Ignore
                }
            }
        }
        prevSessionIdRef.current = sessionId

        // 加载新 session 的草稿
        const draft = getDraft()
        if (draft) {
            assistantApi.composer().setText(draft)
            setInputState({
                text: draft,
                selection: { start: draft.length, end: draft.length }
            })
        } else if (composerText) {
            // 如果有 composerText 但没有草稿，清空输入
            assistantApi.composer().setText('')
            setInputState({
                text: '',
                selection: { start: 0, end: 0 }
            })
        }
        draftLoadedRef.current = true
        resetNavigation()
        // 清空上传的图片
        setUploadedImages([])
    }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

    // 实时保存草稿
    useEffect(() => {
        if (!draftLoadedRef.current) return
        setDraft(composerText)
    }, [composerText, setDraft])

    // 同步输入给其他用户（防抖 300ms）
    // 用 ref 跟踪是否是本地输入，避免把远程同步的内容再发回去
    const isLocalInputRef = useRef(true)

    useEffect(() => {
        if (!sessionId || !active) return
        // 如果不是本地输入，不发送
        if (!isLocalInputRef.current) {
            isLocalInputRef.current = true
            return
        }

        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current)
        }

        typingTimeoutRef.current = setTimeout(() => {
            apiClient.sendTyping(sessionId, composerText).catch(() => {
                // Ignore errors
            })
        }, 300)

        return () => {
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current)
            }
        }
    }, [composerText, sessionId, active, apiClient])

    // 接收其他用户的输入并同步到输入框
    const prevOtherUserTextRef = useRef<string | null>(null)
    useEffect(() => {
        if (!otherUserTyping) {
            prevOtherUserTextRef.current = null
            return
        }
        // 只有当其他用户输入内容变化时才同步
        if (otherUserTyping.text === prevOtherUserTextRef.current) return
        prevOtherUserTextRef.current = otherUserTyping.text

        // 标记为非本地输入，避免把同步过来的内容再发回去
        isLocalInputRef.current = false
        assistantApi.composer().setText(otherUserTyping.text)
        setInputState({
            text: otherUserTyping.text,
            selection: { start: otherUserTyping.text.length, end: otherUserTyping.text.length }
        })
    }, [otherUserTyping, assistantApi])

    useEffect(() => {
        setInputState((prev) => {
            if (prev.text === composerText) return prev
            // When syncing from composerText, update selection to end of text
            // This ensures activeWord detection works correctly
            const newPos = composerText.length
            return { text: composerText, selection: { start: newPos, end: newPos } }
        })
    }, [composerText])

    // Track one-time "continue" hint after switching from local to remote.
    useEffect(() => {
        if (prevControlledByUser.current === true && controlledByUser === false) {
            setShowContinueHint(true)
        }
        if (controlledByUser) {
            setShowContinueHint(false)
        }
        prevControlledByUser.current = controlledByUser
    }, [controlledByUser])

    const { haptic: platformHaptic, isTouch } = usePlatform()
    const { isStandalone, isIOS } = usePWAInstall()
    const isIOSPWA = isIOS && isStandalone
    // iOS PWA 使用 safe-area-inset-bottom 适配底部安全距离，同时保证最小 padding
    const bottomPaddingClass = isIOSPWA ? 'pb-[max(env(safe-area-inset-bottom),0.75rem)]' : 'pb-3'
    const activeWord = useActiveWord(inputState.text, inputState.selection, autocompletePrefixes)
    const [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions] = useActiveSuggestions(
        activeWord,
        autocompleteSuggestions,
        { clampSelection: true, wrapAround: true }
    )

    const haptic = useCallback((type: 'light' | 'success' | 'error' = 'light') => {
        if (type === 'light') {
            platformHaptic.impact('light')
        } else if (type === 'success') {
            platformHaptic.notification('success')
        } else {
            platformHaptic.notification('error')
        }
    }, [platformHaptic])

    const handleSuggestionSelect = useCallback((index: number) => {
        const suggestion = suggestions[index]
        if (!suggestion || !textareaRef.current) return

        const result = applySuggestion(
            inputState.text,
            inputState.selection,
            suggestion.text,
            autocompletePrefixes,
            true
        )

        assistantApi.composer().setText(result.text)
        setInputState({
            text: result.text,
            selection: { start: result.cursorPosition, end: result.cursorPosition }
        })

        setTimeout(() => {
            const el = textareaRef.current
            if (!el) return
            el.setSelectionRange(result.cursorPosition, result.cursorPosition)
            try {
                el.focus({ preventScroll: true })
            } catch {
                el.focus()
            }
        }, 0)

        haptic('light')
    }, [assistantApi, suggestions, inputState, autocompletePrefixes, haptic])

    // 暴露 setText 方法供外部调用（用于芯片选择）
    useEffect(() => {
        if (props.setTextRef) {
            props.setTextRef.current = (text: string) => {
                assistantApi.composer().setText(text)
                setInputState({
                    text,
                    selection: { start: text.length, end: text.length }
                })
                setTimeout(() => {
                    textareaRef.current?.focus()
                }, 0)
            }
        }
        return () => {
            if (props.setTextRef) {
                props.setTextRef.current = null
            }
        }
    }, [assistantApi, props.setTextRef])

    const abortDisabled = controlsDisabled || isAborting || !threadIsRunning
    const switchDisabled = controlsDisabled || isSwitching || !controlledByUser
    const showSwitchButton = Boolean(controlledByUser && onSwitchToRemote)
    const showTerminalButton = Boolean(onTerminal)

    useEffect(() => {
        if (!isAborting) return
        if (threadIsRunning) return
        setIsAborting(false)
    }, [isAborting, threadIsRunning])

    useEffect(() => {
        if (!isSwitching) return
        if (controlledByUser) return
        setIsSwitching(false)
    }, [isSwitching, controlledByUser])

    const handleAbort = useCallback(() => {
        if (abortDisabled) return
        haptic('error')
        setIsAborting(true)
        assistantApi.thread().cancelRun()
    }, [abortDisabled, assistantApi, haptic])

    const handleSwitch = useCallback(async () => {
        if (switchDisabled || !onSwitchToRemote) return
        haptic('light')
        setIsSwitching(true)
        try {
            await onSwitchToRemote()
        } catch {
            setIsSwitching(false)
        }
    }, [switchDisabled, onSwitchToRemote, haptic])

    const permissionModes = useMemo(() => {
        if (agentFlavor === 'codex') {
            return CODEX_PERMISSION_MODES as readonly PermissionMode[]
        }
        if (agentFlavor === 'gemini') {
            return [] as readonly PermissionMode[]
        }
        return CLAUDE_PERMISSION_MODES as readonly PermissionMode[]
    }, [agentFlavor])

    const optimizeText = useCallback(async (text: string): Promise<string> => {
        const result = await apiClient.optimizeText(text)
        return result.optimized
    }, [apiClient])

    const handleOptimizeForPreview = useCallback(async () => {
        if (controlsDisabled || !hasText || isOptimizing) return

        setIsOptimizing(true)
        haptic('light')

        try {
            const optimizedResult = await optimizeText(trimmed)
            // If text is the same, just send directly
            if (optimizedResult === trimmed) {
                const form = textareaRef.current?.closest('form')
                if (form) {
                    form.requestSubmit()
                }
            } else {
                // Show preview dialog
                setOptimizePreview({ original: trimmed, optimized: optimizedResult })
            }
        } catch (error) {
            console.error('Failed to optimize text:', error)
            haptic('error')
            // On error, just send the original
            const form = textareaRef.current?.closest('form')
            if (form) {
                form.requestSubmit()
            }
        } finally {
            setIsOptimizing(false)
        }
    }, [controlsDisabled, hasText, isOptimizing, trimmed, optimizeText, haptic])

    const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        const key = e.key

        // Avoid intercepting IME composition keystrokes (Enter, arrows, etc.)
        if (e.nativeEvent.isComposing) {
            return
        }

        if (suggestions.length > 0) {
            if (key === 'ArrowUp') {
                e.preventDefault()
                moveUp()
                return
            }
            if (key === 'ArrowDown') {
                e.preventDefault()
                moveDown()
                return
            }
            if ((key === 'Enter' || key === 'Tab') && !e.shiftKey) {
                e.preventDefault()
                const indexToSelect = selectedIndex >= 0 ? selectedIndex : 0
                handleSuggestionSelect(indexToSelect)
                return
            }
            if (key === 'Escape') {
                e.preventDefault()
                clearSuggestions()
                return
            }
        }

        // 历史记录导航（输入框为空时）
        if (!hasText && suggestions.length === 0) {
            if (key === 'ArrowUp') {
                const historyText = navigateUp(inputState.text)
                if (historyText !== null) {
                    e.preventDefault()
                    assistantApi.composer().setText(historyText)
                    setInputState({
                        text: historyText,
                        selection: { start: historyText.length, end: historyText.length }
                    })
                }
                return
            }
            if (key === 'ArrowDown' && isNavigating()) {
                const historyText = navigateDown()
                if (historyText !== null) {
                    e.preventDefault()
                    assistantApi.composer().setText(historyText)
                    setInputState({
                        text: historyText,
                        selection: { start: historyText.length, end: historyText.length }
                    })
                }
                return
            }
        }

        if (key === 'Escape' && threadIsRunning) {
            e.preventDefault()
            handleAbort()
            return
        }

        if (key === 'Tab' && e.shiftKey && onPermissionModeChange && permissionModes.length > 0) {
            e.preventDefault()
            const currentIndex = permissionModes.indexOf(permissionMode)
            const nextIndex = (currentIndex + 1) % permissionModes.length
            const nextMode = permissionModes[nextIndex] ?? 'default'
            onPermissionModeChange(nextMode)
            haptic('light')
            return
        }

        // Intercept Enter for auto-optimize
        if (key === 'Enter' && !e.shiftKey && autoOptimize && hasText && !isOptimizing && !controlsDisabled && !threadIsRunning) {
            e.preventDefault()
            handleOptimizeForPreview()
        }
    }, [
        suggestions,
        selectedIndex,
        moveUp,
        moveDown,
        clearSuggestions,
        handleSuggestionSelect,
        threadIsRunning,
        handleAbort,
        onPermissionModeChange,
        permissionMode,
        permissionModes,
        haptic,
        autoOptimize,
        hasText,
        isOptimizing,
        controlsDisabled,
        handleOptimizeForPreview,
        navigateUp,
        navigateDown,
        isNavigating,
        inputState.text,
        assistantApi
    ])

    useEffect(() => {
        const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'm' && (e.metaKey || e.ctrlKey) && onModelModeChange && agentFlavor !== 'codex' && agentFlavor !== 'gemini') {
                e.preventDefault()
                const currentIndex = MODEL_MODES.indexOf(modelMode as typeof MODEL_MODES[number])
                const nextIndex = (currentIndex + 1) % MODEL_MODES.length
                onModelModeChange({ model: MODEL_MODES[nextIndex] })
                haptic('light')
            }
        }

        window.addEventListener('keydown', handleGlobalKeyDown)
        return () => window.removeEventListener('keydown', handleGlobalKeyDown)
    }, [modelMode, onModelModeChange, haptic, agentFlavor])

    const handleChange = useCallback((e: ReactChangeEvent<HTMLTextAreaElement>) => {
        const selection = {
            start: e.target.selectionStart,
            end: e.target.selectionEnd
        }
        setInputState({ text: e.target.value, selection })
    }, [])

    const handleSelect = useCallback((e: ReactSyntheticEvent<HTMLTextAreaElement>) => {
        const target = e.target as HTMLTextAreaElement
        setInputState(prev => ({
            ...prev,
            selection: { start: target.selectionStart, end: target.selectionEnd }
        }))
    }, [])

    const handleSettingsToggle = useCallback(() => {
        haptic('light')
        setShowSettings(prev => !prev)
    }, [haptic])

    const handleSubmit = useCallback(() => {
        setShowContinueHint(false)

        // 添加到历史记录
        if (trimmed || uploadedImages.length > 0) {
            addToHistory(trimmed)
        }
        // 清除草稿
        clearDraft()
        // 重置历史导航
        resetNavigation()
        // 清空图片列表（提交后清理）
        if (uploadedImages.length > 0) {
            setUploadedImages([])
        }
    }, [trimmed, addToHistory, clearDraft, resetNavigation, uploadedImages])

    // 处理带图片的消息发送
    const handleSendWithImages = useCallback(() => {
        if (uploadedImages.length === 0) {
            // 没有图片，直接提交
            const form = textareaRef.current?.closest('form')
            if (form) {
                form.requestSubmit()
            }
            return
        }

        // 有图片，先添加图片引用到文本
        const imageRefs = uploadedImages.map(img => `[Image: ${img.path}]`).join('\n')
        const currentText = composerText.trim()
        const separator = currentText ? '\n\n' : ''
        const newText = `${currentText}${separator}${imageRefs}`
        assistantApi.composer().setText(newText)

        // 延迟提交，等待文本更新
        setTimeout(() => {
            const form = textareaRef.current?.closest('form')
            if (form) {
                form.requestSubmit()
            }
        }, 50)
    }, [uploadedImages, composerText, assistantApi])

    const handlePermissionChange = useCallback((mode: PermissionMode) => {
        if (!onPermissionModeChange || controlsDisabled) return
        onPermissionModeChange(mode)
        setShowSettings(false)
        haptic('light')
    }, [onPermissionModeChange, controlsDisabled, haptic])

    const handleModelChange = useCallback((config: { model: ModelMode; reasoningEffort?: ModelReasoningEffort | null }) => {
        if (!onModelModeChange || controlsDisabled) return
        onModelModeChange(config)
        setShowSettings(false)
        haptic('light')
    }, [onModelModeChange, controlsDisabled, haptic])

    const handleAutoOptimizeToggle = useCallback(() => {
        setAutoOptimize(prev => {
            const newValue = !prev
            localStorage.setItem('hapi-auto-optimize', String(newValue))
            return newValue
        })
        haptic('light')
    }, [haptic])

    const handleImageClick = useCallback(() => {
        imageInputRef.current?.click()
    }, [])

    const handleImageChange = useCallback(async (e: ReactChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        // Reset input for next selection
        e.target.value = ''

        // Check max images limit
        if (uploadedImages.length >= MAX_IMAGES) {
            haptic('error')
            console.error(`Maximum ${MAX_IMAGES} images allowed`)
            return
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
            haptic('error')
            console.error('Selected file is not an image')
            return
        }

        // Validate file size (max 10MB)
        const maxSize = 10 * 1024 * 1024
        if (file.size > maxSize) {
            haptic('error')
            console.error('Image file too large (max 10MB)')
            return
        }

        setIsUploading(true)
        haptic('light')

        try {
            // Read file as base64 and create preview URL
            const reader = new FileReader()
            const dataUrlPromise = new Promise<string>((resolve, reject) => {
                reader.onload = () => {
                    resolve(reader.result as string)
                }
                reader.onerror = reject
            })
            reader.readAsDataURL(file)
            const dataUrl = await dataUrlPromise

            // Extract base64 content (remove data URL prefix)
            const base64Content = dataUrl.split(',')[1]

            // Upload to server
            const result = await apiClient.uploadImage(sessionId, file.name, base64Content, file.type)

            if (result.success && result.path) {
                haptic('success')
                // Add to uploaded images list with preview
                setUploadedImages(prev => [...prev, { path: result.path!, previewUrl: dataUrl }])
            } else {
                haptic('error')
                console.error('Failed to upload image:', result.error)
            }
        } catch (error) {
            haptic('error')
            console.error('Failed to upload image:', error)
        } finally {
            setIsUploading(false)
        }
    }, [apiClient, sessionId, uploadedImages.length, haptic])

    const handleRemoveImage = useCallback((index: number) => {
        setUploadedImages(prev => prev.filter((_, i) => i !== index))
        haptic('light')
    }, [haptic])

    const handlePreviewConfirm = useCallback(() => {
        if (!optimizePreview) return
        assistantApi.composer().setText(optimizePreview.optimized)
        setInputState({
            text: optimizePreview.optimized,
            selection: { start: optimizePreview.optimized.length, end: optimizePreview.optimized.length }
        })
        setOptimizePreview(null)
        // Send after state update
        setTimeout(() => {
            const form = textareaRef.current?.closest('form')
            if (form) {
                form.requestSubmit()
            }
        }, 50)
    }, [optimizePreview, assistantApi])

    const handlePreviewCancel = useCallback(() => {
        setOptimizePreview(null)
        // Focus back to textarea
        textareaRef.current?.focus()
    }, [])

    const handlePreviewSendOriginal = useCallback(() => {
        setOptimizePreview(null)
        // Send original text
        const form = textareaRef.current?.closest('form')
        if (form) {
            form.requestSubmit()
        }
    }, [])

    const showPermissionSettings = Boolean(onPermissionModeChange && permissionModes.length > 0)
    const showModelSettings = Boolean(onModelModeChange && agentFlavor !== 'gemini')
    const showSettingsButton = true // Always show settings for auto-optimize toggle
    const showAbortButton = true
    const isCodex = agentFlavor === 'codex'
    const isGrok = agentFlavor === 'grok'
    const isOpenRouter = agentFlavor === 'openrouter'
    const codexModel = isCodex && isCodexModel(modelMode) ? modelMode : 'gpt-5.2-codex'
    const grokModel = isGrok ? (modelMode as string || 'grok-code-fast-1') : 'grok-code-fast-1'
    const openrouterModel = isOpenRouter ? (modelMode as string || 'anthropic/claude-sonnet-4') : 'anthropic/claude-sonnet-4'
    const codexReasoningEffort: ModelReasoningEffort = modelReasoningEffort ?? 'medium'
    const shouldShowCodexReasoning = isCodex && codexModel === 'gpt-5.2-codex'
    const speechToText = useSpeechToText({
        onPartial: (text) => {
            const prefix = sttPrefixRef.current
            assistantApi.composer().setText(`${prefix}${text}`)
        },
        onFinal: (text) => {
            const prefix = sttPrefixRef.current
            const finalText = `${prefix}${text}`
            assistantApi.composer().setText(finalText)
            sttPrefixRef.current = finalText
        },
        onError: (message) => {
            console.error('Speech-to-text error:', message)
            haptic('error')
        }
    })

    const handleVoicePressStart = useCallback(async () => {
        if (!speechToText.isSupported || controlsDisabled) return
        if (speechToText.status === 'connecting' || speechToText.status === 'recording' || speechToText.status === 'stopping') return
        const spacer = composerText && !/\s$/.test(composerText) ? ' ' : ''
        sttPrefixRef.current = `${composerText}${spacer}`
        await speechToText.start()
    }, [composerText, controlsDisabled, speechToText])

    const handleVoicePressEnd = useCallback(() => {
        if (speechToText.status === 'recording' || speechToText.status === 'connecting') {
            speechToText.stop()
        }
    }, [speechToText])

    const handleVoiceToggle = useCallback(() => {
        if (!speechToText.isSupported || controlsDisabled) return
        if (voiceMode) {
            if (speechToText.status === 'recording') {
                speechToText.stop()
            }
            speechToText.teardown()
            setVoiceMode(false)
        } else {
            setVoiceMode(true)
            speechToText.prepare().catch(() => {})
        }
    }, [controlsDisabled, speechToText, voiceMode])

    // Track if we're currently pressing the voice button
    const voicePressActiveRef = useRef(false)
    // Prevent touch and pointer events from both firing
    const touchHandledRef = useRef(false)

    const startVoiceCapture = useCallback(() => {
        if (!voiceMode || controlsDisabled) return false
        if (speechToText.status === 'connecting' || speechToText.status === 'stopping') return false
        if (voicePressActiveRef.current) return false

        voicePressActiveRef.current = true
        console.log('[stt] voice capture start', { status: speechToText.status })
        handleVoicePressStart().catch(() => {})
        return true
    }, [voiceMode, controlsDisabled, speechToText.status, handleVoicePressStart])

    const stopVoiceCapture = useCallback(() => {
        if (!voicePressActiveRef.current) return
        voicePressActiveRef.current = false
        console.log('[stt] voice capture stop')
        handleVoicePressEnd()
    }, [handleVoicePressEnd])

    // Touch events - primary handler for iOS
    const handleTouchStart = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
        touchHandledRef.current = true
        event.preventDefault()
        startVoiceCapture()
    }, [startVoiceCapture])

    const handleTouchEnd = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
        event.preventDefault()
        stopVoiceCapture()
        // Reset touch flag after a short delay
        setTimeout(() => { touchHandledRef.current = false }, 300)
    }, [stopVoiceCapture])

    // Pointer events - fallback for desktop
    const handleVoicePadPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        // Skip if touch already handled this interaction
        if (touchHandledRef.current) return
        event.preventDefault()
        startVoiceCapture()
    }, [startVoiceCapture])

    // Global listener to catch pointer/touch end anywhere on screen
    useEffect(() => {
        if (!voiceMode) {
            if (voicePressActiveRef.current) {
                voicePressActiveRef.current = false
                handleVoicePressEnd()
            }
            touchHandledRef.current = false
            return
        }

        const handleGlobalEnd = (event: PointerEvent | TouchEvent) => {
            if (!voicePressActiveRef.current) return
            // For touch events on iOS, prevent the synthetic pointer events
            if (event.type === 'touchend' || event.type === 'touchcancel') {
                touchHandledRef.current = true
                setTimeout(() => { touchHandledRef.current = false }, 300)
            }
            stopVoiceCapture()
        }

        // Listen on document to ensure we catch events even if finger moves off button
        document.addEventListener('pointerup', handleGlobalEnd, { capture: true, passive: true })
        document.addEventListener('pointercancel', handleGlobalEnd, { capture: true, passive: true })
        document.addEventListener('touchend', handleGlobalEnd, { capture: true, passive: true })
        document.addEventListener('touchcancel', handleGlobalEnd, { capture: true, passive: true })

        return () => {
            document.removeEventListener('pointerup', handleGlobalEnd, { capture: true })
            document.removeEventListener('pointercancel', handleGlobalEnd, { capture: true })
            document.removeEventListener('touchend', handleGlobalEnd, { capture: true })
            document.removeEventListener('touchcancel', handleGlobalEnd, { capture: true })
        }
    }, [voiceMode, handleVoicePressEnd, stopVoiceCapture])

    useEffect(() => {
        if (!active && speechToText.status === 'recording') {
            speechToText.stop()
        }
    }, [active, speechToText])

    const overlays = useMemo(() => {
        if (showSettings) {
            return (
                <div className="absolute bottom-[100%] mb-2 w-full">
                    <FloatingOverlay maxHeight={320}>
                        {/* Auto Optimize Toggle */}
                        <div className="py-2">
                            <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                AI Optimize
                            </div>
                            <button
                                type="button"
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors cursor-pointer hover:bg-[var(--app-secondary-bg)]"
                                onClick={handleAutoOptimizeToggle}
                                onMouseDown={(e) => e.preventDefault()}
                            >
                                <span>Auto-optimize before sending</span>
                                <div className={`relative h-5 w-9 rounded-full transition-colors ${autoOptimize ? 'bg-purple-600' : 'bg-gray-300'}`}>
                                    <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${autoOptimize ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                </div>
                            </button>
                        </div>

                        {showPermissionSettings ? (
                            <div className="mx-3 h-px bg-[var(--app-divider)]" />
                        ) : null}

                        {showPermissionSettings ? (
                            <div className="py-2">
                                <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                    Permission Mode
                                </div>
                                {permissionModes.map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        disabled={controlsDisabled}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                            controlsDisabled
                                                ? 'cursor-not-allowed opacity-50'
                                                : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                        }`}
                                        onClick={() => handlePermissionChange(mode)}
                                        onMouseDown={(e) => e.preventDefault()}
                                    >
                                        <div
                                            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                permissionMode === mode
                                                    ? 'border-[var(--app-link)]'
                                                    : 'border-[var(--app-hint)]'
                                            }`}
                                        >
                                            {permissionMode === mode && (
                                                <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                            )}
                                        </div>
                                        <span className={permissionMode === mode ? 'text-[var(--app-link)]' : ''}>
                                            {PERMISSION_MODE_LABELS[mode]}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : null}

                        {showPermissionSettings && showModelSettings ? (
                            <div className="mx-3 h-px bg-[var(--app-divider)]" />
                        ) : null}

                        {showModelSettings ? (
                            <div className="py-2">
                                <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                    Model
                                </div>
                                {isCodex ? (
                                    <div className="space-y-1">
                                        {CODEX_MODELS.map((mode) => (
                                            <button
                                                key={mode.id}
                                                type="button"
                                                disabled={controlsDisabled}
                                                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                                    controlsDisabled
                                                        ? 'cursor-not-allowed opacity-50'
                                                        : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                                }`}
                                                onClick={() => handleModelChange({ model: mode.id, reasoningEffort: codexReasoningEffort })}
                                                onMouseDown={(e) => e.preventDefault()}
                                            >
                                                <div
                                                    className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                        codexModel === mode.id
                                                            ? 'border-[var(--app-link)]'
                                                            : 'border-[var(--app-hint)]'
                                                    }`}
                                                >
                                                    {codexModel === mode.id && (
                                                        <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                                    )}
                                                </div>
                                                <div className="flex flex-col gap-0.5">
                                                    <span className={codexModel === mode.id ? 'text-[var(--app-link)]' : ''}>
                                                        {mode.label}
                                                    </span>
                                                    <span className="text-xs text-[var(--app-hint)]">
                                                        {mode.description}
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                ) : isGrok ? (
                                    <div className="space-y-1">
                                        {GROK_MODELS.map((mode) => (
                                            <button
                                                key={mode.id}
                                                type="button"
                                                disabled={controlsDisabled}
                                                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                                    controlsDisabled
                                                        ? 'cursor-not-allowed opacity-50'
                                                        : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                                }`}
                                                onClick={() => handleModelChange({ model: mode.id as ModelMode })}
                                                onMouseDown={(e) => e.preventDefault()}
                                            >
                                                <div
                                                    className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                        grokModel === mode.id
                                                            ? 'border-[var(--app-link)]'
                                                            : 'border-[var(--app-hint)]'
                                                    }`}
                                                >
                                                    {grokModel === mode.id && (
                                                        <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                                    )}
                                                </div>
                                                <div className="flex flex-col gap-0.5">
                                                    <span className={grokModel === mode.id ? 'text-[var(--app-link)]' : ''}>
                                                        {mode.label}
                                                    </span>
                                                    <span className="text-xs text-[var(--app-hint)]">
                                                        {mode.description}
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                ) : isOpenRouter ? (
                                    <div className="space-y-1">
                                        {OPENROUTER_MODELS.map((mode) => (
                                            <button
                                                key={mode.id}
                                                type="button"
                                                disabled={controlsDisabled}
                                                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                                    controlsDisabled
                                                        ? 'cursor-not-allowed opacity-50'
                                                        : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                                }`}
                                                onClick={() => handleModelChange({ model: mode.id as ModelMode })}
                                                onMouseDown={(e) => e.preventDefault()}
                                            >
                                                <div
                                                    className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                        openrouterModel === mode.id
                                                            ? 'border-[var(--app-link)]'
                                                            : 'border-[var(--app-hint)]'
                                                    }`}
                                                >
                                                    {openrouterModel === mode.id && (
                                                        <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                                    )}
                                                </div>
                                                <div className="flex flex-col gap-0.5">
                                                    <span className={openrouterModel === mode.id ? 'text-[var(--app-link)]' : ''}>
                                                        {mode.label}
                                                    </span>
                                                    <span className="text-xs text-[var(--app-hint)]">
                                                        {mode.description}
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    MODEL_MODES.map((mode) => (
                                        <button
                                            key={mode}
                                            type="button"
                                            disabled={controlsDisabled}
                                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                                controlsDisabled
                                                    ? 'cursor-not-allowed opacity-50'
                                                    : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                            }`}
                                            onClick={() => handleModelChange({ model: mode })}
                                            onMouseDown={(e) => e.preventDefault()}
                                        >
                                            <div
                                                className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                    modelMode === mode
                                                        ? 'border-[var(--app-link)]'
                                                        : 'border-[var(--app-hint)]'
                                                }`}
                                            >
                                                {modelMode === mode && (
                                                    <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                                )}
                                            </div>
                                            <span className={modelMode === mode ? 'text-[var(--app-link)]' : ''}>
                                                {MODEL_MODE_LABELS[mode]}
                                            </span>
                                        </button>
                                    ))
                                )}
                                {shouldShowCodexReasoning ? (
                                    <div className="mt-2 border-t border-[var(--app-divider)] pt-2">
                                        <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                            Select Reasoning Level for gpt-5.2-codex
                                        </div>
                                        <div className="space-y-1">
                                            {CODEX_REASONING_LEVELS.map((level) => (
                                                <button
                                                    key={level.id}
                                                    type="button"
                                                    disabled={controlsDisabled}
                                                    className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                                        controlsDisabled
                                                            ? 'cursor-not-allowed opacity-50'
                                                            : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                                    }`}
                                                    onClick={() => handleModelChange({ model: codexModel, reasoningEffort: level.id })}
                                                    onMouseDown={(e) => e.preventDefault()}
                                                >
                                                    <div
                                                        className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                            codexReasoningEffort === level.id
                                                                ? 'border-[var(--app-link)]'
                                                                : 'border-[var(--app-hint)]'
                                                        }`}
                                                    >
                                                        {codexReasoningEffort === level.id && (
                                                            <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                                        )}
                                                    </div>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className={codexReasoningEffort === level.id ? 'text-[var(--app-link)]' : ''}>
                                                            {level.label}
                                                        </span>
                                                        <span className="text-xs text-[var(--app-hint)]">
                                                            {level.description}
                                                        </span>
                                                        {level.warning ? (
                                                            <span className="text-xs text-amber-500">
                                                                ⚠ {level.warning}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </FloatingOverlay>
                </div>
            )
        }

        if (suggestions.length > 0) {
            return (
                <div className="absolute bottom-[100%] mb-2 w-full">
                    <FloatingOverlay>
                        <Autocomplete
                            suggestions={suggestions}
                            selectedIndex={selectedIndex}
                            onSelect={(index) => handleSuggestionSelect(index)}
                        />
                    </FloatingOverlay>
                </div>
            )
        }

        return null
    }, [
        showSettings,
        showPermissionSettings,
        showModelSettings,
        suggestions,
        selectedIndex,
        controlsDisabled,
        permissionMode,
        modelMode,
        isCodex,
        codexModel,
        codexReasoningEffort,
        shouldShowCodexReasoning,
        isGrok,
        grokModel,
        permissionModes,
        handlePermissionChange,
        handleModelChange,
        handleSuggestionSelect,
        autoOptimize,
        handleAutoOptimizeToggle
    ])

    const volumePercent = Math.max(0, Math.min(100, Math.round((speechToText.volume ?? 0) * 100)))
    const volumeAngle = `${Math.round(volumePercent * 3.6)}deg`
    const meterStyle = {
        ['--stt-progress' as string]: volumeAngle,
        ['--stt-alpha' as string]: speechToText.status === 'recording' ? '1' : '0.15'
    } as ReactCSSProperties

    return (
        <div className={`px-3 ${bottomPaddingClass} pt-2 bg-[var(--app-bg)]`}>
            <div className="mx-auto w-full max-w-content">
                <ComposerPrimitive.Root className="relative">
                    {overlays}
                    {showResumeOverlay ? (
                        <button
                            type="button"
                            disabled={resumePending}
                            onClick={resumePending ? undefined : onRequestResume}
                            className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-[20px] bg-[var(--app-bg)]/80 text-sm font-medium text-[var(--app-hint)] backdrop-blur-sm"
                        >
                            {resumeLabel}
                        </button>
                    ) : null}

                    <StatusBar
                        active={active}
                        thinking={thinking}
                        agentState={agentState}
                        contextSize={contextSize}
                        modelMode={modelMode}
                        permissionMode={permissionMode}
                        agentFlavor={agentFlavor}
                    />

                    <div className="overflow-hidden rounded-[20px] bg-[var(--app-secondary-bg)]">
                        {/* Image Preview Area */}
                        {uploadedImages.length > 0 ? (
                            <div className="flex gap-2 px-3 pt-3 pb-1 overflow-x-auto">
                                {uploadedImages.map((img, index) => (
                                    <div key={img.path} className="relative flex-shrink-0 group">
                                        <img
                                            src={img.previewUrl}
                                            alt={`Upload ${index + 1}`}
                                            className="h-16 w-16 rounded-lg object-cover border border-[var(--app-divider)]"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveImage(index)}
                                            className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-xs shadow-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                                            aria-label="Remove image"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <line x1="18" y1="6" x2="6" y2="18" />
                                                <line x1="6" y1="6" x2="18" y2="18" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}
                                {uploadedImages.length < MAX_IMAGES && !isUploading ? (
                                    <button
                                        type="button"
                                        onClick={handleImageClick}
                                        className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-[var(--app-divider)] text-[var(--app-hint)] hover:border-[var(--app-link)] hover:text-[var(--app-link)] transition-colors"
                                        aria-label="Add more images"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <line x1="12" y1="5" x2="12" y2="19" />
                                            <line x1="5" y1="12" x2="19" y2="12" />
                                        </svg>
                                    </button>
                                ) : null}
                                {isUploading ? (
                                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-[var(--app-link)] text-[var(--app-link)]">
                                        <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                                            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                        </svg>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        <div className="relative flex items-center px-4 py-3">
                            <ComposerPrimitive.Input
                                ref={textareaRef}
                                autoFocus={!controlsDisabled && !isTouch}
                                placeholder={showContinueHint ? "Type 'continue' to resume..." : "Type a message..."}
                                disabled={controlsDisabled || isOptimizing || speechToText.status === 'connecting' || speechToText.status === 'recording' || speechToText.status === 'stopping'}
                                maxRows={5}
                                submitOnEnter={!autoOptimize}
                                cancelOnEscape={false}
                                enterKeyHint="send"
                                onChange={handleChange}
                                onSelect={handleSelect}
                                onKeyDown={handleKeyDown}
                                onSubmit={handleSubmit}
                                className="flex-1 resize-none bg-transparent text-sm leading-snug text-[var(--app-fg)] placeholder-[var(--app-hint)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                            />
                        </div>

                        {voiceMode ? (
                            <div className="px-3 pb-3">
                                <button
                                    type="button"
                                    aria-label={speechToText.status === 'recording' ? 'Release to stop' : 'Hold to talk'}
                                    className={`relative w-full select-none touch-none overflow-hidden rounded-[16px] border px-4 py-4 text-center transition-all duration-150 ${
                                        speechToText.status === 'recording'
                                            ? 'border-red-400 bg-red-500/15 text-red-600 shadow-[0_0_24px_rgba(239,68,68,0.35)]'
                                            : 'border-[var(--app-divider)] bg-[var(--app-bg)]/70 text-[var(--app-hint)]'
                                    } ${speechToText.status === 'stopping' ? 'animate-pulse' : ''}`}
                                    style={{ WebkitTouchCallout: 'none' }}
                                    onTouchStart={handleTouchStart}
                                    onTouchEnd={handleTouchEnd}
                                    onTouchCancel={handleTouchEnd}
                                    onPointerDown={handleVoicePadPointerDown}
                                >
                                    <div
                                        className={`stt-meter ${speechToText.status === 'recording' ? 'stt-meter--active' : ''}`}
                                        style={meterStyle}
                                    />
                                    <div className="flex flex-col items-center gap-2">
                                        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-lg ${
                                            speechToText.status === 'recording'
                                                ? 'bg-red-500 text-white shadow-[0_0_18px_rgba(239,68,68,0.6)]'
                                                : 'bg-[var(--app-secondary-bg)] text-[var(--app-hint)]'
                                        }`}>
                                            🎙️
                                        </span>
                                        <span className="text-sm font-semibold">
                                            {speechToText.status === 'connecting' ? '连接中...' : speechToText.status === 'recording' ? '录音中，松开结束' : '按住说话'}
                                        </span>
                                    </div>
                                </button>
                            </div>
                        ) : null}

                        <ComposerButtons
                            canSend={canSend}
                            controlsDisabled={controlsDisabled}
                            showVoiceButton={speechToText.isSupported}
                            voiceDisabled={controlsDisabled}
                            voiceActive={speechToText.status === 'recording'}
                            voiceStopping={speechToText.status === 'stopping'}
                            voiceModeActive={voiceMode}
                            onVoiceToggle={handleVoiceToggle}
                            showImageButton={active}
                            imageDisabled={controlsDisabled}
                            isUploading={isUploading}
                            onImageClick={handleImageClick}
                            showSettingsButton={showSettingsButton}
                            onSettingsToggle={handleSettingsToggle}
                            showTerminalButton={showTerminalButton}
                            terminalDisabled={controlsDisabled}
                            onTerminal={onTerminal ?? (() => {})}
                            showAbortButton={showAbortButton}
                            abortDisabled={abortDisabled}
                            isAborting={isAborting}
                            onAbort={handleAbort}
                            showSwitchButton={showSwitchButton}
                            switchDisabled={switchDisabled}
                            isSwitching={isSwitching}
                            onSwitch={handleSwitch}
                            autoOptimizeEnabled={autoOptimize}
                            isOptimizing={isOptimizing}
                            onOptimizeSend={handleOptimizeForPreview}
                            hasImages={hasImages}
                            onSendWithImages={handleSendWithImages}
                        />
                        {/* Hidden image input */}
                        <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleImageChange}
                        />
                    </div>
                </ComposerPrimitive.Root>
            </div>

            {/* Optimize Preview Dialog */}
            {optimizePreview ? createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-lg rounded-2xl bg-[var(--app-bg)] p-4 shadow-xl">
                        <div className="mb-4 text-lg font-semibold text-[var(--app-fg)]">
                            AI Optimization Result
                        </div>

                        <div className="mb-4 space-y-3">
                            <div>
                                <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">Original</div>
                                <div className="rounded-lg bg-[var(--app-secondary-bg)] p-3 text-sm text-[var(--app-fg)]/70 line-through">
                                    {optimizePreview.original}
                                </div>
                            </div>
                            <div>
                                <div className="mb-1 text-xs font-medium text-purple-500">Optimized (editable)</div>
                                <textarea
                                    value={optimizePreview.optimized}
                                    onChange={(e) => setOptimizePreview(prev => prev ? { ...prev, optimized: e.target.value } : null)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                            e.preventDefault()
                                            handlePreviewConfirm()
                                        }
                                    }}
                                    autoFocus
                                    rows={3}
                                    className="w-full resize-none rounded-lg bg-purple-50 p-3 text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-purple-500 dark:bg-purple-900/20"
                                />
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={handlePreviewCancel}
                                className="flex-1 rounded-lg border border-[var(--app-divider)] px-4 py-2 text-sm font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handlePreviewSendOriginal}
                                className="flex-1 rounded-lg border border-[var(--app-divider)] px-4 py-2 text-sm font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                            >
                                Send Original
                            </button>
                            <button
                                type="button"
                                onClick={handlePreviewConfirm}
                                className="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
                            >
                                Send
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            ) : null}
        </div>
    )
}
