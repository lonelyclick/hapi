import { ComposerPrimitive } from '@assistant-ui/react'

function SettingsIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    )
}

function SwitchToRemoteIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
    )
}

function TerminalIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="3" y="4" width="18" height="16" rx="2" ry="2" />
            <polyline points="7 9 10 12 7 15" />
            <line x1="12" y1="15" x2="17" y2="15" />
        </svg>
    )
}

function MicIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10a7 7 0 0 1-14 0" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
    )
}

function AbortIcon(props: { spinning: boolean }) {
    if (props.spinning) {
        return (
            <svg
                className="animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
            >
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="0.75" />
            </svg>
        )
    }

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="currentColor"
        >
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4-2.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-4Z" />
        </svg>
    )
}

function SendIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
        </svg>
    )
}

function SparklesIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
            <path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
            <path d="M5 17l0.5 1.5L7 19l-1.5 0.5L5 21l-0.5-1.5L3 19l1.5-0.5L5 17z" />
        </svg>
    )
}

function SpinnerIcon() {
    return (
        <svg
            className="animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
        >
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="0.75" />
        </svg>
    )
}

export function ComposerButtons(props: {
    canSend: boolean
    controlsDisabled: boolean
    showVoiceButton: boolean
    voiceDisabled: boolean
    voiceActive: boolean
    voiceStopping: boolean
    voiceModeActive: boolean
    onVoiceToggle: () => void
    showSettingsButton: boolean
    onSettingsToggle: () => void
    showTerminalButton: boolean
    terminalDisabled: boolean
    onTerminal: () => void
    showAbortButton: boolean
    abortDisabled: boolean
    isAborting: boolean
    onAbort: () => void
    showSwitchButton: boolean
    switchDisabled: boolean
    isSwitching: boolean
    onSwitch: () => void
    canOptimizeSend: boolean
    isOptimizing: boolean
    onOptimizeSend: () => void
}) {
    return (
        <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-1">
                {props.showVoiceButton ? (
                    <button
                        type="button"
                        aria-label={props.voiceModeActive ? 'Exit voice mode' : 'Enable voice mode'}
                        aria-pressed={props.voiceModeActive}
                        title={props.voiceModeActive ? 'Exit voice mode' : 'Enable voice mode'}
                        disabled={props.voiceDisabled || props.controlsDisabled}
                        className={`flex h-8 w-8 touch-none items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-all duration-150 hover:bg-[var(--app-bg)] disabled:cursor-not-allowed disabled:opacity-50 ${
                            props.voiceActive
                                ? 'bg-red-500 text-white ring-2 ring-red-300/70 shadow-[0_0_18px_rgba(239,68,68,0.65)] scale-110'
                                : props.voiceModeActive
                                    ? 'bg-[var(--app-bg)] text-[var(--app-link)] ring-2 ring-[var(--app-link)]/50'
                                    : 'hover:text-[var(--app-fg)]'
                        } ${props.voiceStopping ? 'animate-pulse' : ''}`}
                        onClick={props.onVoiceToggle}
                    >
                        <MicIcon />
                    </button>
                ) : null}

                {props.showSettingsButton ? (
                    <button
                        type="button"
                        aria-label="Settings"
                        title="Settings"
                        className="settings-button flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)]"
                        onClick={props.onSettingsToggle}
                        disabled={props.controlsDisabled}
                    >
                        <SettingsIcon />
                    </button>
                ) : null}

                {props.showTerminalButton ? (
                    <button
                        type="button"
                        aria-label="Terminal"
                        title="Terminal"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={props.onTerminal}
                        disabled={props.terminalDisabled}
                    >
                        <TerminalIcon />
                    </button>
                ) : null}

                {props.showAbortButton ? (
                    <button
                        type="button"
                        aria-label="Abort"
                        title="Abort"
                        disabled={props.abortDisabled}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={props.onAbort}
                    >
                        <AbortIcon spinning={props.isAborting} />
                    </button>
                ) : null}

                {props.showSwitchButton ? (
                    <button
                        type="button"
                        aria-label="Switch to remote"
                        title="Switch to remote mode"
                        disabled={props.switchDisabled}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={props.onSwitch}
                    >
                        <SwitchToRemoteIcon />
                    </button>
                ) : null}
            </div>

            <div className="flex items-center gap-1">
                <button
                    type="button"
                    disabled={props.controlsDisabled || !props.canOptimizeSend || props.isOptimizing}
                    aria-label="Optimize and send"
                    title="AI 优化并发送"
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                        props.canOptimizeSend && !props.controlsDisabled && !props.isOptimizing
                            ? 'bg-purple-600 text-white hover:bg-purple-700'
                            : 'bg-[#C0C0C0] text-white'
                    } disabled:cursor-not-allowed`}
                    onClick={props.onOptimizeSend}
                >
                    {props.isOptimizing ? <SpinnerIcon /> : <SparklesIcon />}
                </button>

                <ComposerPrimitive.Send
                    disabled={props.controlsDisabled || !props.canSend}
                    aria-label="Send"
                    title="Send"
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                        props.canSend && !props.controlsDisabled
                            ? 'bg-black text-white'
                            : 'bg-[#C0C0C0] text-white'
                    } disabled:cursor-not-allowed`}
                >
                    <SendIcon />
                </ComposerPrimitive.Send>
            </div>
        </div>
    )
}
