import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import './index.css'
import { registerSW } from 'virtual:pwa-register'
import { getTelegramWebApp, isTelegramEnvironment, loadTelegramSdk } from './hooks/useTelegram'
import { queryClient } from './lib/query-client'
import { createAppRouter } from './router'

function getStartParam(): string | null {
    const query = new URLSearchParams(window.location.search)
    const fromQuery = query.get('startapp') || query.get('tgWebAppStartParam')
    if (fromQuery) return fromQuery

    return getTelegramWebApp()?.initDataUnsafe?.start_param ?? null
}

function getDeepLinkedSessionId(): string | null {
    const startParam = getStartParam()
    if (startParam?.startsWith('session_')) {
        return startParam.slice('session_'.length)
    }
    return null
}

function getInitialPath(): string {
    const sessionId = getDeepLinkedSessionId()
    return sessionId ? `/sessions/${sessionId}` : '/sessions'
}

async function bootstrap() {
    // Only load Telegram SDK in Telegram environment (with 3s timeout)
    const isTelegram = isTelegramEnvironment()
    if (isTelegram) {
        await loadTelegramSdk()
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const isStandalone = ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true) ||
        window.matchMedia('(display-mode: standalone)').matches
    const isIOSWebApp = isIOS && isStandalone

    // iOS webapp needs more conservative update checking
    const updateIntervalMs = isIOSWebApp ? 5 * 60 * 1000 : (isIOS ? 2 * 60 * 1000 : 30 * 1000)
    const updateDisableKey = 'hapi-sw-disable-until'
    const updateLastLoadKey = 'hapi-sw-last-load'
    const lastRefreshKey = 'hapi-last-refresh-ts'
    const updateLoopThresholdMs = isIOSWebApp ? 15_000 : 8_000
    const updateLoopCooldownMs = isIOSWebApp ? 10 * 60 * 1000 : 5 * 60 * 1000

    // Use localStorage for iOS webapp (more persistent than sessionStorage)
    const storage = isIOSWebApp ? localStorage : sessionStorage

    try {
        const now = Date.now()
        const lastLoad = Number(storage.getItem(updateLastLoadKey) ?? 0)
        const lastRefresh = Number(localStorage.getItem(lastRefreshKey) ?? 0)

        // Check for rapid reload loop
        if (lastLoad && now - lastLoad < updateLoopThresholdMs) {
            console.warn('[bootstrap] Detected rapid reload loop, disabling SW updates temporarily')
            storage.setItem(updateDisableKey, String(now + updateLoopCooldownMs))
        }

        // Also disable if we recently did a manual refresh
        if (lastRefresh && now - lastRefresh < 30_000) {
            console.log('[bootstrap] Recently refreshed, extending SW update cooldown')
            storage.setItem(updateDisableKey, String(Math.max(
                Number(storage.getItem(updateDisableKey) ?? 0),
                now + 60_000
            )))
        }

        storage.setItem(updateLastLoadKey, String(now))
    } catch {
        // Ignore if storage is unavailable.
    }

    // Listen for SW update messages (no auto-reload, just log)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data?.type === 'SW_UPDATED') {
                console.log('[bootstrap] SW updated to version:', event.data.version)
                // User will see update banner and can manually refresh
            }
        })
    }

    const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
            // Show update banner instead of auto-updating
            // User needs to click to trigger the update
            console.log('New version available, waiting for user action...')
            window.dispatchEvent(new CustomEvent('sw-update-available', { detail: { updateSW } }))
        },
        onOfflineReady() {
            console.log('App ready for offline use')
        },
        onRegistered(registration) {
            if (registration) {
                let lastUpdateCheckAt = 0
                const isAutoUpdatePaused = () => {
                    try {
                        const disableUntil = Number(storage.getItem(updateDisableKey) ?? 0)
                        if (Date.now() < disableUntil) {
                            return true
                        }
                        // Also check if we recently refreshed
                        const lastRefresh = Number(localStorage.getItem(lastRefreshKey) ?? 0)
                        if (lastRefresh && Date.now() - lastRefresh < 30_000) {
                            return true
                        }
                        return false
                    } catch {
                        return false
                    }
                }
                const checkForUpdates = () => {
                    const now = Date.now()
                    if (isAutoUpdatePaused()) {
                        console.log('[SW] Update check paused (cooldown active)')
                        return
                    }
                    // iOS webapp: use longer minimum interval
                    const minInterval = isIOSWebApp ? 30_000 : 10_000
                    if (now - lastUpdateCheckAt < minInterval) return
                    lastUpdateCheckAt = now
                    registration.update().catch((error) => {
                        console.warn('SW update check failed:', error)
                    })
                }

                // Check for updates immediately on load (but respect cooldown)
                setTimeout(checkForUpdates, isIOSWebApp ? 5000 : 1000)

                // Check for updates periodically (iOS uses a longer interval to avoid loops)
                setInterval(checkForUpdates, updateIntervalMs)

                // iOS Safari PWA: check for updates when app returns from background
                // But be more conservative on iOS webapp
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        if (isIOSWebApp) {
                            // Delay check on iOS webapp to avoid rapid loops
                            setTimeout(() => {
                                console.log('App visible (iOS webapp), checking for updates...')
                                checkForUpdates()
                            }, 2000)
                        } else {
                            console.log('App visible, checking for updates...')
                            checkForUpdates()
                        }
                    }
                })

                // iOS Safari: also check on focus (but skip for iOS webapp to avoid loops)
                if (!isIOSWebApp) {
                    window.addEventListener('focus', () => {
                        console.log('Window focused, checking for updates...')
                        checkForUpdates()
                    })
                }

                // Check on online event (network reconnection)
                window.addEventListener('online', () => {
                    console.log('Back online, checking for updates...')
                    checkForUpdates()
                })

                // iOS Safari: also check on page show (for bfcache)
                // But be conservative on iOS webapp
                window.addEventListener('pageshow', (event) => {
                    if (event.persisted) {
                        if (isIOSWebApp) {
                            setTimeout(() => {
                                console.log('Page restored from bfcache (iOS webapp), checking for updates...')
                                checkForUpdates()
                            }, 3000)
                        } else {
                            console.log('Page restored from bfcache, checking for updates...')
                            checkForUpdates()
                        }
                    }
                })
            }
        },
        onRegisterError(error) {
            console.error('SW registration error:', error)
        }
    })

    const history = isTelegram
        ? createMemoryHistory({ initialEntries: [getInitialPath()] })
        : undefined
    const router = createAppRouter(history)

    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <QueryClientProvider client={queryClient}>
                <RouterProvider router={router} />
                {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
            </QueryClientProvider>
        </React.StrictMode>
    )
}

bootstrap()
