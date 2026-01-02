import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionViewer } from '@/types/api'

function EyeIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    )
}

function formatViewerName(email: string): string {
    return email.split('@')[0] ?? email
}

export function ViewersBadge(props: { viewers: SessionViewer[] }) {
    const { viewers } = props
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

    if (viewers.length === 0) {
        return null
    }

    const displayText = viewers.length === 1
        ? formatViewerName(viewers[0].email)
        : `${viewers.length} online`

    return (
        <div
            ref={containerRef}
            className="relative shrink-0"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <button
                type="button"
                onClick={handleClick}
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-600 hover:bg-blue-500/25 transition-colors"
            >
                <EyeIcon />
                <span>{displayText}</span>
            </button>

            {isOpen && (
                <div
                    className="absolute z-50 top-full left-0 mt-1 min-w-[160px] max-w-[240px] py-1.5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-divider)] shadow-lg"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                >
                    <div className="px-2.5 py-1 text-[10px] font-medium text-[var(--app-hint)] uppercase tracking-wide">
                        Viewing now
                    </div>
                    {viewers.map((viewer) => (
                        <div
                            key={viewer.clientId}
                            className="px-2.5 py-1.5 flex items-center gap-2"
                        >
                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium text-[var(--app-fg)] truncate">
                                    {formatViewerName(viewer.email)}
                                </div>
                                {viewer.deviceType && (
                                    <div className="text-[10px] text-[var(--app-hint)] truncate">
                                        {viewer.deviceType}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
