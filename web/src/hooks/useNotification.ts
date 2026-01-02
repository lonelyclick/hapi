import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { getPlatform } from './usePlatform'

const NOTIFICATION_PERMISSION_KEY = 'hapi-notification-enabled'

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
    onClick?: () => void
}

/**
 * 显示任务完成通知
 * - App 在前台时：显示 Toast 卡片
 * - App 在后台时：显示系统推送通知
 */
export function notifyTaskComplete(notification: TaskCompleteNotification): void {
    const { sessionId, title, onClick } = notification
    const platform = getPlatform()
    const isVisible = document.visibilityState === 'visible'
    const isEnabled = getStoredPreference()

    if (isVisible) {
        // App 在前台 - 显示 Toast（始终显示，不受 enabled 开关控制）
        platform.haptic.notification('success')
        toast.success(title, {
            description: 'Task completed',
            action: onClick ? {
                label: 'View',
                onClick,
            } : undefined,
            id: `task-complete-${sessionId}`,
        })
    } else if (isEnabled && 'Notification' in window && Notification.permission === 'granted') {
        // App 在后台 - 显示系统通知
        const options: NotificationOptions & { renotify?: boolean } = {
            body: title,
            icon: '/pwa-192x192.png',
            badge: '/pwa-64x64.png',
            tag: `task-complete-${sessionId}`,
            renotify: true,
        }
        const notif = new Notification('Task Completed', options)

        if (onClick) {
            notif.onclick = () => {
                window.focus()
                onClick()
                notif.close()
            }
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
