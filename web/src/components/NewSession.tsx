import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { usePlatform } from '@/hooks/usePlatform'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { useRecentPaths } from '@/hooks/useRecentPaths'

type AgentType = 'claude' | 'codex' | 'gemini' | 'glm' | 'minimax'

function getMachineTitle(machine: Machine): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

export function NewSession(props: {
    api: ApiClient
    machines: Machine[]
    isLoading?: boolean
    onSuccess: (sessionId: string) => void
    onCancel: () => void
}) {
    const { haptic } = usePlatform()
    const { spawnSession, isPending, error: spawnError } = useSpawnSession(props.api)
    const isFormDisabled = isPending || props.isLoading
    const { getRecentPaths, addRecentPath, getLastUsedMachineId, setLastUsedMachineId } = useRecentPaths()

    const [machineId, setMachineId] = useState<string | null>(null)
    const [projectPath, setProjectPath] = useState('')
    const [agent, setAgent] = useState<AgentType>('claude')
    const [error, setError] = useState<string | null>(null)

    // Fetch projects
    const { data: projectsData, isLoading: projectsLoading } = useQuery({
        queryKey: ['projects'],
        queryFn: async () => {
            return await props.api.getProjects()
        }
    })

    const projects = projectsData?.projects ?? []

    const selectedProject = useMemo(
        () => projects.find((p) => p.path === projectPath.trim()) ?? null,
        [projects, projectPath]
    )

    const recentPaths = useMemo(() => getRecentPaths(machineId), [getRecentPaths, machineId])
    const projectSuggestions = useMemo(() => {
        const seen = new Set<string>()
        const suggestions: Array<{ value: string; label?: string }> = []
        for (const recent of recentPaths) {
            if (seen.has(recent)) continue
            seen.add(recent)
            suggestions.push({ value: recent })
        }
        for (const project of projects) {
            if (seen.has(project.path)) continue
            seen.add(project.path)
            suggestions.push({ value: project.path, label: project.name })
        }
        return suggestions
    }, [projects, recentPaths])

    // Initialize with last used machine or first available
    useEffect(() => {
        if (props.machines.length === 0) return
        if (machineId && props.machines.find((m) => m.id === machineId)) return

        const lastUsed = getLastUsedMachineId()
        const foundLast = lastUsed ? props.machines.find((m) => m.id === lastUsed) : null

        if (foundLast) {
            setMachineId(foundLast.id)
        } else if (props.machines[0]) {
            setMachineId(props.machines[0].id)
        }
    }, [props.machines, machineId, getLastUsedMachineId])

    useEffect(() => {
        if (projectPath.trim()) return

        const recent = machineId ? getRecentPaths(machineId) : []
        if (recent.length > 0) {
            setProjectPath(recent[0])
            return
        }

        if (projects.length > 0) {
            setProjectPath(projects[0].path)
        }
    }, [projectPath, machineId, getRecentPaths, projects])

    const handleMachineChange = useCallback((newMachineId: string) => {
        setMachineId(newMachineId)
    }, [])

    async function handleCreate() {
        if (!machineId) return
        const directory = projectPath.trim()
        if (!directory) return

        setError(null)
        try {
            const result = await spawnSession({
                machineId,
                directory,
                agent,
                yolo: true,
                sessionType: 'simple'
            })

            if (result.type === 'success') {
                haptic.notification('success')
                addRecentPath(machineId, directory)
                setLastUsedMachineId(machineId)
                props.onSuccess(result.sessionId)
                return
            }

            haptic.notification('error')
            setError(result.message)
        } catch (e) {
            haptic.notification('error')
            setError(e instanceof Error ? e.message : 'Failed to create session')
        }
    }

    const canCreate = Boolean(machineId && projectPath.trim() && !isFormDisabled)

    return (
        <div className="flex flex-col divide-y divide-[var(--app-divider)]">
            {/* Machine Selector */}
            <div className="flex flex-col gap-1.5 px-3 py-3">
                <label className="text-xs font-medium text-[var(--app-hint)]">
                    Machine
                </label>
                <select
                    value={machineId ?? ''}
                    onChange={(e) => handleMachineChange(e.target.value)}
                    disabled={isFormDisabled}
                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                >
                    {props.isLoading && (
                        <option value="">Loading machines…</option>
                    )}
                    {!props.isLoading && props.machines.length === 0 && (
                        <option value="">No machines available</option>
                    )}
                    {props.machines.map((m) => (
                        <option key={m.id} value={m.id}>
                            {getMachineTitle(m)}
                            {m.metadata?.platform ? ` (${m.metadata.platform})` : ''}
                        </option>
                    ))}
                </select>
            </div>

            {/* Project Selector */}
            <div className="flex flex-col gap-1.5 px-3 py-3">
                <label className="text-xs font-medium text-[var(--app-hint)]">
                    Project
                </label>
                <input
                    type="text"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    disabled={isFormDisabled}
                    placeholder="/path/to/project"
                    list="project-path-suggestions"
                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />
                <datalist id="project-path-suggestions">
                    {projectSuggestions.map((suggestion) => (
                        <option key={suggestion.value} value={suggestion.value} label={suggestion.label} />
                    ))}
                </datalist>
                {projectsLoading ? (
                    <div className="text-xs text-[var(--app-hint)]">
                        Loading projects…
                    </div>
                ) : projects.length === 0 ? (
                    <div className="text-xs text-[var(--app-hint)]">
                        No saved projects yet.
                    </div>
                ) : (
                    <div className="text-xs text-[var(--app-hint)]">
                        Type a path or pick a saved project.
                    </div>
                )}
                {selectedProject && (
                    <div className="text-xs text-[var(--app-hint)] mt-1">
                        <span className="font-medium">{selectedProject.name}</span>
                        {selectedProject.description ? ` — ${selectedProject.description}` : ''}
                    </div>
                )}
            </div>

            {/* Agent Selector */}
            <div className="flex flex-col gap-1.5 px-3 py-3">
                <label className="text-xs font-medium text-[var(--app-hint)]">
                    Agent
                </label>
                <div className="flex gap-3">
                    {(['claude', 'codex', 'gemini', 'glm', 'minimax'] as const).map((agentType) => (
                        <label
                            key={agentType}
                            className="flex items-center gap-1.5 cursor-pointer"
                        >
                            <input
                                type="radio"
                                name="agent"
                                value={agentType}
                                checked={agent === agentType}
                                onChange={() => setAgent(agentType)}
                                disabled={isFormDisabled}
                                className="accent-[var(--app-link)]"
                            />
                            <span className="text-sm capitalize">{agentType}</span>
                        </label>
                    ))}
                </div>
            </div>

            {/* Error Message */}
            {(error ?? spawnError) ? (
                <div className="px-3 py-2 text-sm text-red-600">
                    {error ?? spawnError}
                </div>
            ) : null}

            {/* Action Buttons */}
            <div className="flex gap-2 px-3 py-3">
                <Button
                    variant="secondary"
                    onClick={props.onCancel}
                    disabled={isFormDisabled}
                >
                    Cancel
                </Button>
                <Button
                    onClick={handleCreate}
                    disabled={!canCreate}
                    aria-busy={isPending}
                    className="gap-2"
                >
                    {isPending ? (
                        <>
                            <Spinner size="sm" label={null} className="text-[var(--app-button-text)]" />
                            Creating…
                        </>
                    ) : (
                        'Create'
                    )}
                </Button>
            </div>
        </div>
    )
}
