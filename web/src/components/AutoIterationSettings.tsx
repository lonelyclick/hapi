import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { Spinner } from '@/components/Spinner'
import { queryKeys } from '@/lib/query-keys'
import type {
    AutoIterationData,
    AutoIterationExecutionPolicy,
    AutoIterationExecutionStatus,
    AutoIterationNotificationLevel,
    AutoIterationLog
} from '@/types/api'

const POLICY_LABELS: Record<AutoIterationExecutionPolicy, string> = {
    auto_execute: 'Auto Execute',
    notify_then_execute: 'Notify Then Execute',
    require_confirm: 'Require Confirm',
    always_manual: 'Always Manual',
    disabled: 'Disabled'
}

const POLICY_COLORS: Record<AutoIterationExecutionPolicy, string> = {
    auto_execute: 'bg-green-500/20 text-green-600',
    notify_then_execute: 'bg-yellow-500/20 text-yellow-600',
    require_confirm: 'bg-orange-500/20 text-orange-600',
    always_manual: 'bg-red-500/20 text-red-600',
    disabled: 'bg-gray-500/20 text-gray-600'
}

const STATUS_COLORS: Record<AutoIterationExecutionStatus, string> = {
    pending: 'bg-yellow-500/20 text-yellow-600',
    approved: 'bg-blue-500/20 text-blue-600',
    executing: 'bg-blue-500/20 text-blue-600',
    completed: 'bg-green-500/20 text-green-600',
    failed: 'bg-red-500/20 text-red-600',
    rejected: 'bg-red-500/20 text-red-600',
    cancelled: 'bg-gray-500/20 text-gray-600',
    timeout: 'bg-orange-500/20 text-orange-600'
}

const ACTION_TYPE_LABELS: Record<string, string> = {
    format_code: 'Format Code',
    fix_lint: 'Fix Lint',
    add_comments: 'Add Comments',
    run_tests: 'Run Tests',
    fix_type_errors: 'Fix Type Errors',
    update_deps: 'Update Dependencies',
    refactor: 'Refactor',
    optimize: 'Optimize',
    edit_config: 'Edit Config',
    create_file: 'Create File',
    delete_file: 'Delete File',
    git_commit: 'Git Commit',
    git_push: 'Git Push',
    deploy: 'Deploy',
    custom: 'Custom'
}

