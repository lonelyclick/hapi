import { createElement, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { getPlatform } from './usePlatform'

const NOTIFICATION_PERMISSION_KEY = 'hapi-notification-enabled'
const PENDING_NOTIFICATION_KEY = 'hapi-pending-notification'

export type PendingNotification = {
    sessionId: string
    timestamp: number
}

export function getPendingNotification(): PendingNotification | null {
    try {
        const raw = localStorage.getItem(PENDING_NOTIFICATION_KEY)
        if (!raw) return null
        const pending = JSON.parse(raw) as PendingNotification
        // 5分钟内有效
        if (Date.now() - pending.timestamp > 5 * 60 * 1000) {
            localStorage.removeItem(PENDING_NOTIFICATION_KEY)
            return null
        }
        return pending
    } catch {
        return null
    }
}

export function clearPendingNotification(): void {
    try {
        localStorage.removeItem(PENDING_NOTIFICATION_KEY)
    } catch {
        // ignore
    }
}

function setPendingNotification(sessionId: string): void {
    try {
        localStorage.setItem(PENDING_NOTIFICATION_KEY, JSON.stringify({
            sessionId,
            timestamp: Date.now()
        }))
    } catch {
        // ignore
    }
}

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

function getStoredPreference(): boolean {
    try {
        return localStorage.getItem(NOTIFICATION_PERMISSION_KEY) === 'true'
    } catch {
        return false
    }
}

function setStoredPreference(enabled: boolean): void {
    try {
        localStorage.setItem(NOTIFICATION_PERMISSION_KEY, String(enabled))
    } catch {
        // Ignore storage errors
    }
}

export function useNotificationPermission() {
    const [permission, setPermission] = useState<NotificationPermissionState>(() => {
        if (typeof window === 'undefined' || !('Notification' in window)) {
            return 'unsupported'
        }
        return Notification.permission as NotificationPermissionState
    })
    const [enabled, setEnabled] = useState(() => getStoredPreference())

    const requestPermission = useCallback(async () => {
        if (!('Notification' in window)) {
            return 'unsupported' as const
        }

        try {
            const result = await Notification.requestPermission()
            setPermission(result as NotificationPermissionState)
            if (result === 'granted') {
                setEnabled(true)
                setStoredPreference(true)
            }
            return result as NotificationPermissionState
        } catch {
            return 'denied' as const
        }
    }, [])

    const toggleEnabled = useCallback((value: boolean) => {
        setEnabled(value)
        setStoredPreference(value)
    }, [])

    return {
        permission,
        enabled,
        setEnabled: toggleEnabled,
        requestPermission,
        isSupported: permission !== 'unsupported',
    }
}

export type TaskCompleteNotification = {
    sessionId: string
    title: string
    project?: string
    onClick?: () => void
}

/**
 * 显示任务完成通知
 * - App 在前台时：显示 Toast 卡片
 * - App 在后台时：显示系统推送通知
 */
export function notifyTaskComplete(notification: TaskCompleteNotification): void {
    const { sessionId, title, project, onClick } = notification
    const platform = getPlatform()
    const isVisible = document.visibilityState === 'visible'
    const isEnabled = getStoredPreference()
    const hasNotificationAPI = 'Notification' in window
    const notificationPermission = hasNotificationAPI ? Notification.permission : 'unsupported'

    console.log('[notification] notifyTaskComplete', {
        isVisible,
        isEnabled,
        hasNotificationAPI,
        notificationPermission,
        sessionId
    })

    if (isVisible) {
        // App 在前台 - 显示 Toast（始终显示，不受 enabled 开关控制）
        platform.haptic.notification('success')
        const toastId = `task-complete-${sessionId}`
        toast.custom(
            (t) => createElement(
                'div',
                {
                    onClick: () => {
                        onClick?.()
                        toast.dismiss(t)
                    },
                    className: 'w-full flex items-center gap-3 p-3 rounded-xl shadow-lg border backdrop-blur-sm cursor-pointer active:opacity-80',
                    style: {
                        backgroundColor: 'var(--app-bg)',
                        borderColor: 'rgba(16, 185, 129, 0.3)',
                    }
                },
                createElement(
                    'div',
                    { className: 'flex-1 min-w-0' },
                    createElement(
                        'div',
                        {
                            className: 'text-sm font-medium truncate',
                            style: { color: 'var(--app-fg)' }
                        },
                        project || 'Task completed'
                    ),
                    createElement(
                        'div',
                        {
                            className: 'text-xs truncate mt-0.5',
                            style: { color: 'var(--app-hint)' }
                        },
                        title
                    )
                )
            ),
            { id: toastId }
        )
    } else if (isEnabled && hasNotificationAPI && notificationPermission === 'granted') {
        // App 在后台 - 显示系统通知
        const body = project ? `${title}\n${project}` : title
        const options: NotificationOptions & { renotify?: boolean } = {
            body,
            icon: '/pwa-192x192.png',
            badge: '/pwa-64x64.png',
            tag: `task-complete-${sessionId}`,
            renotify: true,
        }
        console.log('[notification] creating system notification', { body, options })
        try {
            // 存储待跳转信息，用于 iOS PWA 点击通知后恢复 app 时自动跳转
            setPendingNotification(sessionId)

            const notif = new Notification('Task Completed', options)
            console.log('[notification] system notification created', notif)

            notif.onclick = () => {
                console.log('[notification] system notification clicked')
                clearPendingNotification()
                window.focus()
                onClick?.()
                notif.close()
            }
        } catch (error) {
            console.error('[notification] failed to create notification', error)
        }
    }
}

/**
 * Hook 版本，自动获取当前路由导航能力
 */
export function useTaskCompleteNotification() {
    const notify = useCallback((notification: TaskCompleteNotification) => {
        notifyTaskComplete(notification)
    }, [])

    return { notify }
}
