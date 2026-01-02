import { useCallback, useEffect, useRef, useState } from 'react'
import type { OnlineUser } from '@/types/api'

function formatViewerName(email: string): string {
    return email.split('@')[0] ?? email
}

function formatSessionName(sessionId: string | null): string {
    if (!sessionId) return 'Home'
    return sessionId.slice(0, 8)
}

export function OnlineUsersBadge(props: { users: OnlineUser[] }) {
    const { users } = props
    const [isOpen, setIsOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleMouseEnter = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
            timeoutRef.current = null
        }
        setIsOpen(true)
    }, [])

    const handleMouseLeave = useCallback(() => {
        timeoutRef.current = setTimeout(() => {
            setIsOpen(false)
        }, 150)
    }, [])

    const handleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        setIsOpen(prev => !prev)
    }, [])

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return

        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }

        document.addEventListener('click', handleClickOutside, true)
        return () => document.removeEventListener('click', handleClickOutside, true)
    }, [isOpen])

    // Cleanup timeout
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current)
            }
        }
    }, [])

    if (users.length === 0) {
        return null
    }

    return (
        <div
            ref={containerRef}
            className="relative"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <button
                type="button"
                onClick={handleClick}
                className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 transition-colors"
            >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {users.length} online
            </button>

            {isOpen && (
                <div
                    className="absolute z-50 top-full right-0 mt-1 min-w-[180px] max-w-[280px] py-1.5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-divider)] shadow-lg"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                >
                    <div className="px-2.5 py-1 text-[10px] font-medium text-[var(--app-hint)] uppercase tracking-wide">
                        Online now
                    </div>
                    {users.map((user) => (
                        <div
                            key={user.clientId}
                            className="px-2.5 py-1.5 flex items-center gap-2"
                        >
                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium text-[var(--app-fg)] truncate">
                                    {formatViewerName(user.email)}
                                </div>
                                <div className="text-[10px] text-[var(--app-hint)] truncate">
                                    {user.deviceType ?? 'Unknown'}
                                    {user.sessionId && ` • ${formatSessionName(user.sessionId)}`}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
