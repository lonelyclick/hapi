import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentGroupMember, SessionSummary, SpawnAgentType, Machine, GroupMemberRole } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Spinner } from '@/components/Spinner'

const SPAWN_AGENT_TYPES: { value: SpawnAgentType; label: string; color: string }[] = [
    { value: 'claude', label: 'Claude', color: 'bg-purple-500' },
    { value: 'codex', label: 'Codex', color: 'bg-green-500' },
    { value: 'gemini', label: 'Gemini', color: 'bg-blue-500' },
    { value: 'grok', label: 'Grok', color: 'bg-orange-500' },
    { value: 'glm', label: 'GLM', color: 'bg-cyan-500' },
    { value: 'minimax', label: 'Minimax', color: 'bg-pink-500' },
    { value: 'openrouter', label: 'OpenRouter', color: 'bg-indigo-500' }
]

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

type TabType = 'existing' | 'spawn'

type AddMemberSheetProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    groupId: string
    existingMembers: AgentGroupMember[]
    onAddMembers: (sessions: Array<{ sessionId: string; agentType?: string }>) => Promise<void>
    onSpawnMember?: () => void
}

export function AddMemberSheet(props: AddMemberSheetProps) {
    const { open, onOpenChange, groupId, existingMembers, onAddMembers, onSpawnMember } = props
    const { api } = useAppContext()
    const [activeTab, setActiveTab] = useState<TabType>('existing')
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [isAdding, setIsAdding] = useState(false)

    // Spawn new agent state
    const [selectedMachineId, setSelectedMachineId] = useState<string>('')
    const [selectedAgentType, setSelectedAgentType] = useState<SpawnAgentType>('claude')
    const [directory, setDirectory] = useState<string>('')
    const [isSpawning, setIsSpawning] = useState(false)
    const [spawnError, setSpawnError] = useState<string | null>(null)

    // Fetch available sessions
    const { data: sessionsData, isLoading } = useQuery({
        queryKey: ['sessions-for-group'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getSessions()
        },
        enabled: Boolean(api && open)
    })

    // Fetch online machines for spawn
    const { data: machinesData, isLoading: isLoadingMachines } = useQuery({
        queryKey: ['machines-for-spawn'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getMachines()
        },
        enabled: Boolean(api && open && activeTab === 'spawn')
    })

    const onlineMachines = useMemo(() => {
        if (!machinesData?.machines) return []
        return machinesData.machines.filter(m => m.active)
    }, [machinesData?.machines])

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
        setSelectedMachineId('')
        setDirectory('')
        setSpawnError(null)
        setActiveTab('existing')
        onOpenChange(false)
    }

    const handleSpawn = async () => {
        if (!api || !selectedMachineId || !directory.trim()) return

        setIsSpawning(true)
        setSpawnError(null)
        try {
            await api.spawnGroupMember(groupId, selectedMachineId, directory.trim(), selectedAgentType)
            onSpawnMember?.()
            handleClose()
        } catch (err) {
            setSpawnError(err instanceof Error ? err.message : 'Failed to spawn agent')
        } finally {
            setIsSpawning(false)
        }
    }

    const canSpawn = selectedMachineId && directory.trim() && !isSpawning

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

                {/* Tabs */}
                <div className="flex-shrink-0 flex border-b border-[var(--app-divider)] mt-2">
                    <button
                        type="button"
                        onClick={() => setActiveTab('existing')}
                        className={`flex-1 py-2 text-sm font-medium transition-colors ${
                            activeTab === 'existing'
                                ? 'text-[var(--app-link)] border-b-2 border-[var(--app-link)]'
                                : 'text-[var(--app-hint)] hover:text-[var(--app-fg)]'
                        }`}
                    >
                        添加现有会话
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('spawn')}
                        className={`flex-1 py-2 text-sm font-medium transition-colors ${
                            activeTab === 'spawn'
                                ? 'text-[var(--app-link)] border-b-2 border-[var(--app-link)]'
                                : 'text-[var(--app-hint)] hover:text-[var(--app-fg)]'
                        }`}
                    >
                        创建新 Agent
                    </button>
                </div>

                {activeTab === 'existing' ? (
                    <>
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
                                                <div className="flex-shrink-0">
                                                    <div
                                                        className={`w-10 h-10 rounded-full ${agentColor} flex items-center justify-center text-white text-sm font-medium`}
                                                    >
                                                        {agentIcon}
                                                    </div>
                                                </div>

                                                {/* Info */}
                                                <div className="flex-1 min-w-0 text-left">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="font-medium text-sm truncate">{displayName}</span>
                                                        <span
                                                            className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                                                session.active ? 'bg-emerald-500' : 'bg-gray-400'
                                                            }`}
                                                        />
                                                    </div>
                                                    <div className="text-xs text-[var(--app-hint)] flex items-center gap-1.5 mt-0.5">
                                                        {agentType && (
                                                            <>
                                                                <span className={`px-1.5 py-0.5 rounded text-white text-[10px] ${agentColor}`}>
                                                                    {agentType}
                                                                </span>
                                                                <span className="text-[var(--app-hint)]">·</span>
                                                            </>
                                                        )}
                                                        <span className="truncate opacity-70">{session.id.slice(0, 8)}</span>
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
                    </>
                ) : (
                    <>
                        <div className="flex-1 overflow-y-auto min-h-0 mt-4 space-y-4">
                            {/* Machine Selector */}
                            <div className="space-y-1.5">
                                <label className="block text-sm font-medium text-[var(--app-fg)]">
                                    选择机器
                                </label>
                                {isLoadingMachines ? (
                                    <div className="flex items-center justify-center py-4">
                                        <Spinner className="w-5 h-5" />
                                    </div>
                                ) : onlineMachines.length === 0 ? (
                                    <div className="text-sm text-[var(--app-hint)] py-2">
                                        没有在线的机器
                                    </div>
                                ) : (
                                    <select
                                        value={selectedMachineId}
                                        onChange={(e) => setSelectedMachineId(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-fg)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                                    >
                                        <option value="">请选择机器...</option>
                                        {onlineMachines.map((machine) => (
                                            <option key={machine.id} value={machine.id}>
                                                {machine.metadata?.displayName || machine.metadata?.host || machine.id.slice(0, 8)}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            {/* Agent Type Selector */}
                            <div className="space-y-1.5">
                                <label className="block text-sm font-medium text-[var(--app-fg)]">
                                    Agent 类型
                                </label>
                                <div className="grid grid-cols-4 gap-2">
                                    {SPAWN_AGENT_TYPES.map((agent) => (
                                        <button
                                            key={agent.value}
                                            type="button"
                                            onClick={() => setSelectedAgentType(agent.value)}
                                            className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
                                                selectedAgentType === agent.value
                                                    ? 'border-[var(--app-link)] bg-[var(--app-link)]/10'
                                                    : 'border-[var(--app-divider)] hover:border-[var(--app-hint)]'
                                            }`}
                                        >
                                            <div className={`w-8 h-8 rounded-full ${agent.color} flex items-center justify-center text-white text-xs font-medium`}>
                                                {agent.label.charAt(0)}
                                            </div>
                                            <span className="text-xs text-[var(--app-fg)]">{agent.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Directory Input */}
                            <div className="space-y-1.5">
                                <label className="block text-sm font-medium text-[var(--app-fg)]">
                                    项目目录
                                </label>
                                <input
                                    type="text"
                                    value={directory}
                                    onChange={(e) => setDirectory(e.target.value)}
                                    placeholder="/path/to/project"
                                    className="w-full px-3 py-2 rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-fg)] text-sm placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                                />
                                <p className="text-xs text-[var(--app-hint)]">
                                    输入要在机器上打开的项目目录路径
                                </p>
                            </div>

                            {/* Error Message */}
                            {spawnError && (
                                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
                                    {spawnError}
                                </div>
                            )}
                        </div>

                        {/* Spawn Button */}
                        <div className="flex-shrink-0 pt-4 border-t border-[var(--app-divider)]">
                            <button
                                type="button"
                                onClick={handleSpawn}
                                disabled={!canSpawn}
                                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[var(--app-link)] text-white font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
                            >
                                {isSpawning ? (
                                    <>
                                        <Spinner className="w-4 h-4" />
                                        创建中...
                                    </>
                                ) : (
                                    <>创建并添加</>
                                )}
                            </button>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
