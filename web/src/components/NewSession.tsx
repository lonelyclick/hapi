import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Machine, SpawnLogEntry } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { usePlatform } from '@/hooks/usePlatform'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'

type AgentType = 'claude' | 'codex' | 'gemini' | 'glm' | 'minimax' | 'grok' | 'openrouter' | 'aider-cli' | 'opencode'

// OpenAI Codex CLI models (gpt-5.x series)
const CODEX_MODELS = [
    { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex (Recommended)' },
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
    { value: 'gpt-5.2', label: 'GPT-5.2 (General)' },
    { value: 'gpt-5.1', label: 'GPT-5.1' },
    { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
    { value: 'gpt-5-codex-mini', label: 'GPT-5 Codex Mini' },
    { value: 'gpt-5', label: 'GPT-5' },
]

// Popular OpenRouter models
const OPENROUTER_MODELS = [
    { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
    { value: 'anthropic/claude-opus-4', label: 'Claude Opus 4' },
    { value: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet' },
    { value: 'openai/gpt-4o', label: 'GPT-4o' },
    { value: 'openai/o1', label: 'OpenAI o1' },
    { value: 'openai/o3-mini', label: 'OpenAI o3-mini' },
    { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'deepseek/deepseek-chat', label: 'DeepSeek V3' },
    { value: 'deepseek/deepseek-r1', label: 'DeepSeek R1' },
    { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
    { value: 'qwen/qwen-2.5-coder-32b-instruct', label: 'Qwen 2.5 Coder 32B' },
]

// OpenCode supported models - using OpenCode's native model ID format
const OPENCODE_MODELS = [
    // Anthropic (Claude)
    { value: 'anthropic.claude-sonnet-4-20250514', label: 'Claude Sonnet 4', provider: 'Anthropic' },
    { value: 'anthropic.claude-opus-4-20250514', label: 'Claude Opus 4', provider: 'Anthropic' },
    { value: 'anthropic.claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet', provider: 'Anthropic' },
    { value: 'anthropic.claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
    { value: 'anthropic.claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', provider: 'Anthropic' },
    { value: 'anthropic.claude-3-opus-latest', label: 'Claude 3 Opus', provider: 'Anthropic' },
    // OpenAI
    { value: 'openai.gpt-4.1', label: 'GPT-4.1', provider: 'OpenAI' },
    { value: 'openai.gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'OpenAI' },
    { value: 'openai.gpt-4.1-nano', label: 'GPT-4.1 Nano', provider: 'OpenAI' },
    { value: 'openai.gpt-4.5-preview', label: 'GPT-4.5 Preview', provider: 'OpenAI' },
    { value: 'openai.gpt-4o', label: 'GPT-4o', provider: 'OpenAI' },
    { value: 'openai.gpt-4o-mini', label: 'GPT-4o Mini', provider: 'OpenAI' },
    { value: 'openai.o1', label: 'o1', provider: 'OpenAI' },
    { value: 'openai.o1-pro', label: 'o1 Pro', provider: 'OpenAI' },
    { value: 'openai.o1-mini', label: 'o1 Mini', provider: 'OpenAI' },
    { value: 'openai.o3', label: 'o3', provider: 'OpenAI' },
    { value: 'openai.o3-mini', label: 'o3 Mini', provider: 'OpenAI' },
    { value: 'openai.o4-mini', label: 'o4 Mini', provider: 'OpenAI' },
    // Google Gemini
    { value: 'gemini.gemini-2.5', label: 'Gemini 2.5', provider: 'Google' },
    { value: 'gemini.gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'Google' },
    { value: 'gemini.gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'Google' },
    { value: 'gemini.gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', provider: 'Google' },
    // xAI (Grok)
    { value: 'xai.grok-3-beta', label: 'Grok 3 Beta', provider: 'xAI' },
    { value: 'xai.grok-3-mini-beta', label: 'Grok 3 Mini Beta', provider: 'xAI' },
    { value: 'xai.grok-3-fast-beta', label: 'Grok 3 Fast Beta', provider: 'xAI' },
    { value: 'xai.grok-3-mini-fast-beta', label: 'Grok 3 Mini Fast Beta', provider: 'xAI' },
    // Groq (fast inference)
    { value: 'groq.llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile', provider: 'Groq' },
    { value: 'groq.qwen-qwq', label: 'Qwen QWQ', provider: 'Groq' },
    { value: 'groq.deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill Llama 70B', provider: 'Groq' },
    { value: 'groq.meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout', provider: 'Groq' },
    { value: 'groq.meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick', provider: 'Groq' },
    // GitHub Copilot
    { value: 'copilot.gpt-4o', label: 'GPT-4o', provider: 'Copilot' },
    { value: 'copilot.gpt-4.1', label: 'GPT-4.1', provider: 'Copilot' },
    { value: 'copilot.claude-sonnet-4', label: 'Claude Sonnet 4', provider: 'Copilot' },
    { value: 'copilot.claude-3.7-sonnet', label: 'Claude 3.7 Sonnet', provider: 'Copilot' },
    { value: 'copilot.o1', label: 'o1', provider: 'Copilot' },
    { value: 'copilot.o3-mini', label: 'o3 Mini', provider: 'Copilot' },
    { value: 'copilot.o4-mini', label: 'o4 Mini', provider: 'Copilot' },
    { value: 'copilot.gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'Copilot' },
    { value: 'copilot.gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'Copilot' },
    // AWS Bedrock
    { value: 'bedrock.claude-3.7-sonnet', label: 'Claude 3.7 Sonnet', provider: 'Bedrock' },
    // MiniMax (OpenAI-compatible API)
    { value: 'minimax-openai/MiniMax-M2.1', label: 'MiniMax-M2.1', provider: 'MiniMax' },
    { value: 'minimax-openai/MiniMax-Text-01', label: 'MiniMax-Text-01', provider: 'MiniMax' },
]

function SpawnLogPanel({ logs }: { logs: SpawnLogEntry[] }) {
    if (logs.length === 0) return null

    const getStatusIcon = (status: SpawnLogEntry['status']) => {
        switch (status) {
            case 'pending':
                return <span className="text-gray-400">○</span>
            case 'running':
                return <span className="text-blue-500 animate-pulse">●</span>
            case 'success':
                return <span className="text-green-500">✓</span>
            case 'error':
                return <span className="text-red-500">✗</span>
        }
    }

    const getStatusColor = (status: SpawnLogEntry['status']) => {
        switch (status) {
            case 'pending':
                return 'text-gray-400'
            case 'running':
                return 'text-blue-600'
            case 'success':
                return 'text-green-600'
            case 'error':
                return 'text-red-600'
        }
    }

    return (
        <div className="px-3 py-2 bg-[var(--app-bg-secondary)] border-t border-[var(--app-divider)]">
            <div className="text-xs font-medium text-[var(--app-hint)] mb-2">
                Creation Log
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto font-mono text-xs">
                {logs.map((log, index) => (
                    <div key={index} className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-4">
                            {getStatusIcon(log.status)}
                        </span>
                        <span className="text-[var(--app-hint)] flex-shrink-0 w-16">
                            [{log.step}]
                        </span>
                        <span className={getStatusColor(log.status)}>
                            {log.message}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}

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

    const [machineId, setMachineId] = useState<string | null>(null)
    const [projectPath, setProjectPath] = useState('')
    const [agent, setAgent] = useState<AgentType>('claude')
    const [claudeAgent, setClaudeAgent] = useState('')
    const [codexModel, setCodexModel] = useState(CODEX_MODELS[0].value)
    const [openrouterModel, setOpenrouterModel] = useState(OPENROUTER_MODELS[0].value)
    const [opencodeModel, setOpencodeModel] = useState(OPENCODE_MODELS[0].value)
    const [error, setError] = useState<string | null>(null)
    const [isCustomPath, setIsCustomPath] = useState(false)
    const [spawnLogs, setSpawnLogs] = useState<SpawnLogEntry[]>([])

    // Fetch projects
    const { data: projectsData, isLoading: projectsLoading } = useQuery({
        queryKey: ['projects'],
        queryFn: async () => {
            return await props.api.getProjects()
        }
    })

    const projects = Array.isArray(projectsData?.projects) ? projectsData.projects : []

    const selectedProject = useMemo(
        () => projects.find((p) => p.path === projectPath.trim()) ?? null,
        [projects, projectPath]
    )

    const projectSuggestions = useMemo(() => {
        return projects.map((project) => ({
            value: project.path,
            label: project.name
        }))
    }, [projects])

    // Initialize with first available machine
    useEffect(() => {
        if (props.machines.length === 0) return
        if (machineId && props.machines.find((m) => m.id === machineId)) return

        if (props.machines[0]) {
            setMachineId(props.machines[0].id)
        }
    }, [props.machines, machineId])

    // Initialize with first available project
    useEffect(() => {
        if (projectPath.trim()) return

        if (projects.length > 0) {
            setProjectPath(projects[0].path)
        }
    }, [projectPath, projects])

    const handleMachineChange = useCallback((newMachineId: string) => {
        setMachineId(newMachineId)
    }, [])

    async function handleCreate() {
        if (!machineId) return
        const directory = projectPath.trim()
        if (!directory) return

        setError(null)
        setSpawnLogs([])

        // Add initial local log entries to show progress
        const localLogs: SpawnLogEntry[] = [
            { timestamp: Date.now(), step: 'request', message: `Sending spawn request for ${agent} agent...`, status: 'running' }
        ]
        setSpawnLogs([...localLogs])

        try {
            const result = await spawnSession({
                machineId,
                directory,
                agent,
                yolo: true,
                sessionType: 'simple',
                claudeAgent: agent === 'claude' ? (claudeAgent.trim() || undefined) : undefined,
                codexModel: agent === 'codex' ? codexModel : undefined,
                openrouterModel: agent === 'openrouter' ? openrouterModel : undefined,
                opencodeModel: agent === 'opencode' ? opencodeModel : undefined
            })

            // Update logs from server response
            if (result.logs && result.logs.length > 0) {
                setSpawnLogs(result.logs)
            }

            if (result.type === 'success') {
                haptic.notification('success')
                props.onSuccess(result.sessionId)
                return
            }

            haptic.notification('error')
            setError(result.message)
        } catch (e) {
            haptic.notification('error')
            setSpawnLogs(prev => [
                ...prev,
                { timestamp: Date.now(), step: 'error', message: e instanceof Error ? e.message : 'Failed to create session', status: 'error' }
            ])
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
                <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-[var(--app-hint)]">
                        Project
                    </label>
                    <button
                        type="button"
                        onClick={() => setIsCustomPath(!isCustomPath)}
                        className="text-xs text-[var(--app-link)] hover:underline"
                    >
                        {isCustomPath ? 'Select from list' : 'Custom path'}
                    </button>
                </div>
                {isCustomPath ? (
                    <input
                        type="text"
                        value={projectPath}
                        onChange={(e) => setProjectPath(e.target.value)}
                        disabled={isFormDisabled}
                        placeholder="/path/to/project"
                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                ) : (
                    <>
                        <select
                            value={projectPath}
                            onChange={(e) => setProjectPath(e.target.value)}
                            disabled={isFormDisabled || projectsLoading}
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        >
                            {projectsLoading && (
                                <option value="">Loading projects…</option>
                            )}
                            {!projectsLoading && projectSuggestions.length === 0 && (
                                <option value="">No projects available</option>
                            )}
                            {projectSuggestions.map((suggestion) => (
                                <option key={suggestion.value} value={suggestion.value}>
                                    {suggestion.label ?? suggestion.value}
                                </option>
                            ))}
                        </select>
                        {selectedProject?.description && (
                            <div className="text-xs text-[var(--app-hint)]">
                                {selectedProject.description}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Agent Selector */}
            <div className="flex flex-col gap-1.5 px-3 py-3">
                <label className="text-xs font-medium text-[var(--app-hint)]">
                    Agents
                </label>
                <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {(['claude', 'codex', 'gemini', 'opencode', 'aider-cli'] as const).map((agentType) => (
                        <label
                            key={agentType}
                            className="flex items-center gap-1 cursor-pointer"
                        >
                            <input
                                type="radio"
                                name="agent"
                                value={agentType}
                                checked={agent === agentType}
                                onChange={() => setAgent(agentType)}
                                disabled={isFormDisabled}
                                className="accent-[var(--app-link)] w-3.5 h-3.5"
                            />
                            <span className="text-xs capitalize">{agentType}</span>
                        </label>
                    ))}
                </div>
            </div>

            {/* Chat Models Selector */}
            <div className="flex flex-col gap-1.5 px-3 py-3">
                <label className="text-xs font-medium text-[var(--app-hint)]">
                    Chat Models
                </label>
                <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {(['glm', 'minimax', 'grok', 'openrouter'] as const).map((agentType) => (
                        <label
                            key={agentType}
                            className="flex items-center gap-1 cursor-pointer"
                        >
                            <input
                                type="radio"
                                name="agent"
                                value={agentType}
                                checked={agent === agentType}
                                onChange={() => setAgent(agentType)}
                                disabled={isFormDisabled}
                                className="accent-[var(--app-link)] w-3.5 h-3.5"
                            />
                            <span className="text-xs capitalize">{agentType}</span>
                        </label>
                    ))}
                </div>
            </div>
            {agent === 'claude' ? (
                <div className="flex flex-col gap-1.5 px-3 pb-3">
                    <label className="text-xs font-medium text-[var(--app-hint)]">
                        Claude Agent (optional)
                    </label>
                    <input
                        type="text"
                        value={claudeAgent}
                        onChange={(e) => setClaudeAgent(e.target.value)}
                        disabled={isFormDisabled}
                        placeholder="e.g. grok"
                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                    <div className="text-[11px] text-[var(--app-hint)]">
                        Matches the name from Claude Code (--agent).
                    </div>
                </div>
            ) : null}
            {agent === 'codex' ? (
                <div className="flex flex-col gap-1.5 px-3 pb-3">
                    <label className="text-xs font-medium text-[var(--app-hint)]">
                        Model (OpenAI Codex)
                    </label>
                    <select
                        value={codexModel}
                        onChange={(e) => setCodexModel(e.target.value)}
                        disabled={isFormDisabled}
                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    >
                        {CODEX_MODELS.map((model) => (
                            <option key={model.value} value={model.value}>
                                {model.label}
                            </option>
                        ))}
                    </select>
                    <div className="text-[11px] text-[var(--app-hint)]">
                        GPT-5.2-Codex is the most advanced model for agentic coding.
                    </div>
                </div>
            ) : null}
            {agent === 'openrouter' ? (
                <div className="flex flex-col gap-1.5 px-3 pb-3">
                    <label className="text-xs font-medium text-[var(--app-hint)]">
                        Model (OpenRouter)
                    </label>
                    <select
                        value={openrouterModel}
                        onChange={(e) => setOpenrouterModel(e.target.value)}
                        disabled={isFormDisabled}
                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    >
                        {OPENROUTER_MODELS.map((model) => (
                            <option key={model.value} value={model.value}>
                                {model.label}
                            </option>
                        ))}
                    </select>
                    <div className="text-[11px] text-[var(--app-hint)]">
                        Select model from OpenRouter. Requires OPENROUTER_API_KEY.
                    </div>
                </div>
            ) : null}
            {agent === 'opencode' ? (
                <div className="flex flex-col gap-1.5 px-3 pb-3">
                    <label className="text-xs font-medium text-[var(--app-hint)]">
                        Model (OpenCode)
                    </label>
                    <select
                        value={opencodeModel}
                        onChange={(e) => setOpencodeModel(e.target.value)}
                        disabled={isFormDisabled}
                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    >
                        {OPENCODE_MODELS.map((model) => (
                            <option key={model.value} value={model.value}>
                                {model.provider} - {model.label}
                            </option>
                        ))}
                    </select>
                    <div className="text-[11px] text-[var(--app-hint)]">
                        OpenCode supports 75+ providers via AI SDK. Configure API keys in opencode.json.
                    </div>
                </div>
            ) : null}

            {/* Spawn Logs */}
            {spawnLogs.length > 0 && (
                <SpawnLogPanel logs={spawnLogs} />
            )}

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
