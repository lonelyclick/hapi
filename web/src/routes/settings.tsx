import { useCallback, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { Spinner } from '@/components/Spinner'
import { getClientId, getDeviceType, getStoredEmail } from '@/lib/client-identity'

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
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

export default function SettingsPage() {
    const { api } = useAppContext()
    const goBack = useAppGoBack()
    const queryClient = useQueryClient()
    const [newEmail, setNewEmail] = useState('')
    const [error, setError] = useState<string | null>(null)

    // 当前会话信息
    const currentSession = useMemo(() => ({
        email: getStoredEmail() || '-',
        clientId: getClientId(),
        deviceType: getDeviceType()
    }), [])

    const { data, isLoading } = useQuery({
        queryKey: ['allowed-emails'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getAllowedEmails()
        },
        enabled: Boolean(api)
    })

    const addMutation = useMutation({
        mutationFn: async (email: string) => {
            if (!api) throw new Error('API unavailable')
            return await api.addAllowedEmail(email)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['allowed-emails'], { emails: result.emails })
            setNewEmail('')
            setError(null)
        },
        onError: (err) => {
            setError(err instanceof Error ? err.message : 'Failed to add email')
        }
    })

    const removeMutation = useMutation({
        mutationFn: async (email: string) => {
            if (!api) throw new Error('API unavailable')
            return await api.removeAllowedEmail(email)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['allowed-emails'], { emails: result.emails })
        },
        onError: (err) => {
            setError(err instanceof Error ? err.message : 'Failed to remove email')
        }
    })

    const handleAddEmail = useCallback((e: React.FormEvent) => {
        e.preventDefault()
        const trimmedEmail = newEmail.trim().toLowerCase()
        if (!trimmedEmail) return
        addMutation.mutate(trimmedEmail)
    }, [newEmail, addMutation])

    const handleRemoveEmail = useCallback((email: string) => {
        removeMutation.mutate(email)
    }, [removeMutation])

    const emails = data?.emails ?? []

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
                    <div className="flex-1 font-medium text-sm">Settings</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content p-3 space-y-4">
                    {/* Current Session Section */}
                    <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                        <div className="px-3 py-2 border-b border-[var(--app-divider)]">
                            <h2 className="text-sm font-medium">Current Session</h2>
                        </div>
                        <div className="divide-y divide-[var(--app-divider)]">
                            <div className="px-3 py-2 flex items-center justify-between gap-2">
                                <span className="text-sm text-[var(--app-hint)]">Email</span>
                                <span className="text-sm font-mono truncate">{currentSession.email}</span>
                            </div>
                            <div className="px-3 py-2 flex items-center justify-between gap-2">
                                <span className="text-sm text-[var(--app-hint)]">Device</span>
                                <span className="text-sm font-mono">{currentSession.deviceType}</span>
                            </div>
                            <div className="px-3 py-2 flex items-center justify-between gap-2">
                                <span className="text-sm text-[var(--app-hint)]">Client ID</span>
                                <span className="text-sm font-mono">{currentSession.clientId}</span>
                            </div>
                        </div>
                    </div>

                    {/* Allowed Emails Section */}
                    <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                        <div className="px-3 py-2 border-b border-[var(--app-divider)]">
                            <h2 className="text-sm font-medium">Allowed Emails</h2>
                            <p className="text-[11px] text-[var(--app-hint)] mt-0.5">
                                Only these emails can login. Leave empty to allow all.
                            </p>
                        </div>

                        {/* Add Email Form */}
                        <form onSubmit={handleAddEmail} className="px-3 py-2 border-b border-[var(--app-divider)] flex gap-2">
                            <input
                                type="email"
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                                placeholder="email@company.com"
                                className="flex-1 px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                                disabled={addMutation.isPending}
                            />
                            <button
                                type="submit"
                                disabled={addMutation.isPending || !newEmail.trim()}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50 hover:opacity-90 transition-opacity"
                            >
                                {addMutation.isPending ? (
                                    <Spinner size="sm" label={null} />
                                ) : (
                                    <PlusIcon />
                                )}
                                Add
                            </button>
                        </form>

                        {error && (
                            <div className="px-3 py-2 text-sm text-red-500 border-b border-[var(--app-divider)]">
                                {error}
                            </div>
                        )}

                        {/* Email List */}
                        {isLoading ? (
                            <div className="px-3 py-4 flex justify-center">
                                <Spinner size="sm" label="Loading..." />
                            </div>
                        ) : emails.length === 0 ? (
                            <div className="px-3 py-4 text-center text-sm text-[var(--app-hint)]">
                                No emails configured. All emails are allowed.
                            </div>
                        ) : (
                            <div className="divide-y divide-[var(--app-divider)]">
                                {emails.map((email) => (
                                    <div
                                        key={email}
                                        className="px-3 py-2 flex items-center justify-between gap-2"
                                    >
                                        <span className="text-sm truncate">{email}</span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveEmail(email)}
                                            disabled={removeMutation.isPending}
                                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--app-hint)] hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                            title="Remove email"
                                        >
                                            <TrashIcon />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
