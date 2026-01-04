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
    const updateIntervalMs = isIOS ? 2 * 60 * 1000 : 30 * 1000
    const updateDisableKey = 'hapi-sw-disable-until'
    const updateLastLoadKey = 'hapi-sw-last-load'
    const updateLoopThresholdMs = 8_000
    const updateLoopCooldownMs = 5 * 60 * 1000

    try {
        const now = Date.now()
        const lastLoad = Number(sessionStorage.getItem(updateLastLoadKey) ?? 0)
        if (lastLoad && now - lastLoad < updateLoopThresholdMs) {
            sessionStorage.setItem(updateDisableKey, String(now + updateLoopCooldownMs))
        }
        sessionStorage.setItem(updateLastLoadKey, String(now))
    } catch {
        // Ignore if storage is unavailable.
    }

    // Listen for SW update messages and reload when notified
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data?.type === 'SW_UPDATED') {
                console.log('[bootstrap] SW updated to version:', event.data.version)
                // Give a small delay to ensure caches are cleared, then reload
                setTimeout(() => {
                    window.location.reload()
                }, 100)
            }
        })
    }

    const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
            // Auto update without asking - especially important for Telegram Mini App
            // where confirm() dialogs may not work properly
            console.log('New version available, updating...')
            updateSW(true)
        },
        onOfflineReady() {
            console.log('App ready for offline use')
        },
        onRegistered(registration) {
            if (registration) {
                let lastUpdateCheckAt = 0
                const isAutoUpdatePaused = () => {
                    try {
                        const disableUntil = Number(sessionStorage.getItem(updateDisableKey) ?? 0)
                        return Date.now() < disableUntil
                    } catch {
                        return false
                    }
                }
                const checkForUpdates = () => {
                    const now = Date.now()
                    if (isAutoUpdatePaused()) return
                    if (now - lastUpdateCheckAt < 10_000) return
                    lastUpdateCheckAt = now
                    registration.update().catch((error) => {
                        console.warn('SW update check failed:', error)
                    })
                }

                // Check for updates immediately on load
                checkForUpdates()

                // Check for updates periodically (iOS uses a longer interval to avoid loops)
                setInterval(checkForUpdates, updateIntervalMs)

                // iOS Safari PWA: check for updates when app returns from background
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        console.log('App visible, checking for updates...')
                        checkForUpdates()
                    }
                })

                // iOS Safari: also check on focus (belt and suspenders)
                window.addEventListener('focus', () => {
                    console.log('Window focused, checking for updates...')
                    checkForUpdates()
                })

                // Check on online event (network reconnection)
                window.addEventListener('online', () => {
                    console.log('Back online, checking for updates...')
                    checkForUpdates()
                })

                // iOS Safari: also check on page show (for bfcache)
                window.addEventListener('pageshow', (event) => {
                    if (event.persisted) {
                        console.log('Page restored from bfcache, checking for updates...')
                        checkForUpdates()
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
