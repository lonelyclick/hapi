import { useEffect, useState, useCallback, useRef } from 'react'

const CACHED_VERSION_KEY = 'hapi-cached-version'

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

// Clear all caches and unregister service workers
async function clearAllCaches(): Promise<void> {
    try {
        // Clear Cache Storage
        if ('caches' in window) {
            const cacheNames = await caches.keys()
            await Promise.all(cacheNames.map(name => caches.delete(name)))
            console.log('[VersionCheck] Cleared all caches:', cacheNames)
        }

        // Unregister all service workers
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations()
            await Promise.all(registrations.map(reg => reg.unregister()))
            console.log('[VersionCheck] Unregistered service workers:', registrations.length)
        }

        // Clear session storage (except version key)
        const savedVersion = localStorage.getItem(CACHED_VERSION_KEY)
        sessionStorage.clear()
        if (savedVersion) {
            localStorage.setItem(CACHED_VERSION_KEY, savedVersion)
        }
    } catch (error) {
        console.warn('[VersionCheck] Failed to clear caches:', error)
    }
}

// Check if we need to force refresh on startup (version mismatch from last session)
function checkStartupVersionMismatch(serverVersion: string): boolean {
    try {
        const cachedVersion = localStorage.getItem(CACHED_VERSION_KEY)
        if (cachedVersion && cachedVersion !== serverVersion) {
            console.log(`[VersionCheck] Startup version mismatch: cached=${cachedVersion}, server=${serverVersion}`)
            return true
        }
        // Save current server version
        localStorage.setItem(CACHED_VERSION_KEY, serverVersion)
    } catch {
        // Ignore storage errors
    }
    return false
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
    const autoRefreshTriggered = useRef(false)

    const checkVersion = useCallback(async () => {
        try {
            const response = await fetch(`${baseUrl}/api/version`, {
                cache: 'no-store'
            })
            if (response.ok) {
                const data = await response.json()
                setServerVersion(data.version)

                // On first check, auto-refresh if version mismatch detected
                if (!autoRefreshTriggered.current && data.version) {
                    const needsRefresh = checkStartupVersionMismatch(data.version)
                    if (needsRefresh) {
                        autoRefreshTriggered.current = true
                        console.log('[VersionCheck] Auto-refreshing due to version mismatch...')
                        // Clear caches and reload
                        await clearAllCaches()
                        localStorage.setItem(CACHED_VERSION_KEY, data.version)
                        window.location.reload()
                        return
                    }
                }
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
        }, 1000) // Reduced delay for faster version check

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

    const refresh = useCallback(async () => {
        // Clear all caches before reloading
        await clearAllCaches()
        if (serverVersion) {
            localStorage.setItem(CACHED_VERSION_KEY, serverVersion)
        }
        // Force reload, bypassing cache
        window.location.reload()
    }, [serverVersion])

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
