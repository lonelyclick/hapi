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

    // Aggressive SW update: force reload when controller changes
    let refreshing = false
    navigator.serviceWorker?.addEventListener('controllerchange', () => {
        if (refreshing) return
        refreshing = true
        console.log('New service worker activated, reloading...')
        window.location.reload()
    })

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
                // Helper function to force activate waiting SW
                const activateWaitingSW = () => {
                    if (registration.waiting) {
                        console.log('Found waiting SW, activating immediately...')
                        registration.waiting.postMessage({ type: 'SKIP_WAITING' })
                    }
                }

                // Check for waiting SW on load (user may have ignored update prompt before)
                activateWaitingSW()

                // Also listen for state changes
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                console.log('New SW installed, activating...')
                                newWorker.postMessage({ type: 'SKIP_WAITING' })
                            }
                        })
                    }
                })

                // Check for updates immediately on load
                registration.update()

                // Check for updates every 30 seconds (more aggressive for iOS)
                setInterval(() => {
                    registration.update().then(() => {
                        activateWaitingSW()
                    })
                }, 30 * 1000)

                // iOS Safari PWA: check for updates when app returns from background
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        console.log('App visible, checking for updates...')
                        registration.update().then(() => {
                            activateWaitingSW()
                        })
                    }
                })

                // iOS Safari: also check on focus (belt and suspenders)
                window.addEventListener('focus', () => {
                    console.log('Window focused, checking for updates...')
                    registration.update().then(() => {
                        activateWaitingSW()
                    })
                })

                // Check on online event (network reconnection)
                window.addEventListener('online', () => {
                    console.log('Back online, checking for updates...')
                    registration.update().then(() => {
                        activateWaitingSW()
                    })
                })

                // iOS Safari: also check on page show (for bfcache)
                window.addEventListener('pageshow', (event) => {
                    if (event.persisted) {
                        console.log('Page restored from bfcache, checking for updates...')
                        registration.update().then(() => {
                            activateWaitingSW()
                        })
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
