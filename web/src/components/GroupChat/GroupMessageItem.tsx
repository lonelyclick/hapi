import { useMemo } from 'react'
import type { AgentGroupMessage } from '@/types/api'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'

const AGENT_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    claude: { bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-800' },
    codex: { bg: 'bg-green-50 dark:bg-green-950/30', text: 'text-green-600 dark:text-green-400', border: 'border-green-200 dark:border-green-800' },
    gemini: { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800' },
    grok: { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800' },
    glm: { bg: 'bg-cyan-50 dark:bg-cyan-950/30', text: 'text-cyan-600 dark:text-cyan-400', border: 'border-cyan-200 dark:border-cyan-800' },
    minimax: { bg: 'bg-pink-50 dark:bg-pink-950/30', text: 'text-pink-600 dark:text-pink-400', border: 'border-pink-200 dark:border-pink-800' },
    openrouter: { bg: 'bg-indigo-50 dark:bg-indigo-950/30', text: 'text-indigo-600 dark:text-indigo-400', border: 'border-indigo-200 dark:border-indigo-800' }
}

const USER_COLORS = {
    bg: 'bg-[var(--app-link)]/10',
    text: 'text-[var(--app-link)]',
    border: 'border-[var(--app-link)]/20'
}

const SYSTEM_COLORS = {
    bg: 'bg-gray-50 dark:bg-gray-800/50',
    text: 'text-gray-600 dark:text-gray-400',
    border: 'border-gray-200 dark:border-gray-700'
}

const AGENT_AVATAR_COLORS: Record<string, string> = {
    claude: 'bg-purple-500',
    codex: 'bg-green-500',
    gemini: 'bg-blue-500',
    grok: 'bg-orange-500',
    glm: 'bg-cyan-500',
    minimax: 'bg-pink-500',
    openrouter: 'bg-indigo-500'
}

function getAgentAvatarColor(senderName: string | undefined): string {
    if (!senderName) return 'bg-gray-500'
    const lowerName = senderName.toLowerCase()
    for (const [key, color] of Object.entries(AGENT_AVATAR_COLORS)) {
        if (lowerName.includes(key)) return color
    }
    return 'bg-gray-500'
}

function getAgentIcon(senderName: string | undefined): string {
    if (!senderName) return 'A'
    const lowerName = senderName.toLowerCase()
    const icons: Record<string, string> = {
        claude: 'C',
        codex: 'X',
        gemini: 'G',
        grok: 'K',
        glm: 'Z',
        minimax: 'M',
        openrouter: 'O'
    }
    for (const [key, icon] of Object.entries(icons)) {
        if (lowerName.includes(key)) return icon
    }
    return senderName.charAt(0).toUpperCase()
}

function getColors(message: AgentGroupMessage): { bg: string; text: string; border: string } {
    if (message.senderType === 'user') {
        return USER_COLORS
    }
    if (message.senderType === 'system') {
        return SYSTEM_COLORS
    }
    // Agent - try to detect type from senderName
    const senderName = message.senderName?.toLowerCase() || ''
    for (const [key, colors] of Object.entries(AGENT_TYPE_COLORS)) {
        if (senderName.includes(key)) {
            return colors
        }
    }
    return { bg: 'bg-gray-50 dark:bg-gray-800/50', text: 'text-gray-600 dark:text-gray-400', border: 'border-gray-200 dark:border-gray-700' }
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
    })
}

type GroupMessageItemProps = {
    message: AgentGroupMessage
    isFromCurrentUser?: boolean
}

export function GroupMessageItem(props: GroupMessageItemProps) {
    const { message, isFromCurrentUser = false } = props
    const isUser = message.senderType === 'user'
    const isSystem = message.senderType === 'system'

    const colors = useMemo(() => getColors(message), [message])
    const avatarColor = useMemo(() => {
        if (isUser) return 'bg-[var(--app-link)]'
        if (isSystem) return 'bg-gray-500'
        return getAgentAvatarColor(message.senderName)
    }, [isUser, isSystem, message.senderName])

    const avatarIcon = useMemo(() => {
        if (isUser) return 'U'
        if (isSystem) return 'S'
        return getAgentIcon(message.senderName)
    }, [isUser, isSystem, message.senderName])

    const displayName = useMemo(() => {
        if (isUser) return isFromCurrentUser ? 'You' : 'User'
        if (isSystem) return 'System'
        return message.senderName || 'Agent'
    }, [isUser, isSystem, isFromCurrentUser, message.senderName])

    // System messages are centered and smaller
    if (isSystem) {
        return (
            <div className="flex justify-center py-2">
                <div className="px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400">
                    {message.content}
                </div>
            </div>
        )
    }

    // User messages aligned right, agent messages aligned left
    const alignRight = isUser

    return (
        <div className={`flex gap-2 py-2 ${alignRight ? 'flex-row-reverse' : ''}`}>
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-full ${avatarColor} flex items-center justify-center text-white text-xs font-medium shrink-0`}>
                {avatarIcon}
            </div>

            {/* Message bubble */}
            <div className={`flex flex-col gap-1 max-w-[75%] ${alignRight ? 'items-end' : 'items-start'}`}>
                {/* Sender name + time */}
                <div className={`flex items-center gap-2 text-[10px] ${colors.text}`}>
                    <span className="font-medium">{displayName}</span>
                    <span className="text-[var(--app-hint)]">{formatTime(message.createdAt)}</span>
                </div>

                {/* Content */}
                <div className={`px-3 py-2 rounded-2xl border ${colors.bg} ${colors.border} text-sm`}>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                        <MarkdownRenderer content={message.content} />
                    </div>
                </div>

                {/* Message type badge for task/feedback/decision */}
                {message.messageType !== 'chat' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${colors.bg} ${colors.text}`}>
                        {message.messageType === 'task' ? '任务' :
                         message.messageType === 'feedback' ? '反馈' :
                         message.messageType === 'decision' ? '决策' : message.messageType}
                    </span>
                )}
            </div>
        </div>
    )
}
