import { useAdvisorAlerts, type AdvisorAlert } from '@/hooks/useAdvisorAlert'
import { useNavigate } from '@tanstack/react-router'

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

function AlertItem(props: {
    alert: AdvisorAlert
    onDismiss: () => void
    onNavigate?: () => void
}) {
    const { alert, onDismiss, onNavigate } = props
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
                    {alert.sourceSessionId && onNavigate && (
                        <button
                            type="button"
                            onClick={onNavigate}
                            className="text-xs mt-2 underline opacity-80 hover:opacity-100"
                        >
                            View source session
                        </button>
                    )}
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
