import { useState } from 'react'
import type { AgentGroup, AgentGroupMember } from '@/types/api'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'

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

function CloseIcon(props: { className?: string }) {
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

function TrashIcon(props: { className?: string }) {
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
            className={props.className}
        >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    )
}

function PlusIcon(props: { className?: string }) {
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
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

type GroupMembersSheetProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    group: AgentGroup
    members: AgentGroupMember[]
    onRemoveMember: (sessionId: string) => Promise<void>
    onAddMemberClick: () => void
}

export function GroupMembersSheet(props: GroupMembersSheetProps) {
    const { open, onOpenChange, group, members, onRemoveMember, onAddMemberClick } = props
    const [removingId, setRemovingId] = useState<string | null>(null)

    const handleRemove = async (sessionId: string) => {
        setRemovingId(sessionId)
        try {
            await onRemoveMember(sessionId)
        } finally {
            setRemovingId(null)
        }
    }

    const sortedMembers = [...members].sort((a, b) => {
        // Sort by role first (owner first)
        const roleOrder = { owner: 0, moderator: 1, member: 2 }
        const roleCompare = (roleOrder[a.role] ?? 2) - (roleOrder[b.role] ?? 2)
        if (roleCompare !== 0) return roleCompare
        // Then by active status
        if (a.sessionActive !== b.sessionActive) {
            return a.sessionActive ? -1 : 1
        }
        return 0
    })

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader className="flex-shrink-0 flex flex-row items-center justify-between pr-2">
                    <DialogTitle>{group.name} - 成员管理</DialogTitle>
                    <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="h-8 w-8 flex items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] transition-colors"
                    >
                        <CloseIcon />
                    </button>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto min-h-0 mt-4">
                    {/* User (You) */}
                    <div className="flex items-center gap-3 p-2 rounded-lg">
                        <div className="relative flex-shrink-0">
                            <div className="w-10 h-10 rounded-full bg-[var(--app-link)] flex items-center justify-center text-white text-sm font-medium">
                                U
                            </div>
                            <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[var(--app-secondary-bg)]" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">You</div>
                            <div className="text-xs text-[var(--app-hint)]">owner</div>
                        </div>
                    </div>

                    {/* AI Members */}
                    {sortedMembers.map((member) => {
                        const agentColor = getAgentColor(member.agentType)
                        const agentIcon = getAgentIcon(member.agentType)
                        const displayName = member.sessionName || member.sessionId.slice(0, 8)
                        const isRemoving = removingId === member.sessionId
                        const canRemove = member.role !== 'owner'

                        return (
                            <div
                                key={member.sessionId}
                                className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--app-bg)] transition-colors"
                            >
                                <div className="relative flex-shrink-0">
                                    <div
                                        className={`w-10 h-10 rounded-full ${agentColor} flex items-center justify-center text-white text-sm font-medium`}
                                    >
                                        {agentIcon}
                                    </div>
                                    <div
                                        className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--app-secondary-bg)] ${
                                            member.sessionActive ? 'bg-emerald-500' : 'bg-gray-400'
                                        }`}
                                    />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm truncate">{displayName}</div>
                                    <div className="text-xs text-[var(--app-hint)] flex items-center gap-1">
                                        <span>{member.role}</span>
                                        {member.agentType && (
                                            <>
                                                <span>·</span>
                                                <span>{member.agentType}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {canRemove && (
                                    <button
                                        type="button"
                                        onClick={() => handleRemove(member.sessionId)}
                                        disabled={isRemoving}
                                        className="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded-full text-red-500 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                                    >
                                        {isRemoving ? (
                                            <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                            <TrashIcon />
                                        )}
                                    </button>
                                )}
                            </div>
                        )
                    })}
                </div>

                {/* Add Member Button */}
                <div className="flex-shrink-0 pt-4 border-t border-[var(--app-divider)]">
                    <button
                        type="button"
                        onClick={onAddMemberClick}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[var(--app-link)] text-white font-medium text-sm hover:opacity-90 transition-opacity"
                    >
                        <PlusIcon />
                        添加成员
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
