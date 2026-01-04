import { useAdvisorAlerts, type AdvisorAlert } from '@/hooks/useAdvisorAlert'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useState } from 'react'

function AlertIcon(props: { severity: 'critical' | 'high' }) {
    const color = props.severity === 'critical' ? 'text-red-500' : 'text-amber-500'
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
            className={`shrink-0 ${color}`}
        >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
        </svg>
    )
}

function CloseIcon() {
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
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    )
}

function CheckIcon() {
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
        >
            <polyline points="20 6 9 17 4 12" />
        </svg>
    )
}

async function acceptSuggestion(args: { suggestionId: string; token: string }): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/settings/advisor/suggestions/${args.suggestionId}/accept`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${args.token}`,
            'Content-Type': 'application/json'
        }
    })
    if (!res.ok) throw new Error('Failed to accept suggestion')
    return res.json()
}

async function rejectSuggestion(args: { suggestionId: string; token: string }): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/settings/advisor/suggestions/${args.suggestionId}/reject`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${args.token}`,
            'Content-Type': 'application/json'
        }
    })
    if (!res.ok) throw new Error('Failed to reject suggestion')
    return res.json()
}

function AlertItem(props: {
    alert: AdvisorAlert
    onDismiss: () => void
    onNavigate?: () => void
    onAccept: () => void
    onReject: () => void
    isProcessing: boolean
}) {
    const { alert, onDismiss, onNavigate, onAccept, onReject, isProcessing } = props
    const bgColor = alert.severity === 'critical'
        ? 'bg-red-500/95'
        : 'bg-amber-500/95'
    const borderColor = alert.severity === 'critical'
        ? 'border-red-600'
        : 'border-amber-600'

    return (
        <div
            className={`
                ${bgColor} ${borderColor}
                text-white rounded-lg shadow-lg border
                p-3 mb-2 animate-slide-down
                backdrop-blur-sm
            `}
        >
            <div className="flex items-start gap-3">
                <AlertIcon severity={alert.severity} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">
                            {alert.severity === 'critical' ? 'Critical Alert' : 'High Priority'}
                        </span>
                        {alert.category && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/20">
                                {alert.category}
                            </span>
                        )}
                    </div>
                    <div className="text-sm mt-1 font-medium">
                        {alert.title}
                    </div>
                    {alert.detail && (
                        <div className="text-xs mt-1 opacity-90 line-clamp-2">
                            {alert.detail}
                        </div>
                    )}
                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 mt-3">
                        <button
                            type="button"
                            onClick={onAccept}
                            disabled={isProcessing}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-white/25 hover:bg-white/35 transition-colors disabled:opacity-50"
                        >
                            <CheckIcon />
                            Accept
                        </button>
                        <button
                            type="button"
                            onClick={onReject}
                            disabled={isProcessing}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-black/20 hover:bg-black/30 transition-colors disabled:opacity-50"
                        >
                            <CloseIcon />
                            Reject
                        </button>
                        {alert.sourceSessionId && onNavigate && (
                            <button
                                type="button"
                                onClick={onNavigate}
                                className="text-xs underline opacity-80 hover:opacity-100 ml-2"
                            >
                                View source
                            </button>
                        )}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onDismiss}
                    className="shrink-0 p-1 rounded hover:bg-white/20 transition-colors"
                    title="Dismiss"
                >
                    <CloseIcon />
                </button>
            </div>
        </div>
    )
}

export function AdvisorAlertBanner() {
    const { alerts, dismiss } = useAdvisorAlerts()
    const navigate = useNavigate()
    const { token } = useAppContext()
    const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())

    const acceptMutation = useMutation({
        mutationFn: acceptSuggestion,
        onMutate: (args) => {
            setProcessingIds(prev => new Set(prev).add(args.suggestionId))
        },
        onSettled: (_, __, args) => {
            setProcessingIds(prev => {
                const next = new Set(prev)
                next.delete(args.suggestionId)
                return next
            })
        },
        onSuccess: (_, args) => {
            // 找到对应的 alert 并关闭
            const alert = alerts.find(a => a.suggestionId === args.suggestionId)
            if (alert) {
                dismiss(alert.id)
            }
        }
    })

    const rejectMutation = useMutation({
        mutationFn: rejectSuggestion,
        onMutate: (args) => {
            setProcessingIds(prev => new Set(prev).add(args.suggestionId))
        },
        onSettled: (_, __, args) => {
            setProcessingIds(prev => {
                const next = new Set(prev)
                next.delete(args.suggestionId)
                return next
            })
        },
        onSuccess: (_, args) => {
            // 找到对应的 alert 并关闭
            const alert = alerts.find(a => a.suggestionId === args.suggestionId)
            if (alert) {
                dismiss(alert.id)
            }
        }
    })

    if (alerts.length === 0) {
        return null
    }

    return (
        <div className="fixed top-0 left-0 right-0 z-[100] p-2 pointer-events-none">
            <div className="max-w-lg mx-auto pointer-events-auto">
                {alerts.map((alert) => (
                    <AlertItem
                        key={alert.id}
                        alert={alert}
                        onDismiss={() => dismiss(alert.id)}
                        onAccept={() => acceptMutation.mutate({ suggestionId: alert.suggestionId, token })}
                        onReject={() => rejectMutation.mutate({ suggestionId: alert.suggestionId, token })}
                        isProcessing={processingIds.has(alert.suggestionId)}
                        onNavigate={alert.sourceSessionId ? () => {
                            navigate({
                                to: '/sessions/$sessionId',
                                params: { sessionId: alert.sourceSessionId! }
                            })
                            dismiss(alert.id)
                        } : undefined}
                    />
                ))}
            </div>
        </div>
    )
}
