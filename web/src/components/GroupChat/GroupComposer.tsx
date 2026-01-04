import { useCallback, useRef, useState } from 'react'
import { usePWAInstall } from '@/hooks/usePWAInstall'

function SendIcon(props: { className?: string }) {
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
            className={props.className}
        >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
    )
}

type GroupComposerProps = {
    disabled?: boolean
    isSending?: boolean
    onSend: (content: string) => void
    placeholder?: string
}

export function GroupComposer(props: GroupComposerProps) {
    const { disabled = false, isSending = false, onSend, placeholder = '发送消息...' } = props
    const [text, setText] = useState('')
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const { isStandalone, isIOS } = usePWAInstall()
    const isIOSPWA = isIOS && isStandalone
    const bottomPaddingClass = isIOSPWA ? 'pb-[max(env(safe-area-inset-bottom),0.75rem)]' : 'pb-3'

    const trimmed = text.trim()
    const canSend = trimmed.length > 0 && !disabled && !isSending

    const handleSubmit = useCallback((e?: React.FormEvent) => {
        e?.preventDefault()
        if (!canSend) return

        onSend(trimmed)
        setText('')

        // Reset textarea height
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
        }
    }, [canSend, trimmed, onSend])

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            handleSubmit()
        }
    }, [handleSubmit])

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setText(e.target.value)

        // Auto-resize textarea
        const textarea = e.target
        textarea.style.height = 'auto'
        textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
    }, [])

    return (
        <div className={`px-3 ${bottomPaddingClass} pt-2 bg-[var(--app-bg)] border-t border-[var(--app-divider)]`}>
            <div className="mx-auto w-full max-w-content">
                <form onSubmit={handleSubmit} className="flex items-end gap-2">
                    {/* Text input */}
                    <div className="flex-1 overflow-hidden rounded-[20px] bg-[var(--app-secondary-bg)]">
                        <textarea
                            ref={textareaRef}
                            value={text}
                            onChange={handleChange}
                            onKeyDown={handleKeyDown}
                            placeholder={placeholder}
                            disabled={disabled}
                            rows={1}
                            className="w-full resize-none bg-transparent px-4 py-3 text-sm leading-snug text-[var(--app-fg)] placeholder-[var(--app-hint)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                            style={{ maxHeight: '120px' }}
                        />
                    </div>

                    {/* Send button */}
                    <button
                        type="submit"
                        disabled={!canSend}
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
                            canSend
                                ? 'bg-[var(--app-link)] text-white hover:opacity-90'
                                : 'bg-[var(--app-secondary-bg)] text-[var(--app-hint)]'
                        } disabled:cursor-not-allowed`}
                    >
                        {isSending ? (
                            <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                        ) : (
                            <SendIcon />
                        )}
                    </button>
                </form>

                {/* Future: @mention hint */}
                {/* <div className="mt-1 text-[10px] text-[var(--app-hint)]">
                    使用 @ 提及特定成员
                </div> */}
            </div>
        </div>
    )
}
