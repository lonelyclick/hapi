import { useMemo } from 'react'
import type { AgentGroup, AgentGroupMember } from '@/types/api'

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

const AGENT_TYPE_COLORS: Record<string, string> = {
    claude: 'bg-purple-500',
    codex: 'bg-green-500',
    gemini: 'bg-blue-500',
    grok: 'bg-orange-500',
    glm: 'bg-cyan-500',
    minimax: 'bg-pink-500',
    openrouter: 'bg-indigo-500'
}

const AGENT_TYPE_ICONS: Record<string, string> = {
    claude: 'C',
    codex: 'X',
    gemini: 'G',
    grok: 'K',
    glm: 'Z',
    minimax: 'M',
    openrouter: 'O'
}

function getAgentColor(agentType: string | null | undefined): string {
    if (!agentType) return 'bg-gray-500'
    const lowerType = agentType.toLowerCase()
    for (const [key, color] of Object.entries(AGENT_TYPE_COLORS)) {
        if (lowerType.includes(key)) return color
    }
    return 'bg-gray-500'
}

function getAgentIcon(agentType: string | null | undefined): string {
    if (!agentType) return 'A'
    const lowerType = agentType.toLowerCase()
    for (const [key, icon] of Object.entries(AGENT_TYPE_ICONS)) {
        if (lowerType.includes(key)) return icon
    }
    return agentType.charAt(0).toUpperCase()
}

type GroupChatHeaderProps = {
    group: AgentGroup
    members: AgentGroupMember[]
    onBack: () => void
}

export function GroupChatHeader(props: GroupChatHeaderProps) {
    const { group, members, onBack } = props

    const sortedMembers = useMemo(() => {
        return [...members].sort((a, b) => {
            // Sort by active status first
            if (a.sessionActive !== b.sessionActive) {
                return a.sessionActive ? -1 : 1
            }
            // Then by role
            const roleOrder = { owner: 0, moderator: 1, member: 2 }
            return (roleOrder[a.role] ?? 2) - (roleOrder[b.role] ?? 2)
        })
    }, [members])

    return (
        <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)] pt-[env(safe-area-inset-top)]">
            <div className="mx-auto w-full max-w-content px-3 py-2">
                {/* Top row: Back + Title */}
                <div className="flex items-center gap-2 mb-2">
                    <button
                        type="button"
                        onClick={onBack}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{group.name}</div>
                        <div className="text-[10px] text-[var(--app-hint)]">
                            {members.length} 成员
                        </div>
                    </div>
                </div>

                {/* Members row */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mb-1">
                    {/* User avatar */}
                    <div className="flex flex-col items-center gap-0.5 shrink-0 min-w-[48px]">
                        <div className="relative">
                            <div className="w-8 h-8 rounded-full bg-[var(--app-link)] flex items-center justify-center text-white text-xs font-medium">
                                U
                            </div>
                            <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[var(--app-bg)]" />
                        </div>
                        <span className="text-[10px] text-[var(--app-hint)] truncate max-w-[48px]">
                            You
                        </span>
                    </div>

                    {/* Member avatars */}
                    {sortedMembers.map((member) => {
                        const agentColor = getAgentColor(member.agentType)
                        const agentIcon = getAgentIcon(member.agentType)
                        const displayName = member.sessionName || member.sessionId.slice(0, 6)

                        return (
                            <div
                                key={member.sessionId}
                                className="flex flex-col items-center gap-0.5 shrink-0 min-w-[48px]"
                            >
                                <div className="relative">
                                    <div
                                        className={`w-8 h-8 rounded-full ${agentColor} flex items-center justify-center text-white text-xs font-medium`}
                                    >
                                        {agentIcon}
                                    </div>
                                    <div
                                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[var(--app-bg)] ${
                                            member.sessionActive ? 'bg-emerald-500' : 'bg-gray-400'
                                        }`}
                                    />
                                </div>
                                <span className="text-[10px] text-[var(--app-hint)] truncate max-w-[48px]">
                                    {displayName}
                                </span>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