export function AutoIterationSettings() {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const [showLogs, setShowLogs] = useState(false)

    // Fetch config
    const { data, isLoading, error } = useQuery<AutoIterationData>({
        queryKey: queryKeys.autoIterationConfig,
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getAutoIterationConfig()
        },
        enabled: Boolean(api)
    })

    // Fetch logs
    const { data: logsData, isLoading: logsLoading } = useQuery<{ logs: AutoIterationLog[] }>({
        queryKey: queryKeys.autoIterationLogs,
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getAutoIterationLogs(20)
        },
        enabled: Boolean(api) && showLogs
    })

    // Toggle enabled mutation
    const toggleMutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            if (!api) throw new Error('API unavailable')
            if (enabled) {
                return await api.enableAutoIteration()
            } else {
                return await api.disableAutoIteration()
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.autoIterationConfig })
        }
    })

    // Update config mutation
    const updateMutation = useMutation({
        mutationFn: async (update: { notificationLevel: AutoIterationNotificationLevel }) => {
            if (!api) throw new Error('API unavailable')
            return await api.updateAutoIterationNotificationLevel(update.notificationLevel)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.autoIterationConfig })
        }
    })

    const handleToggle = useCallback(() => {
        if (data?.config) {
            toggleMutation.mutate(!data.config.enabled)
        }
    }, [data?.config, toggleMutation])

    const handleNotificationLevelChange = useCallback((level: AutoIterationNotificationLevel) => {
        updateMutation.mutate({ notificationLevel: level })
    }, [updateMutation])

    if (isLoading) {
        return (
            <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                <div className="px-3 py-2 border-b border-[var(--app-divider)]">
                    <h2 className="text-sm font-medium">Auto-Iteration</h2>
                </div>
                <div className="px-3 py-4 flex justify-center">
                    <Spinner size="sm" label="Loading..." />
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                <div className="px-3 py-2 border-b border-[var(--app-divider)]">
                    <h2 className="text-sm font-medium">Auto-Iteration</h2>
                </div>
                <div className="px-3 py-4 text-center text-sm text-red-500">
                    Failed to load auto-iteration settings. Service may not be available.
                </div>
            </div>
        )
    }

    const config = data?.config
    const stats = data?.stats
    const policySummary = data?.policySummary
    const logs = Array.isArray(logsData?.logs) ? logsData.logs : []

    return (
        <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
            <div className="px-3 py-2 border-b border-[var(--app-divider)]">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-medium">Auto-Iteration</h2>
                        <p className="text-[11px] text-[var(--app-hint)] mt-0.5">
                            Let AI Advisor automatically execute code operations
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleToggle}
                        disabled={toggleMutation.isPending}
                        className={`relative w-11 h-6 rounded-full transition-colors ${
                            config?.enabled ? 'bg-green-500' : 'bg-gray-400'
                        } ${toggleMutation.isPending ? 'opacity-50' : ''}`}
                    >
                        <span
                            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                                config?.enabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                        />
                    </button>
                </div>
            </div>

            {/* Stats */}
            {stats && (
                <div className="px-3 py-2 border-b border-[var(--app-divider)] grid grid-cols-5 gap-2 text-center">
                    <div>
                        <div className="text-lg font-semibold">{stats.total}</div>
                        <div className="text-[10px] text-[var(--app-hint)]">Total</div>
                    </div>
                    <div>
                        <div className="text-lg font-semibold text-yellow-600">{stats.pending}</div>
                        <div className="text-[10px] text-[var(--app-hint)]">Pending</div>
                    </div>
                    <div>
                        <div className="text-lg font-semibold text-green-600">{stats.completed}</div>
                        <div className="text-[10px] text-[var(--app-hint)]">Done</div>
                    </div>
                    <div>
                        <div className="text-lg font-semibold text-red-600">{stats.failed}</div>
                        <div className="text-[10px] text-[var(--app-hint)]">Failed</div>
                    </div>
                    <div>
                        <div className="text-lg font-semibold text-gray-600">{stats.rejected}</div>
                        <div className="text-[10px] text-[var(--app-hint)]">Rejected</div>
                    </div>
                </div>
            )}

            {/* Notification Level */}
            <div className="px-3 py-2 border-b border-[var(--app-divider)]">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--app-hint)]">Notifications</span>
                    <select
                        value={config?.notificationLevel ?? 'all'}
                        onChange={(e) => handleNotificationLevelChange(e.target.value as AutoIterationNotificationLevel)}
                        disabled={updateMutation.isPending}
                        className="text-sm bg-transparent border border-[var(--app-divider)] rounded px-2 py-1"
                    >
                        <option value="all">All Operations</option>
                        <option value="errors_only">Errors Only</option>
                        <option value="none">None</option>
                    </select>
                </div>
            </div>

            {/* Policy Summary */}
            {policySummary && (
                <div className="px-3 py-2 border-b border-[var(--app-divider)]">
                    <div className="text-sm font-medium mb-2">Execution Policies</div>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                        {Object.entries(policySummary).map(([action, info]) => (
                            <div key={action} className="flex items-center justify-between text-xs">
                                <span className="text-[var(--app-hint)]">
                                    {ACTION_TYPE_LABELS[action] ?? action}
                                </span>
                                <span className={`px-1.5 py-0.5 rounded ${POLICY_COLORS[info.policy]}`}>
                                    {POLICY_LABELS[info.policy]}
                                    {info.isCustom && ' *'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Logs Toggle */}
            <div className="px-3 py-2">
                <button
                    type="button"
                    onClick={() => setShowLogs(!showLogs)}
                    className="text-sm text-[var(--app-accent)] hover:underline"
                >
                    {showLogs ? 'Hide Logs' : 'Show Recent Logs'}
                </button>
            </div>

            {/* Logs List */}
            {showLogs && (
                <div className="border-t border-[var(--app-divider)]">
                    {logsLoading ? (
                        <div className="px-3 py-4 flex justify-center">
                            <Spinner size="sm" label="Loading logs..." />
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="px-3 py-4 text-center text-sm text-[var(--app-hint)]">
                            No execution logs yet.
                        </div>
                    ) : (
                        <div className="divide-y divide-[var(--app-divider)] max-h-64 overflow-y-auto">
                            {logs.map((log) => (
                                <div key={log.id} className="px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[log.executionStatus]}`}>
                                                    {log.executionStatus}
                                                </span>
                                                <span className="text-sm font-medium truncate">
                                                    {ACTION_TYPE_LABELS[log.actionType] ?? log.actionType}
                                                </span>
                                            </div>
                                            {log.reason && (
                                                <div className="text-xs text-[var(--app-hint)] truncate mt-0.5">
                                                    {log.reason}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-[10px] text-[var(--app-hint)] shrink-0">
                                            {new Date(log.createdAt).toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
