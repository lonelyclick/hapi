import { useEffect, useState, useCallback, useRef } from 'react'

// Get the current version from the build-time injected JS bundle filename
function getCurrentVersion(): string {
    // Look for the index-*.js script tag
    const scripts = document.querySelectorAll('script[src*="index-"]')
    for (const script of scripts) {
        const src = script.getAttribute('src')
        if (src) {
            const match = src.match(/index-([^.]+)\.js/)
            if (match) {
                return match[1]
            }
        }
    }
    return 'unknown'
}

interface UseVersionCheckOptions {
    baseUrl: string
    enabled?: boolean
    checkInterval?: number // in ms, default 60s
}

interface UseVersionCheckResult {
    hasUpdate: boolean
    currentVersion: string
    serverVersion: string | null
    refresh: () => void
    dismiss: () => void
}

export function useVersionCheck(options: UseVersionCheckOptions): UseVersionCheckResult {
    const { baseUrl, enabled = true, checkInterval = 60_000 } = options

    const [currentVersion] = useState(() => getCurrentVersion())
    const [serverVersion, setServerVersion] = useState<string | null>(null)
    const [dismissed, setDismissed] = useState(false)
    const initialCheckDone = useRef(false)

    const checkVersion = useCallback(async () => {
        try {
            const response = await fetch(`${baseUrl}/api/version`, {
                cache: 'no-store'
            })
            if (response.ok) {
                const data = await response.json()
                setServerVersion(data.version)
            }
        } catch {
            // Silently ignore version check failures
        }
    }, [baseUrl])

    useEffect(() => {
        if (!enabled) return

        // Initial check (with delay to not block app startup)
        const initialTimeout = setTimeout(() => {
            if (!initialCheckDone.current) {
                initialCheckDone.current = true
                checkVersion()
            }
        }, 3000)

        // Periodic checks
        const interval = setInterval(checkVersion, checkInterval)

        // Check on visibility change (when user comes back to the app)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                checkVersion()
            }
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            clearTimeout(initialTimeout)
            clearInterval(interval)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [enabled, checkInterval, checkVersion])

    const hasUpdate = Boolean(
        serverVersion &&
        currentVersion !== 'unknown' &&
        serverVersion !== 'unknown' &&
        serverVersion !== currentVersion &&
        !dismissed
    )

    const refresh = useCallback(() => {
        // Force reload, bypassing cache
        window.location.reload()
    }, [])

    const dismiss = useCallback(() => {
        setDismissed(true)
    }, [])

    return {
        hasUpdate,
        currentVersion,
        serverVersion,
        refresh,
        dismiss
    }
}
