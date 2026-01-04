/**
 * 空闲建议浮动卡片组件
 * 在输入框上方显示常驻 AI 的建议
 */

import { memo } from 'react'
import type { IdleSuggestion } from '@/hooks/useIdleSuggestion'

interface IdleSuggestionCardProps {
    suggestion: IdleSuggestion
    onApply: () => void
    onDismiss: () => void
}

const categoryLabels: Record<string, string> = {
    todo_check: 'Todo 检查',
    error_analysis: '错误分析',
    code_review: '代码审查',
    general: '一般建议'
}

const severityStyles: Record<string, { border: string; bg: string; icon: string }> = {
    critical: {
        border: 'border-red-400 dark:border-red-500/50',
        bg: 'bg-red-50 dark:bg-red-900/20',
        icon: '🚨'
    },
    high: {
        border: 'border-orange-400 dark:border-orange-500/50',
        bg: 'bg-orange-50 dark:bg-orange-900/20',
        icon: '⚠️'
    },
    medium: {
        border: 'border-yellow-400 dark:border-yellow-500/50',
        bg: 'bg-yellow-50 dark:bg-yellow-900/20',
        icon: '💡'
    },
    low: {
        border: 'border-blue-400 dark:border-blue-500/50',
        bg: 'bg-blue-50 dark:bg-blue-900/20',
        icon: 'ℹ️'
    }
}

export const IdleSuggestionCard = memo(function IdleSuggestionCard({
    suggestion,
    onApply,
    onDismiss
}: IdleSuggestionCardProps) {
    const styles = severityStyles[suggestion.severity] || severityStyles.low
    const categoryLabel = categoryLabels[suggestion.category] || '建议'

    return (
        <div
            className={`
                rounded-xl border-2 shadow-lg p-4 animate-slide-down
                ${styles.border} ${styles.bg}
            `}
        >
            {/* 标题栏 */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-lg">{styles.icon}</span>
                    <span className="text-xs font-medium text-[var(--app-hint)]">
                        常驻 AI 建议
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--app-secondary-bg)] text-[var(--app-fg)]/70">
                        {categoryLabel}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onDismiss}
                    className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                    aria-label="关闭"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                    </svg>
                </button>
            </div>

            {/* 触发原因 */}
            <div className="text-xs text-[var(--app-hint)] mb-2 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4" />
                    <path d="M12 8h.01" />
                </svg>
                {suggestion.reason}
            </div>

            {/* 建议标题 */}
            <h4 className="font-semibold text-sm text-[var(--app-fg)] mb-1">
                {suggestion.title}
            </h4>

            {/* 建议详情 */}
            <p className="text-sm text-[var(--app-fg)]/80 mb-3 whitespace-pre-line line-clamp-3">
                {suggestion.detail}
            </p>

            {/* 建议文本预览（如果有） */}
            {suggestion.suggestedText && (
                <div className="mb-3 p-2 rounded-lg bg-[var(--app-bg)] border border-[var(--app-divider)] text-xs text-[var(--app-fg)]/70 font-mono line-clamp-2">
                    {suggestion.suggestedText}
                </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={onApply}
                    className="flex-1 px-3 py-2 rounded-lg bg-[var(--app-link)] text-white text-sm font-medium transition-colors hover:opacity-90 active:scale-[0.98]"
                >
                    {suggestion.suggestedText ? '使用此建议' : '查看详情'}
                </button>
                <button
                    type="button"
                    onClick={onDismiss}
                    className="px-3 py-2 rounded-lg border border-[var(--app-divider)] text-sm font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] active:scale-[0.98]"
                >
                    忽略
                </button>
            </div>
        </div>
    )
})
