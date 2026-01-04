/**
 * 空闲建议状态管理 Hook
 * 用于管理会话静默后的 Advisor 建议芯片
 */

import { useState, useCallback, useEffect } from 'react'

export interface SuggestionChip {
    id: string
    label: string           // 简短标签（如 "继续任务"）
    text: string            // 点击后填入输入框的完整文本
    category: 'todo_check' | 'error_analysis' | 'code_review' | 'general'
    icon?: string           // 可选图标（emoji）
}

export interface IdleSuggestion {
    suggestionId: string
    sessionId: string
    chips: SuggestionChip[]  // 多个建议芯片
    reason: string           // 触发原因
    createdAt: number
}

interface StoredIdleSuggestion {
    suggestion: IdleSuggestion
    status: 'pending' | 'applied' | 'dismissed'
    createdAt: number
    viewedAt?: number
    usedChipIds?: string[]  // 已使用的芯片 ID
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
        createdAt: Date.now(),
        usedChipIds: []
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

    // 获取未使用的芯片
    const availableChips = hasPendingSuggestion && stored?.suggestion.chips
        ? stored.suggestion.chips.filter(chip => !stored.usedChipIds?.includes(chip.id))
        : []

    // 应用指定芯片
    const applyChip = useCallback((chipId: string): string | undefined => {
        if (!sessionId || !stored) return undefined
        const chip = stored.suggestion.chips.find(c => c.id === chipId)
        if (!chip) return undefined

        const usedChipIds = [...(stored.usedChipIds || []), chipId]
        const remainingChips = stored.suggestion.chips.filter(c => !usedChipIds.includes(c.id))

        // 如果所有芯片都已使用，标记为已应用
        const newStatus = remainingChips.length === 0 ? 'applied' as const : 'pending' as const
        const updated = { ...stored, status: newStatus, usedChipIds }

        globalSuggestions.set(sessionId, updated)
        saveToStorage(sessionId, updated)
        notifyListeners()

        return chip.text
    }, [sessionId, stored])

    // 关闭所有建议
    const dismiss = useCallback(() => {
        if (!sessionId) return
        globalSuggestions.delete(sessionId)
        removeFromStorage(sessionId)
        notifyListeners()
    }, [sessionId])

    // 标记已查看
    const markViewed = useCallback(() => {
        if (!sessionId || !stored || stored.viewedAt) return
        const updated = { ...stored, viewedAt: Date.now() }
        globalSuggestions.set(sessionId, updated)
        saveToStorage(sessionId, updated)
    }, [sessionId, stored])

    return {
        suggestion: hasPendingSuggestion ? stored.suggestion : null,
        chips: availableChips,
        hasChips: availableChips.length > 0,
        hasPendingSuggestion,
        applyChip,
        dismiss,
        markViewed
    }
}
