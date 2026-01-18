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

    // 简化的 Service Worker 注册
    // 不再自动检查更新，完全依赖用户手动刷新
    // 版本更新提醒通过 useVersionCheck hook 显示
    registerSW({
        immediate: true,
        onNeedRefresh() {
            // 只记录日志，不触发任何自动刷新
            // 用户会看到版本更新提示横幅，可以手动点击刷新
            console.log('[SW] New version available - user can manually refresh')
            window.dispatchEvent(new CustomEvent('sw-update-available', { detail: {} }))
        },
        onOfflineReady() {
            console.log('[SW] App ready for offline use')
        },
        onRegistered(registration) {
            if (registration) {
                console.log('[SW] Service worker registered')
                // 不再设置任何自动更新检查
                // 版本检查完全由 useVersionCheck hook 处理（只显示提醒，不自动刷新）
            }
        },
        onRegisterError(error) {
            console.error('[SW] Registration error:', error)
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
