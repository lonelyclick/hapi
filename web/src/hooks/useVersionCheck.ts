import { useEffect, useState, useCallback, useRef } from 'react'

const CACHED_VERSION_KEY = 'hapi-cached-version'
const LAST_REFRESH_KEY = 'hapi-last-refresh-ts'
const REFRESH_COOLDOWN_MS = 30_000 // 30 seconds cooldown between refreshes

// Check if we're in iOS standalone mode (webapp)
function isIOSStandalone(): boolean {
    return (
        ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true) ||
        window.matchMedia('(display-mode: standalone)').matches
    )
}

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

// Check if we recently refreshed (to prevent infinite refresh loops)
function wasRecentlyRefreshed(): boolean {
    const lastRefresh = localStorage.getItem(LAST_REFRESH_KEY)
    if (!lastRefresh) return false
    const elapsed = Date.now() - parseInt(lastRefresh, 10)
    return elapsed < REFRESH_COOLDOWN_MS
}

// Mark that we just refreshed
function markRefreshed(): void {
    localStorage.setItem(LAST_REFRESH_KEY, Date.now().toString())
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
    const [dismissed, setDismissed] = useState(() => {
        // If we recently refreshed, auto-dismiss to prevent infinite loops
        if (wasRecentlyRefreshed()) {
            console.log('[VersionCheck] Recently refreshed, auto-dismissing update prompt')
            return true
        }
        return false
    })
    const initialCheckDone = useRef(false)
    const isIOS = useRef(isIOSStandalone())

    const checkVersion = useCallback(async () => {
        try {
            const response = await fetch(`${baseUrl}/api/version`, {
                cache: 'no-store'
            })
            if (response.ok) {
                const data = await response.json()
                setServerVersion(data.version)

                // On first check, just save the server version (no auto-refresh)
                // User will see update banner and can manually refresh
                if (data.version) {
                    localStorage.setItem(CACHED_VERSION_KEY, data.version)
                }
            }
        } catch {
            // Silently ignore version check failures
        }
    }, [baseUrl])

    useEffect(() => {
        if (!enabled) return

        // Initial check (with delay to not block app startup)
        // Longer delay on iOS standalone to prevent issues
        const initialDelay = isIOS.current ? 3000 : 1000
        const initialTimeout = setTimeout(() => {
            if (!initialCheckDone.current) {
                initialCheckDone.current = true
                checkVersion()
            }
        }, initialDelay)

        // Periodic checks (less frequent on iOS)
        const actualInterval = isIOS.current ? Math.max(checkInterval, 120_000) : checkInterval
        const interval = setInterval(checkVersion, actualInterval)

        // Check on visibility change (when user comes back to the app)
        // But skip if we recently refreshed (iOS infinite loop prevention)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                if (wasRecentlyRefreshed()) {
                    console.log('[VersionCheck] Skipping visibility check - recently refreshed')
                    return
                }
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
        // Mark that we're refreshing to prevent infinite loops
        markRefreshed()
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
