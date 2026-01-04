import { useState, useCallback, useEffect } from 'react'
import type { AdvisorAlertData } from '@/types/api'

export type AdvisorAlert = AdvisorAlertData & {
    id: string
    timestamp: number
}

// 全局状态 - 用于跨组件共享
let globalAlerts: AdvisorAlert[] = []
let listeners: Set<() => void> = new Set()

function notifyListeners() {
    listeners.forEach(fn => fn())
}

export function addAlert(data: AdvisorAlertData): void {
    const alert: AdvisorAlert = {
        ...data,
        id: `${data.suggestionId}-${Date.now()}`,
        timestamp: Date.now()
    }

    // 去重：同一个 suggestionId 只保留最新的
    globalAlerts = globalAlerts.filter(a => a.suggestionId !== data.suggestionId)
    globalAlerts.push(alert)

    // 限制最多显示 5 个
    if (globalAlerts.length > 5) {
        globalAlerts = globalAlerts.slice(-5)
    }

    notifyListeners()
}

export function dismissAlert(id: string): void {
    globalAlerts = globalAlerts.filter(a => a.id !== id)
    notifyListeners()
}

export function dismissAllAlerts(): void {
    globalAlerts = []
    notifyListeners()
}

export function useAdvisorAlerts(): {
    alerts: AdvisorAlert[]
    dismiss: (id: string) => void
    dismissAll: () => void
} {
    const [, forceUpdate] = useState({})

    useEffect(() => {
        const listener = () => forceUpdate({})
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
        }
    }, [])

    const dismiss = useCallback((id: string) => {
        dismissAlert(id)
    }, [])

    const dismissAllCallback = useCallback(() => {
        dismissAllAlerts()
    }, [])

    return {
        alerts: globalAlerts,
        dismiss,
        dismissAll: dismissAllCallback
    }
}
