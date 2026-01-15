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

// 统计信息
export interface ReviewStats {
    total: number
    byType: {
        bug: number
        security: number
        performance: number
        improvement: number
    }
    bySeverity: {
        high: number
        medium: number
        low: number
    }
}

export interface ReviewResult {
    suggestions: ReviewSuggestion[]
    summary: string
    stats?: ReviewStats  // 添加统计信息
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
                summary: parsed.summary || '',
                stats: parsed.stats  // 解析统计信息
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
    expanded: boolean
    applied: boolean  // 是否已发送
    onToggle: () => void
    onExpand: () => void
    onDelete: () => void
}

function SuggestionCard({ suggestion, selected, expanded, applied, onToggle, onExpand, onDelete }: SuggestionCardProps) {
    const colors = typeColors[suggestion.type] || typeColors.improvement

    return (
        <div
            className={`relative rounded-md border transition-all ${
                applied
                    ? 'opacity-60 bg-[var(--app-subtle-bg)]'
                    : selected
                        ? `${colors.bg} ${colors.border}`
                        : 'border-[var(--app-divider)] hover:border-[var(--app-hint)]'
            } ${applied ? 'border-[var(--app-divider)]' : ''}`}
        >
            {/* 主行：可点击选择 */}
            <div
                className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer"
                onClick={onToggle}
            >
                {/* 选择框 */}
                <div className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                    selected
                        ? `${colors.bg} ${colors.border}`
                        : 'border-[var(--app-hint)]'
                }`}>
                    {selected && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={colors.text}>
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    )}
                </div>

                {/* 标签 */}
                <span className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded ${colors.bg} ${colors.text}`}>
                    {typeLabels[suggestion.type] || suggestion.type}
                </span>
                <span className={`flex-shrink-0 text-[10px] font-medium ${severityColors[suggestion.severity] || 'text-gray-500'}`}>
                    {severityLabels[suggestion.severity] || suggestion.severity}
                </span>

                {/* 标题 - 已发送的用删除线 */}
                <span className={`flex-1 text-xs text-[var(--app-fg)] truncate ${applied ? 'line-through text-[var(--app-hint)]' : ''}`}>
                    {suggestion.title}
                </span>

                {/* 已发送标记 */}
                {applied && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-medium rounded bg-green-500/20 text-green-600 dark:text-green-400">
                        已发送
                    </span>
                )}

                {/* 删除按钮 */}
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation()
                        onDelete()
                    }}
                    className="flex-shrink-0 p-0.5 text-[var(--app-hint)] hover:text-red-500 transition-colors"
                    title="删除"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>

                {/* 展开/收起按钮 */}
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation()
                        onExpand()
                    }}
                    className="flex-shrink-0 p-0.5 text-[var(--app-hint)] hover:text-[var(--app-fg)] transition-colors"
                    title={expanded ? '收起' : '展开'}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
                    >
                        <polyline points="6 9 12 15 18 9" />
                    </svg>
                </button>
            </div>

            {/* 详情区域：可展开 */}
            {expanded && (
                <div className="px-2.5 pb-2 pt-1 border-t border-[var(--app-divider)]">
                    <p className="text-[11px] text-[var(--app-hint)] leading-relaxed whitespace-pre-wrap">
                        {suggestion.detail}
                    </p>
                </div>
            )}
        </div>
    )
}

// 带状态的建议
export interface SuggestionWithStatus {
    id: string
    type: string
    severity: string
    title: string
    detail: string
    applied: boolean  // 是否已发送给主 AI
    deleted?: boolean // 是否被用户删除（不想采纳）
}

interface ReviewSuggestionsProps {
    reviewTexts: string[]  // 支持多个 review 文本
    onApply: (details: string[]) => void
    isApplying?: boolean
    // Review 按钮相关
    onReview?: (previousSuggestions: SuggestionWithStatus[]) => void
    isReviewing?: boolean
    reviewDisabled?: boolean
    unreviewedRounds?: number
}

