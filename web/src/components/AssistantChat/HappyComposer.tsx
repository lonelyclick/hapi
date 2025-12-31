import { ComposerPrimitive, useAssistantApi, useAssistantState } from '@assistant-ui/react'
import {
    type ChangeEvent as ReactChangeEvent,
    type CSSProperties as ReactCSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type SyntheticEvent as ReactSyntheticEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react'
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

function isCodexModel(mode: ModelMode | undefined): mode is typeof CODEX_MODELS[number]['id'] {
    return Boolean(mode && CODEX_MODEL_IDS.has(mode as typeof CODEX_MODELS[number]['id']))
}

const CODEX_REASONING_LEVELS = [
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
    onPermissionModeChange?: (mode: PermissionMode) => void
    onModelModeChange?: (config: { model: ModelMode; reasoningEffort?: ModelReasoningEffort | null }) => void
    onSwitchToRemote?: () => void
    onTerminal?: () => void
    autocompletePrefixes?: string[]
    autocompleteSuggestions?: (query: string) => Promise<Suggestion[]>
}) {
    const {
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
        onPermissionModeChange,
        onModelModeChange,
        onSwitchToRemote,
        onTerminal,
        autocompletePrefixes = ['@', '/'],
        autocompleteSuggestions = defaultSuggestionHandler
    } = props

    // Use ?? so missing values fall back to default (destructuring defaults only handle undefined)
    const permissionMode = rawPermissionMode ?? 'default'
    const modelMode = rawModelMode ?? 'default'

    const assistantApi = useAssistantApi()
    const composerText = useAssistantState(({ composer }) => composer.text)
    const threadIsRunning = useAssistantState(({ thread }) => thread.isRunning)
    const threadIsDisabled = useAssistantState(({ thread }) => thread.isDisabled)

    const controlsDisabled = disabled || !active || threadIsDisabled
    const trimmed = composerText.trim()
    const hasText = trimmed.length > 0
    const canSend = hasText && !controlsDisabled && !threadIsRunning

    const [inputState, setInputState] = useState<TextInputState>({
        text: '',
        selection: { start: 0, end: 0 }
    })
    const [showSettings, setShowSettings] = useState(false)
    const [isAborting, setIsAborting] = useState(false)
    const [isSwitching, setIsSwitching] = useState(false)
    const [showContinueHint, setShowContinueHint] = useState(false)
    const [voiceMode, setVoiceMode] = useState(false)

    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const prevControlledByUser = useRef(controlledByUser)
    const sttPrefixRef = useRef<string>('')

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
    const bottomPaddingClass = isIOSPWA ? 'pb-0' : 'pb-3'
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
        haptic
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
    }, [])

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

    const showPermissionSettings = Boolean(onPermissionModeChange && permissionModes.length > 0)
    const showModelSettings = Boolean(onModelModeChange && agentFlavor !== 'gemini')
    const showSettingsButton = Boolean(showPermissionSettings || showModelSettings)
    const showAbortButton = true
    const isCodex = agentFlavor === 'codex'
    const codexModel = isCodex && isCodexModel(modelMode) ? modelMode : 'gpt-5.2-codex'
    const codexReasoningEffort: ModelReasoningEffort = modelReasoningEffort ?? 'medium'
    const shouldShowCodexReasoning = isCodex && codexModel === 'gpt-5.2-codex'
    const speechToText = useSpeechToText({
        api: props.apiClient,
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
        if (speechToText.status === 'recording' || speechToText.status === 'stopping') return
        const spacer = composerText && !/\s$/.test(composerText) ? ' ' : ''
        sttPrefixRef.current = `${composerText}${spacer}`
        await speechToText.start()
    }, [composerText, controlsDisabled, speechToText])

    const handleVoicePressEnd = useCallback(() => {
        if (speechToText.status === 'recording') {
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

    // Track active pointer to handle iOS touch properly
    const activePointerRef = useRef<number | null>(null)

    const handleVoicePadPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!voiceMode || controlsDisabled) return
        // Skip if stopping, but allow if already idle (in case state is stuck)
        if (speechToText.status === 'stopping') return
        // Prevent duplicate pointer captures
        if (activePointerRef.current !== null) return

        event.preventDefault()
        activePointerRef.current = event.pointerId

        // Don't use setPointerCapture on iOS - it causes issues
        console.log('[stt] pointer down', {
            voiceMode,
            status: speechToText.status,
            pointerId: event.pointerId
        })
        handleVoicePressStart().catch(() => {})
    }, [voiceMode, controlsDisabled, speechToText.status, handleVoicePressStart])

    const handleVoicePadPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!voiceMode || controlsDisabled) return
        // Only handle the pointer that started the interaction
        if (activePointerRef.current !== event.pointerId) return

        event.preventDefault()
        activePointerRef.current = null

        console.log('[stt] pointer up', {
            voiceMode,
            status: speechToText.status,
            pointerId: event.pointerId
        })
        handleVoicePressEnd()
    }, [voiceMode, controlsDisabled, speechToText.status, handleVoicePressEnd])

    const handleVoicePadPointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!voiceMode) return
        // Only handle the pointer that started the interaction
        if (activePointerRef.current !== event.pointerId) return

        event.preventDefault()
        activePointerRef.current = null

        console.log('[stt] pointer cancel', {
            voiceMode,
            status: speechToText.status,
            pointerId: event.pointerId
        })
        handleVoicePressEnd()
    }, [voiceMode, speechToText.status, handleVoicePressEnd])

    useEffect(() => {
        if (!voiceMode) {
            activePointerRef.current = null
            return
        }
        if (!active && speechToText.status === 'recording') {
            speechToText.stop()
        }
    }, [active, speechToText, voiceMode])

    const overlays = useMemo(() => {
        if (showSettings && (showPermissionSettings || showModelSettings)) {
            return (
                <div className="absolute bottom-[100%] mb-2 w-full">
                    <FloatingOverlay maxHeight={320}>
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
        permissionModes,
        handlePermissionChange,
        handleModelChange,
        handleSuggestionSelect
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
                        <div className="relative flex items-center px-4 py-3">
                            <ComposerPrimitive.Input
                                ref={textareaRef}
                                autoFocus={!controlsDisabled && !isTouch}
                                placeholder={showContinueHint ? "Type 'continue' to resume..." : "Type a message..."}
                                disabled={controlsDisabled || speechToText.status === 'recording' || speechToText.status === 'stopping'}
                                maxRows={5}
                                submitOnEnter
                                cancelOnEscape={false}
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
                                    onPointerDown={handleVoicePadPointerDown}
                                    onPointerUp={handleVoicePadPointerUp}
                                    onPointerCancel={handleVoicePadPointerCancel}
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
                                            {speechToText.status === 'recording' ? '录音中，松开结束' : '按住说话'}
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
                        />
                    </div>
                </ComposerPrimitive.Root>
            </div>
        </div>
    )
}
