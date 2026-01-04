import { useQuery } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { Spinner } from '@/components/Spinner'

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

function RefreshIcon(props: { className?: string }) {
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
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
    )
}

function formatResetTime(isoString: string): string {
    if (!isoString) return 'Unknown'
    try {
        const date = new Date(isoString)
        const now = new Date()
        const diff = date.getTime() - now.getTime()

        if (diff < 0) return 'Just reset'

        const hours = Math.floor(diff / (1000 * 60 * 60))
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

        if (hours > 0) {
            return `${hours}h ${minutes}m`
        }
        return `${minutes}m`
    } catch {
        return 'Unknown'
    }
}

function UsageBar(props: { utilization: number; label: string; resetsAt: string }) {
    const percentage = Math.min(100, Math.max(0, props.utilization * 100))
    const isHigh = percentage > 80
    const isMedium = percentage > 50 && percentage <= 80

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--app-hint)]">{props.label}</span>
                <span className={`font-mono ${isHigh ? 'text-red-500' : isMedium ? 'text-yellow-500' : 'text-[var(--app-fg)]'}`}>
                    {percentage.toFixed(1)}%
                </span>
            </div>
            <div className="h-2 bg-[var(--app-border)] rounded-full overflow-hidden">
                <div
                    className={`h-full transition-all duration-300 ${isHigh ? 'bg-red-500' : isMedium ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                    style={{ width: `${percentage}%` }}
                />
            </div>
            <div className="text-[10px] text-[var(--app-hint)]">
                Resets in {formatResetTime(props.resetsAt)}
            </div>
        </div>
    )
}

export default function UsagePage() {
    const { api } = useAppContext()
    const goBack = useAppGoBack()

    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: ['usage'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getUsage()
        },
        enabled: Boolean(api),
        refetchInterval: 60000 // Refresh every minute
    })

    return (
        <div className="flex h-full flex-col">
            <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 px-3 py-1.5">
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="flex-1 font-medium text-sm">Token Usage</div>
                    <button
                        type="button"
                        onClick={() => refetch()}
                        disabled={isFetching}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] disabled:opacity-50"
                        title="Refresh"
                    >
                        <RefreshIcon className={isFetching ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                <div className="mx-auto w-full max-w-content p-3 space-y-4">
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <Spinner size="md" label="Loading usage data..." />
                        </div>
                    ) : error ? (
                        <div className="text-center py-8 text-red-500 text-sm">
                            {error instanceof Error ? error.message : 'Failed to load usage data'}
                        </div>
                    ) : (
                        <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                            <div className="divide-y divide-[var(--app-divider)]">
                                {/* Claude Code Usage */}
                                <div className="px-3 py-3">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-6 h-6 rounded bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
                                            <span className="text-white text-xs font-bold">C</span>
                                        </div>
                                        <span className="text-sm font-medium">Claude Code</span>
                                    </div>

                                    {data?.claude?.error ? (
                                        <div className="text-xs text-[var(--app-hint)]">
                                            {data.claude.error}
                                        </div>
                                    ) : data?.claude?.fiveHour || data?.claude?.sevenDay ? (
                                        <div className="space-y-3">
                                            {data.claude.fiveHour && (
                                                <UsageBar
                                                    utilization={data.claude.fiveHour.utilization}
                                                    label="5-Hour Limit"
                                                    resetsAt={data.claude.fiveHour.resetsAt}
                                                />
                                            )}
                                            {data.claude.sevenDay && (
                                                <UsageBar
                                                    utilization={data.claude.sevenDay.utilization}
                                                    label="7-Day Limit"
                                                    resetsAt={data.claude.sevenDay.resetsAt}
                                                />
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-xs text-[var(--app-hint)]">
                                            No usage data available
                                        </div>
                                    )}
                                </div>

                                {/* Codex Usage */}
                                <div className="px-3 py-3">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-6 h-6 rounded bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                                            <span className="text-white text-xs font-bold">X</span>
                                        </div>
                                        <span className="text-sm font-medium">OpenAI Codex</span>
                                    </div>

                                    <div className="text-xs text-[var(--app-hint)] space-y-2">
                                        <p>Codex uses ChatGPT Plus subscription quota. OpenAI does not provide a public API for usage data.</p>
                                        <p>
                                            View usage in{' '}
                                            <a
                                                href="https://platform.openai.com/usage"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-[var(--app-accent)] hover:underline"
                                            >
                                                OpenAI Dashboard
                                            </a>
                                            {' '}or use <code className="bg-[var(--app-border)] px-1 rounded">/status</code> in a Codex session.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {data?.timestamp && (
                                <div className="px-3 py-2 border-t border-[var(--app-divider)] text-[10px] text-[var(--app-hint)]">
                                    Updated: {new Date(data.timestamp).toLocaleTimeString()}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
