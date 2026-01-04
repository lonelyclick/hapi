/**
 * 空闲建议状态管理 Hook
 * 用于管理会话静默后的 Advisor 建议
 */

import { useState, useCallback, useEffect } from 'react'

export interface IdleSuggestion {
    suggestionId: string
    sessionId: string
    title: string
    detail: string
    reason: string
    category: 'todo_check' | 'error_analysis' | 'code_review' | 'general'
    severity: 'low' | 'medium' | 'high' | 'critical'
    suggestedText?: string
    createdAt: number
}

interface StoredIdleSuggestion {
    suggestion: IdleSuggestion
    status: 'pending' | 'applied' | 'dismissed'
    createdAt: number
    viewedAt?: number
}

const STORAGE_KEY_PREFIX = 'hapi:idle-suggestion:'

// 全局状态管理
let globalSuggestions: Map<string, StoredIdleSuggestion> = new Map()
let listeners: Set<() => void> = new Set()

function notifyListeners() {
    listeners.forEach(fn => fn())
}

function loadFromStorage(sessionId: string): StoredIdleSuggestion | null {
    try {
        const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`)
        if (!raw) return null
        const stored = JSON.parse(raw) as StoredIdleSuggestion
        // 检查是否过期（24小时）
        if (Date.now() - stored.createdAt > 24 * 60 * 60 * 1000) {
            localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`)
            return null
        }
        return stored
    } catch {
        return null
    }
}

function saveToStorage(sessionId: string, data: StoredIdleSuggestion): void {
    try {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${sessionId}`, JSON.stringify(data))
    } catch {
        // ignore storage errors
    }
}

function removeFromStorage(sessionId: string): void {
    try {
        localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`)
    } catch {
        // ignore
    }
}

/**
 * 添加空闲建议（供 SSE 事件处理调用）
 */
export function addIdleSuggestion(suggestion: IdleSuggestion): void {
    const stored: StoredIdleSuggestion = {
        suggestion,
        status: 'pending',
        createdAt: Date.now()
    }
    globalSuggestions.set(suggestion.sessionId, stored)
    saveToStorage(suggestion.sessionId, stored)
    notifyListeners()
}

/**
 * 获取指定会话的空闲建议
 */
export function getIdleSuggestion(sessionId: string): IdleSuggestion | null {
    const stored = globalSuggestions.get(sessionId)
    if (stored?.status === 'pending') {
        return stored.suggestion
    }
    return null
}

/**
 * 空闲建议管理 Hook
 */
export function useIdleSuggestion(sessionId: string | null) {
    const [, forceUpdate] = useState({})

    useEffect(() => {
        const listener = () => forceUpdate({})
        listeners.add(listener)

        // 初始化时从 localStorage 加载
        if (sessionId) {
            const stored = loadFromStorage(sessionId)
            if (stored && stored.status === 'pending') {
                globalSuggestions.set(sessionId, stored)
            }
        }

        return () => {
            listeners.delete(listener)
        }
    }, [sessionId])

    const stored = sessionId ? globalSuggestions.get(sessionId) : null
    const hasPendingSuggestion = stored?.status === 'pending'

    const apply = useCallback(() => {
        if (!sessionId || !stored) return undefined
        const updated = { ...stored, status: 'applied' as const }
        globalSuggestions.set(sessionId, updated)
        saveToStorage(sessionId, updated)
        notifyListeners()
        return stored.suggestion.suggestedText
    }, [sessionId, stored])

    const dismiss = useCallback(() => {
        if (!sessionId) return
        globalSuggestions.delete(sessionId)
        removeFromStorage(sessionId)
        notifyListeners()
    }, [sessionId])

    const markViewed = useCallback(() => {
        if (!sessionId || !stored || stored.viewedAt) return
        const updated = { ...stored, viewedAt: Date.now() }
        globalSuggestions.set(sessionId, updated)
        saveToStorage(sessionId, updated)
    }, [sessionId, stored])

    return {
        suggestion: hasPendingSuggestion ? stored.suggestion : null,
        hasPendingSuggestion,
        apply,
        dismiss,
        markViewed
    }
}
