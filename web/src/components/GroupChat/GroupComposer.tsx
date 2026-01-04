import { useCallback, useRef, useState, useMemo, useEffect } from 'react'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import type { AgentGroupMember } from '@/types/api'

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

/**
 * 从文本中提取 @提及
 * 支持格式: @claude, @gemini, @all
 */
function extractMentions(text: string): string[] {
    const mentionPattern = /@(\w+)/g
    const mentions: string[] = []
    let match
    while ((match = mentionPattern.exec(text)) !== null) {
        mentions.push(match[1].toLowerCase())
    }
    return [...new Set(mentions)] // 去重
}

type GroupComposerProps = {
    disabled?: boolean
    isSending?: boolean
    onSend: (content: string, mentions?: string[]) => void
    placeholder?: string
    members?: AgentGroupMember[]
}

export function GroupComposer(props: GroupComposerProps) {
    const { disabled = false, isSending = false, onSend, placeholder = '发送消息...', members = [] } = props
    const [text, setText] = useState('')
    const [showMentionMenu, setShowMentionMenu] = useState(false)
    const [mentionFilter, setMentionFilter] = useState('')
    const [mentionIndex, setMentionIndex] = useState(0)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const mentionMenuRef = useRef<HTMLDivElement>(null)

    const { isStandalone, isIOS } = usePWAInstall()
    const isIOSPWA = isIOS && isStandalone
    const bottomPaddingClass = isIOSPWA ? 'pb-[max(env(safe-area-inset-bottom),0.75rem)]' : 'pb-3'

    const trimmed = text.trim()
    const canSend = trimmed.length > 0 && !disabled && !isSending

    // 获取唯一的 agentType 列表用于 @ 提及
    const mentionOptions = useMemo(() => {
        const types = new Set<string>()
        members.forEach(m => {
            const agentType = m.agentType || 'unknown'
            types.add(agentType.toLowerCase())
        })
        const options = [{ label: '@all', value: 'all', description: '所有成员' }]
        types.forEach(t => {
            options.push({ label: `@${t}`, value: t, description: t })
        })
        return options
    }, [members])

    // 过滤后的提及选项
    const filteredMentionOptions = useMemo(() => {
        if (!mentionFilter) return mentionOptions
        return mentionOptions.filter(o =>
            o.value.toLowerCase().includes(mentionFilter.toLowerCase())
        )
    }, [mentionOptions, mentionFilter])

    // 处理 @ 提及选择
    const handleMentionSelect = useCallback((value: string) => {
        const textarea = textareaRef.current
        if (!textarea) return

        // 找到最后一个 @ 的位置
        const cursorPos = textarea.selectionStart
        const textBeforeCursor = text.slice(0, cursorPos)
        const lastAtIndex = textBeforeCursor.lastIndexOf('@')

        if (lastAtIndex !== -1) {
            const newText = text.slice(0, lastAtIndex) + `@${value} ` + text.slice(cursorPos)
            setText(newText)

            // 重新设置光标位置
            setTimeout(() => {
                const newCursorPos = lastAtIndex + value.length + 2
                textarea.setSelectionRange(newCursorPos, newCursorPos)
                textarea.focus()
            }, 0)
        }

        setShowMentionMenu(false)
        setMentionFilter('')
        setMentionIndex(0)
    }, [text])

    const handleSubmit = useCallback((e?: React.FormEvent) => {
        e?.preventDefault()
        if (!canSend) return

        const mentions = extractMentions(trimmed)
        onSend(trimmed, mentions.length > 0 ? mentions : undefined)
        setText('')

        // Reset textarea height
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
        }
    }, [canSend, trimmed, onSend])

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // 处理 @ 提及菜单导航
        if (showMentionMenu && filteredMentionOptions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMentionIndex(i => (i + 1) % filteredMentionOptions.length)
                return
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMentionIndex(i => (i - 1 + filteredMentionOptions.length) % filteredMentionOptions.length)
                return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                handleMentionSelect(filteredMentionOptions[mentionIndex].value)
                return
            }
            if (e.key === 'Escape') {
                e.preventDefault()
                setShowMentionMenu(false)
                return
            }
        }

        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            handleSubmit()
        }
    }, [handleSubmit, showMentionMenu, filteredMentionOptions, mentionIndex, handleMentionSelect])

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value
        setText(newValue)

        // 检测是否正在输入 @
        const cursorPos = e.target.selectionStart
        const textBeforeCursor = newValue.slice(0, cursorPos)
        const lastAtIndex = textBeforeCursor.lastIndexOf('@')

        if (lastAtIndex !== -1) {
            const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
            // 如果 @ 后面没有空格，显示提及菜单
            if (!/\s/.test(textAfterAt)) {
                setShowMentionMenu(true)
                setMentionFilter(textAfterAt)
                setMentionIndex(0)
            } else {
                setShowMentionMenu(false)
            }
        } else {
            setShowMentionMenu(false)
        }

        // Auto-resize textarea
        const textarea = e.target
        textarea.style.height = 'auto'
        textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
    }, [])

    // 点击外部关闭提及菜单
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (mentionMenuRef.current && !mentionMenuRef.current.contains(e.target as Node)) {
                setShowMentionMenu(false)
            }
        }
        if (showMentionMenu) {
            document.addEventListener('mousedown', handleClickOutside)
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [showMentionMenu])

    return (
        <div className={`px-3 ${bottomPaddingClass} pt-2 bg-[var(--app-bg)] border-t border-[var(--app-divider)] relative`}>
            <div className="mx-auto w-full max-w-content">
                {/* @ 提及自动补全菜单 */}
                {showMentionMenu && filteredMentionOptions.length > 0 && (
                    <div
                        ref={mentionMenuRef}
                        className="absolute bottom-full left-3 right-3 mb-1 max-h-48 overflow-y-auto rounded-lg bg-[var(--app-secondary-bg)] border border-[var(--app-divider)] shadow-lg"
                    >
                        {filteredMentionOptions.map((option, index) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => handleMentionSelect(option.value)}
                                className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${
                                    index === mentionIndex
                                        ? 'bg-[var(--app-link)] text-white'
                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-bg)]'
                                }`}
                            >
                                <span className="font-medium">{option.label}</span>
                                {option.value === 'all' && (
                                    <span className={`text-xs ${index === mentionIndex ? 'text-white/70' : 'text-[var(--app-hint)]'}`}>
                                        ({option.description})
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                )}

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

                {/* @mention hint */}
                {members.length > 0 && (
                    <div className="mt-1 text-[10px] text-[var(--app-hint)]">
                        使用 @ 提及特定成员 (如 @claude, @gemini, @all)
                    </div>
                )}
            </div>
        </div>
    )
}
