import { useEffect, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { LoadingState } from '@/components/LoadingState'

/**
 * AcceptInvitationPage - 接受组织邀请页面
 * 通过邮件链接进入，自动接受邀请并跳转到组织
 */
export function AcceptInvitationPage() {
    const { api, userEmail } = useAppContext()
    const navigate = useNavigate()
    const { invitationId } = useParams({ from: '/invitations/accept/$invitationId' })
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
    const [error, setError] = useState<string>('')

    useEffect(() => {
        const acceptInvitation = async () => {
            if (!userEmail) {
                // 未登录，跳转到登录页，登录后回到这里
                navigate({ to: '/login', search: { redirect: `/invitations/accept/${invitationId}` } })
                return
            }

            try {
                setStatus('loading')
                const response = await api.acceptInvitation(invitationId)

                if (response.ok) {
                    setStatus('success')
                    // 等待 1 秒后跳转到组织列表
                    setTimeout(() => {
                        navigate({ to: '/' })
                    }, 1000)
                } else {
                    setStatus('error')
                    setError('Failed to accept invitation')
                }
            } catch (err) {
                setStatus('error')
                setError(err instanceof Error ? err.message : 'Failed to accept invitation')
            }
        }

        acceptInvitation()
    }, [api, invitationId, navigate, userEmail])

    return (
        <div className="flex h-full items-center justify-center p-4">
            <div className="w-full max-w-md text-center space-y-6">
                {/* Icon */}
                <div className="flex justify-center">
                    <div className={`flex h-16 w-16 items-center justify-center rounded-full ${
                        status === 'loading' ? 'bg-gradient-to-br from-indigo-500 to-purple-600' :
                        status === 'success' ? 'bg-gradient-to-br from-green-500 to-emerald-600' :
                        'bg-gradient-to-br from-red-500 to-rose-600'
                    } shadow-lg`}>
                        {status === 'loading' && (
                            <LoadingState label="" className="text-white" />
                        )}
                        {status === 'success' && (
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        )}
                        {status === 'error' && (
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        )}
                    </div>
                </div>

                {/* Status Message */}
                {status === 'loading' && (
                    <div>
                        <h2 className="text-xl font-bold text-[var(--app-fg)] mb-2">Accepting Invitation</h2>
                        <p className="text-sm text-[var(--app-hint)]">Please wait...</p>
                    </div>
                )}

                {status === 'success' && (
                    <div>
                        <h2 className="text-xl font-bold text-[var(--app-fg)] mb-2">✓ Invitation Accepted!</h2>
                        <p className="text-sm text-[var(--app-hint)]">
                            Redirecting to your organization...
                        </p>
                    </div>
                )}

                {status === 'error' && (
                    <div>
                        <h2 className="text-xl font-bold text-[var(--app-fg)] mb-2">Failed to Accept Invitation</h2>
                        <p className="text-sm text-red-500 mb-4">{error}</p>
                        <div className="space-y-2">
                            <p className="text-xs text-[var(--app-hint)]">
                                This invitation may have expired, been revoked, or already accepted.
                            </p>
                            <button
                                type="button"
                                onClick={() => navigate({ to: '/' })}
                                className="mt-4 px-4 py-2 text-sm rounded bg-gradient-to-r from-indigo-500 to-purple-600 text-white"
                            >
                                Go to Dashboard
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default AcceptInvitationPage
