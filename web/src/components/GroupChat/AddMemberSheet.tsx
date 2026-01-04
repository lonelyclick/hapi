import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentGroupMember, SessionSummary } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Spinner } from '@/components/Spinner'

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

function getAgentFromSession(session: SessionSummary): string | null {
    return session.metadata?.runtimeAgent || session.metadata?.flavor || null
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

function CheckIcon(props: { className?: string }) {
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
            className={props.className}
        >
            <polyline points="20 6 9 17 4 12" />
        </svg>
    )
}

type AddMemberSheetProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    existingMembers: AgentGroupMember[]
    onAddMembers: (sessions: Array<{ sessionId: string; agentType?: string }>) => Promise<void>
}

export function AddMemberSheet(props: AddMemberSheetProps) {
    const { open, onOpenChange, existingMembers, onAddMembers } = props
    const { api } = useAppContext()
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [isAdding, setIsAdding] = useState(false)

    // Fetch available sessions
    const { data: sessionsData, isLoading } = useQuery({
        queryKey: ['sessions-for-group'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getSessions()
        },
        enabled: Boolean(api && open)
    })

    // Filter out already existing members
    const existingMemberIds = useMemo(() => {
        return new Set(existingMembers.map(m => m.sessionId))
    }, [existingMembers])

    const availableSessions = useMemo(() => {
        if (!sessionsData?.sessions) return []
        return sessionsData.sessions.filter(s => !existingMemberIds.has(s.id))
    }, [sessionsData?.sessions, existingMemberIds])

    const toggleSession = (sessionId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(sessionId)) {
                next.delete(sessionId)
            } else {
                next.add(sessionId)
            }
            return next
        })
    }

    const handleAdd = async () => {
        if (selectedIds.size === 0) return

        setIsAdding(true)
        try {
            const sessionsToAdd = availableSessions
                .filter(s => selectedIds.has(s.id))
                .map(s => ({
                    sessionId: s.id,
                    agentType: getAgentFromSession(s) || undefined
                }))
            await onAddMembers(sessionsToAdd)
            setSelectedIds(new Set())
            onOpenChange(false)
        } finally {
            setIsAdding(false)
        }
    }

    const handleClose = () => {
        setSelectedIds(new Set())
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader className="flex-shrink-0 flex flex-row items-center justify-between pr-2">
                    <DialogTitle>添加成员</DialogTitle>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="h-8 w-8 flex items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] transition-colors"
                    >
                        <CloseIcon />
                    </button>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto min-h-0 mt-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Spinner className="w-6 h-6" />
                        </div>
                    ) : availableSessions.length === 0 ? (
                        <div className="text-center py-8 text-[var(--app-hint)] text-sm">
                            没有可添加的会话
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {availableSessions.map((session) => {
                                const agentType = getAgentFromSession(session)
                                const agentColor = getAgentColor(agentType)
                                const agentIcon = getAgentIcon(agentType)
                                const displayName = session.metadata?.name || session.id.slice(0, 8)
                                const isSelected = selectedIds.has(session.id)

                                return (
                                    <button
                                        key={session.id}
                                        type="button"
                                        onClick={() => toggleSession(session.id)}
                                        className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors ${
                                            isSelected
                                                ? 'bg-[var(--app-link)]/10'
                                                : 'hover:bg-[var(--app-bg)]'
                                        }`}
                                    >
                                        {/* Checkbox */}
                                        <div
                                            className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                                isSelected
                                                    ? 'bg-[var(--app-link)] border-[var(--app-link)]'
                                                    : 'border-[var(--app-hint)]'
                                            }`}
                                        >
                                            {isSelected && <CheckIcon className="text-white" />}
                                        </div>

                                        {/* Avatar */}
                                        <div className="relative flex-shrink-0">
                                            <div
                                                className={`w-10 h-10 rounded-full ${agentColor} flex items-center justify-center text-white text-sm font-medium`}
                                            >
                                                {agentIcon}
                                            </div>
                                            <div
                                                className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--app-secondary-bg)] ${
                                                    session.active ? 'bg-emerald-500' : 'bg-gray-400'
                                                }`}
                                            />
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0 text-left">
                                            <div className="font-medium text-sm truncate">{displayName}</div>
                                            <div className="text-xs text-[var(--app-hint)] truncate">
                                                {session.metadata?.path || session.id}
                                            </div>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Add Button */}
                <div className="flex-shrink-0 pt-4 border-t border-[var(--app-divider)]">
                    <button
                        type="button"
                        onClick={handleAdd}
                        disabled={selectedIds.size === 0 || isAdding}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[var(--app-link)] text-white font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                        {isAdding ? (
                            <>
                                <Spinner className="w-4 h-4" />
                                添加中...
                            </>
                        ) : (
                            <>添加 {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}</>
                        )}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
