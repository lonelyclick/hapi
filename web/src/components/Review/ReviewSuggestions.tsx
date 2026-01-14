/**
 * Review 建议卡片组件
 *
 * 解析 Review AI 输出的 JSON，展示为可多选的建议卡片
 */

import { useState, useMemo, useCallback } from 'react'

// 建议类型
export interface ReviewSuggestion {
    id: string
    type: 'bug' | 'security' | 'performance' | 'improvement'
    severity: 'high' | 'medium' | 'low'
    title: string
    detail: string
}

export interface ReviewResult {
    suggestions: ReviewSuggestion[]
    summary: string
}

// 从 AI 回复文本中解析 JSON
export function parseReviewResult(text: string): ReviewResult | null {
    // 尝试从 ```json 代码块中提取
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
    let jsonStr = jsonMatch ? jsonMatch[1].trim() : null

    // 如果没有代码块，尝试直接解析整个文本
    if (!jsonStr) {
        // 尝试找到 JSON 对象
        const objMatch = text.match(/\{[\s\S]*"suggestions"[\s\S]*\}/)
        jsonStr = objMatch ? objMatch[0] : null
    }

    if (!jsonStr) return null

    try {
        const parsed = JSON.parse(jsonStr)
        if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
            return {
                suggestions: parsed.suggestions.filter((s: unknown) =>
                    s && typeof s === 'object' &&
                    'id' in s && 'title' in s && 'detail' in s
                ),
                summary: parsed.summary || ''
            }
        }
    } catch {
        // JSON 解析失败
    }

    return null
}

// 类型颜色映射
const typeColors: Record<string, { bg: string; text: string; border: string }> = {
    bug: { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/30' },
    security: { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/30' },
    performance: { bg: 'bg-yellow-500/10', text: 'text-yellow-500', border: 'border-yellow-500/30' },
    improvement: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/30' }
}

// 严重程度颜色
const severityColors: Record<string, string> = {
    high: 'text-red-500',
    medium: 'text-yellow-500',
    low: 'text-green-500'
}

// 类型中文
const typeLabels: Record<string, string> = {
    bug: 'Bug',
    security: '安全',
    performance: '性能',
    improvement: '改进'
}

// 严重程度中文
const severityLabels: Record<string, string> = {
    high: '高',
    medium: '中',
    low: '低'
}

interface SuggestionCardProps {
    suggestion: ReviewSuggestion
    selected: boolean
    onToggle: () => void
}

function SuggestionCard({ suggestion, selected, onToggle }: SuggestionCardProps) {
    const colors = typeColors[suggestion.type] || typeColors.improvement

    return (
        <div
            className={`relative p-3 rounded-lg border cursor-pointer transition-all ${
                selected
                    ? `${colors.bg} ${colors.border} ring-2 ring-offset-1 ring-offset-[var(--app-bg)]`
                    : 'border-[var(--app-divider)] hover:border-[var(--app-hint)]'
            }`}
            style={{ ['--tw-ring-color' as string]: colors.text.replace('text-', 'rgb(var(--') + ')' }}
            onClick={onToggle}
        >
            {/* 选择框 */}
            <div className="absolute top-3 right-3">
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    selected
                        ? `${colors.bg} ${colors.border}`
                        : 'border-[var(--app-hint)]'
                }`}>
                    {selected && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={colors.text}>
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    )}
                </div>
            </div>

            {/* 标签 */}
            <div className="flex items-center gap-2 mb-2 pr-8">
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors.bg} ${colors.text}`}>
                    {typeLabels[suggestion.type] || suggestion.type}
                </span>
                <span className={`text-xs font-medium ${severityColors[suggestion.severity] || 'text-gray-500'}`}>
                    {severityLabels[suggestion.severity] || suggestion.severity}
                </span>
            </div>

            {/* 标题 */}
            <h4 className="font-medium text-[var(--app-fg)] mb-1">
                {suggestion.title}
            </h4>

            {/* 详情预览 */}
            <p className="text-sm text-[var(--app-hint)] line-clamp-2">
                {suggestion.detail}
            </p>
        </div>
    )
}

interface ReviewSuggestionsProps {
    reviewText: string
    onApply: (details: string[]) => void
    isApplying?: boolean
}

export function ReviewSuggestions({ reviewText, onApply, isApplying }: ReviewSuggestionsProps) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

    // 解析 JSON
    const result = useMemo(() => parseReviewResult(reviewText), [reviewText])

    // 切换选中状态
    const toggleSelection = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }, [])

    // 全选/取消全选
    const toggleAll = useCallback(() => {
        if (!result) return
        if (selectedIds.size === result.suggestions.length) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(result.suggestions.map(s => s.id)))
        }
    }, [result, selectedIds.size])

    // 应用选中的建议
    const handleApply = useCallback(() => {
        if (!result) return
        const selected = result.suggestions.filter(s => selectedIds.has(s.id))
        const details = selected.map(s => s.detail)
        onApply(details)
    }, [result, selectedIds, onApply])

    // 没有解析出结果
    if (!result || result.suggestions.length === 0) {
        return null
    }

    const allSelected = selectedIds.size === result.suggestions.length
    const someSelected = selectedIds.size > 0

    return (
        <div className="space-y-3">
            {/* 总结 */}
            {result.summary && (
                <div className="p-3 rounded-lg bg-[var(--app-subtle-bg)] border border-[var(--app-divider)]">
                    <div className="text-sm font-medium text-[var(--app-fg)] mb-1">总体评价</div>
                    <p className="text-sm text-[var(--app-hint)]">{result.summary}</p>
                </div>
            )}

            {/* 操作栏 */}
            <div className="flex items-center justify-between">
                <button
                    type="button"
                    onClick={toggleAll}
                    className="text-sm text-[var(--app-hint)] hover:text-[var(--app-fg)] transition-colors"
                >
                    {allSelected ? '取消全选' : '全选'}
                </button>
                <span className="text-sm text-[var(--app-hint)]">
                    已选 {selectedIds.size}/{result.suggestions.length}
                </span>
            </div>

            {/* 建议列表 */}
            <div className="space-y-2">
                {result.suggestions.map(suggestion => (
                    <SuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                        selected={selectedIds.has(suggestion.id)}
                        onToggle={() => toggleSelection(suggestion.id)}
                    />
                ))}
            </div>

            {/* 应用按钮 */}
            <button
                type="button"
                onClick={handleApply}
                disabled={!someSelected || isApplying}
                className="w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow hover:from-green-600 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
                {isApplying ? (
                    <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        发送中...
                    </span>
                ) : (
                    `发送 ${selectedIds.size} 条建议给主 AI`
                )}
            </button>
        </div>
    )
}