export function ReviewSuggestions({ reviewTexts, onApply, isApplying, onReview, isReviewing, reviewDisabled, unreviewedRounds }: ReviewSuggestionsProps) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
    const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())
    const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())  // 已发送给主 AI 的建议

    // 合并多个 review 结果，为每个建议生成唯一 ID，同时提取统计和总结
    const { mergedSuggestions, latestStats, latestSummary } = useMemo(() => {
        const allSuggestions: ReviewSuggestion[] = []
        let stats: ReviewStats | undefined
        let summary = ''
        for (let i = 0; i < reviewTexts.length; i++) {
            const result = parseReviewResult(reviewTexts[i])
            if (result) {
                // 取最后一个 review 结果的 stats 和 summary
                if (result.stats) stats = result.stats
                if (result.summary) summary = result.summary
                for (const suggestion of result.suggestions) {
                    // 生成唯一 ID：review索引_原始ID
                    const uniqueId = `${i}_${suggestion.id}`
                    allSuggestions.push({
                        ...suggestion,
                        id: uniqueId
                    })
                }
            }
        }
        return { mergedSuggestions: allSuggestions, latestStats: stats, latestSummary: summary }
    }, [reviewTexts])

    // 过滤掉已删除的建议
    const visibleSuggestions = useMemo(() => {
        return mergedSuggestions.filter(s => !deletedIds.has(s.id))
    }, [mergedSuggestions, deletedIds])

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

    // 切换展开状态
    const toggleExpand = useCallback((id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }, [])

    // 删除建议
    const deleteSuggestion = useCallback((id: string) => {
        setDeletedIds(prev => new Set(prev).add(id))
        // 同时从选中列表中移除
        setSelectedIds(prev => {
            const next = new Set(prev)
            next.delete(id)
            return next
        })
    }, [])

    // 删除选中的建议
    const deleteSelected = useCallback(() => {
        if (selectedIds.size === 0) return
        setDeletedIds(prev => {
            const next = new Set(prev)
            for (const id of selectedIds) {
                next.add(id)
            }
            return next
        })
        setSelectedIds(new Set())
    }, [selectedIds])

    // 全选/取消全选
    const toggleAll = useCallback(() => {
        if (visibleSuggestions.length === 0) return
        const visibleIds = visibleSuggestions.map(s => s.id)
        const allVisibleSelected = visibleIds.every(id => selectedIds.has(id))
        if (allVisibleSelected) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(visibleIds))
        }
    }, [visibleSuggestions, selectedIds])

    // 全部展开/收起
    const toggleExpandAll = useCallback(() => {
        if (visibleSuggestions.length === 0) return
        const visibleIds = visibleSuggestions.map(s => s.id)
        const allVisibleExpanded = visibleIds.every(id => expandedIds.has(id))
        if (allVisibleExpanded) {
            setExpandedIds(new Set())
        } else {
            setExpandedIds(new Set(visibleIds))
        }
    }, [visibleSuggestions, expandedIds])

    // 应用选中的建议
    const handleApply = useCallback(() => {
        if (visibleSuggestions.length === 0) return
        const selected = visibleSuggestions.filter(s => selectedIds.has(s.id))
        const details = selected.map(s => s.detail)
        onApply(details)
        // 记录已发送的建议 ID
        setAppliedIds(prev => {
            const next = new Set(prev)
            for (const s of selected) {
                next.add(s.id)
            }
            return next
        })
    }, [visibleSuggestions, selectedIds, onApply])

    // 点击 Review 按钮时，收集所有建议的状态
    const handleReview = useCallback(() => {
        if (!onReview) return
        // 收集所有建议（包括已删除的，用于告诉 AI 不要重复）
        const allSuggestionsWithStatus: SuggestionWithStatus[] = mergedSuggestions.map(s => ({
            id: s.id,
            type: s.type,
            severity: s.severity,
            title: s.title,
            detail: s.detail,
            applied: appliedIds.has(s.id),
            deleted: deletedIds.has(s.id)
        }))
        onReview(allSuggestionsWithStatus)
    }, [onReview, mergedSuggestions, appliedIds, deletedIds])

    // 没有可见的建议，但如果有 Review 按钮且有待 review 轮次，仍需显示按钮
    if (visibleSuggestions.length === 0) {
        // 如果有 Review 回调且有待 review 轮次，只显示 Review 按钮
        if (onReview && unreviewedRounds && unreviewedRounds > 0) {
            return (
                <div className="space-y-2">
                    <div className="text-xs text-center text-[var(--app-hint)]">
                        所有建议已处理
                    </div>
                    <button
                        type="button"
                        onClick={handleReview}
                        disabled={reviewDisabled || isReviewing}
                        className="w-full px-3 py-1.5 text-xs font-medium rounded-md bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-sm hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                        {isReviewing ? (
                            <span className="flex items-center justify-center gap-1.5">
                                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                执行中...
                            </span>
                        ) : (
                            `Review ${unreviewedRounds} 轮`
                        )}
                    </button>
                </div>
            )
        }
        return null
    }

    const visibleIds = visibleSuggestions.map(s => s.id)
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))
    const allExpanded = visibleIds.length > 0 && visibleIds.every(id => expandedIds.has(id))
    const someSelected = visibleIds.some(id => selectedIds.has(id))

    const selectedCount = visibleIds.filter(id => selectedIds.has(id)).length

    return (
        <div className="space-y-2">
            {/* Review 完成统计卡片 */}
            {latestStats && (
                <div className="rounded-md border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 px-2.5 py-1.5">
                    <div className="flex items-center gap-2 text-xs">
                        <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="font-medium text-blue-700 dark:text-blue-300">
                            Review 完成
                        </span>
                        <span className="text-blue-600 dark:text-blue-400">
                            {latestStats.total} 条建议
                        </span>
                        {latestStats.bySeverity.high > 0 && (
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-red-500/20 text-red-600 dark:text-red-400">
                                {latestStats.bySeverity.high} 高危
                            </span>
                        )}
                        {latestStats.bySeverity.medium > 0 && (
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-yellow-500/20 text-yellow-600 dark:text-yellow-400">
                                {latestStats.bySeverity.medium} 中危
                            </span>
                        )}
                        {latestStats.bySeverity.low > 0 && (
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-green-500/20 text-green-600 dark:text-green-400">
                                {latestStats.bySeverity.low} 低危
                            </span>
                        )}
                    </div>
                    {latestSummary && (
                        <p className="mt-1 text-[11px] text-blue-600 dark:text-blue-400 line-clamp-2">
                            {latestSummary}
                        </p>
                    )}
                </div>
            )}

            {/* 操作栏 */}
            <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={toggleAll}
                        className="text-[var(--app-hint)] hover:text-[var(--app-fg)] transition-colors"
                    >
                        {allSelected ? '取消全选' : '全选'}
                    </button>
                    <button
                        type="button"
                        onClick={toggleExpandAll}
                        className="text-[var(--app-hint)] hover:text-[var(--app-fg)] transition-colors"
                    >
                        {allExpanded ? '全部收起' : '全部展开'}
                    </button>
                    {someSelected && (
                        <button
                            type="button"
                            onClick={deleteSelected}
                            className="text-red-500 hover:text-red-600 transition-colors"
                        >
                            删除 {selectedCount}
                        </button>
                    )}
                </div>
                <span className="text-[var(--app-hint)]">
                    {selectedCount}/{visibleSuggestions.length}
                </span>
            </div>

            {/* 建议列表 */}
            <div className="space-y-1">
                {visibleSuggestions.map(suggestion => (
                    <SuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                        selected={selectedIds.has(suggestion.id)}
                        expanded={expandedIds.has(suggestion.id)}
                        applied={appliedIds.has(suggestion.id)}
                        onToggle={() => toggleSelection(suggestion.id)}
                        onExpand={() => toggleExpand(suggestion.id)}
                        onDelete={() => deleteSuggestion(suggestion.id)}
                    />
                ))}
            </div>

            {/* 按钮行 */}
            <div className="flex gap-2">
                {/* 发送按钮 */}
                <button
                    type="button"
                    onClick={handleApply}
                    disabled={!someSelected || isApplying}
                    className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-sm hover:from-green-600 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    {isApplying ? (
                        <span className="flex items-center justify-center gap-1.5">
                            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            发送中...
                        </span>
                    ) : (
                        `发送 ${selectedCount} 条`
                    )}
                </button>

                {/* Review 按钮 */}
                {onReview && (
                    <button
                        type="button"
                        onClick={handleReview}
                        disabled={reviewDisabled || isReviewing}
                        className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-sm hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                        {isReviewing ? (
                            <span className="flex items-center justify-center gap-1.5">
                                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                执行中...
                            </span>
                        ) : unreviewedRounds && unreviewedRounds > 0 ? (
                            `Review ${unreviewedRounds} 轮`
                        ) : (
                            '全部已 Review'
                        )}
                    </button>
                )}
            </div>
        </div>
    )
}
