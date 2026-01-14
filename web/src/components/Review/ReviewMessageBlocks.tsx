/**
 * Review AI 专用消息块组件
 *
 * 用于展示：
 * 1. 汇总任务请求（发送给 AI 的汇总提示）
 * 2. JSON 汇总结果（AI 返回的 JSON 格式汇总）
 */

import { useState } from 'react'

/**
 * 检测是否为 Review 汇总任务消息
 * 支持批量格式（多轮）和单轮格式
 */
export function isReviewSummaryTask(text: string): boolean {
    if (!text.includes('## 对话汇总任务')) return false
    // 批量格式: "请帮我汇总以下 X 轮对话的内容"
    // 单轮格式: "请帮我汇总以下这一轮对话的内容"
    return /请帮我汇总以下\s*(\d+\s*轮|这一轮)\s*对话/.test(text)
}

interface ParsedRound {
    roundNumber: number
    userInput: string
    aiReply: string
}

/**
 * 从汇总任务消息中提取信息（支持多轮）
 */
export function parseReviewSummaryTask(text: string): ParsedRound[] | null {
    const rounds: ParsedRound[] = []

    // 只解析 "### 要求" 之前的内容
    const mainContent = text.split(/### 要求/)[0] || text

    // 使用正则直接匹配完整的轮次结构，避免嵌套内容被误解析
    // 匹配：### 第 X 轮对话\n\n**用户输入：**\n...\n\n**AI 回复：**\n...
    const roundPattern = /### 第 (\d+) 轮对话\n\n\*\*用户输入：\*\*\n([\s\S]*?)\n\n\*\*AI 回复：\*\*\n([\s\S]*?)(?=\n---\n|### 第 \d+ 轮对话\n\n\*\*用户输入：\*\*|$)/g

    let match
    while ((match = roundPattern.exec(mainContent)) !== null) {
        const roundNumber = parseInt(match[1], 10)
        const userInput = match[2].trim()
        const aiReply = match[3].trim()

        rounds.push({ roundNumber, userInput, aiReply })
    }

    return rounds.length > 0 ? rounds : null
}

/**
 * 尝试从文本中提取 JSON 内容
 * 支持多种格式：```json 代码块、``` 代码块、直接 JSON
 */
function extractJsonFromText(text: string): string | null {
    // 1. 尝试 ```json 代码块
    const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
    if (jsonBlockMatch) {
        return jsonBlockMatch[1].trim()
    }

    // 2. 尝试普通 ``` 代码块
    const codeBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/)
    if (codeBlockMatch) {
        return codeBlockMatch[1].trim()
    }

    // 3. 尝试直接 JSON 数组（以 [ 开头，以 ] 结尾）- 贪婪匹配
    const arrayMatch = text.match(/(\[\s*\{[\s\S]*\}\s*\])/)
    if (arrayMatch) {
        return arrayMatch[1].trim()
    }

    // 4. 尝试直接 JSON 对象（以 { 开头，以 } 结尾，包含 round 和 summary）
    const objectMatch = text.match(/(\{\s*"round"\s*:[\s\S]*?"summary"\s*:[\s\S]*?\})/)
    if (objectMatch) {
        return objectMatch[1].trim()
    }

    return null
}

/**
 * 验证解析后的 JSON 是否为汇总结果格式
 */
function isValidSummaryJson(parsed: unknown): parsed is Array<{ round: number; summary: string }> | { round: number; summary: string } {
    if (Array.isArray(parsed)) {
        return parsed.length > 0 && parsed.every(item =>
            typeof item === 'object' && item !== null &&
            typeof (item as Record<string, unknown>).round === 'number' &&
            typeof (item as Record<string, unknown>).summary === 'string'
        )
    }
    if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as Record<string, unknown>
        return typeof obj.round === 'number' && typeof obj.summary === 'string'
    }
    return false
}

/**
 * 快速检查 JSON 字符串是否看起来完整（基本的括号匹配）
 * 用于在 streaming 过程中避免尝试解析不完整的 JSON
 */
function looksLikeCompleteJson(jsonStr: string): boolean {
    const trimmed = jsonStr.trim()
    if (trimmed.startsWith('[')) {
        // 数组：必须以 ] 结尾
        return trimmed.endsWith(']')
    }
    if (trimmed.startsWith('{')) {
        // 对象：必须以 } 结尾
        return trimmed.endsWith('}')
    }
    return false
}

/**
 * 检测是否为 Review JSON 汇总结果
 * 支持单个对象或数组格式，多种文本格式
 */
export function isReviewSummaryResult(text: string): boolean {
    const jsonStr = extractJsonFromText(text)
    if (!jsonStr) return false

    // 快速检查：如果 JSON 看起来不完整（streaming 中），直接返回 false
    // 这样可以避免大量无意义的 parse error 日志
    if (!looksLikeCompleteJson(jsonStr)) {
        return false
    }

    try {
        const parsed = JSON.parse(jsonStr)
        return isValidSummaryJson(parsed)
    } catch {
        // 静默处理解析错误，因为 streaming 时经常会出现
        return false
    }
}

interface ParsedSummary {
    round: number
    summary: string
}

/**
 * 从 JSON 汇总结果中提取信息（支持数组和单个对象，多种文本格式）
 */
export function parseReviewSummaryResult(text: string): ParsedSummary[] | null {
    const jsonStr = extractJsonFromText(text)
    if (!jsonStr) return null

    try {
        const parsed = JSON.parse(jsonStr)
        // 支持数组格式
        if (Array.isArray(parsed)) {
            const items = parsed.filter(item =>
                typeof item === 'object' && item !== null &&
                typeof item.round === 'number' && typeof item.summary === 'string'
            )
            return items.length > 0 ? items : null
        }
        // 支持单个对象格式
        if (typeof parsed === 'object' && parsed !== null &&
            typeof parsed.round === 'number' && typeof parsed.summary === 'string') {
            return [{ round: parsed.round, summary: parsed.summary }]
        }
    } catch {
        // ignore
    }
    return null
}

/**
 * 单轮汇总任务卡片
 */
function SingleRoundTaskCard(props: { round: ParsedRound; expanded: boolean; onToggle: () => void }) {
    const { round, expanded, onToggle } = props

    return (
        <div className="rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 overflow-hidden">
            <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                onClick={onToggle}
            >
                <div className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-500 text-white text-xs font-bold shrink-0">
                    {round.roundNumber}
                </div>
                <div className="flex-1 min-w-0 text-xs text-slate-500 dark:text-slate-400 truncate">
                    {round.userInput.slice(0, 40)}{round.userInput.length > 40 ? '...' : ''}
                </div>
                <svg
                    className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </div>
            {expanded && (
                <div className="px-3 pb-2 space-y-2 border-t border-slate-100 dark:border-slate-700">
                    <div className="pt-2">
                        <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">用户输入</div>
                        <div className="text-xs text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-24 overflow-y-auto">
                            {round.userInput}
                        </div>
                    </div>
                    <div>
                        <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">AI 回复</div>
                        <div className="text-xs text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
                            {round.aiReply.slice(0, 400)}{round.aiReply.length > 400 ? '...' : ''}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

/**
 * Review 汇总任务消息组件（支持多轮）
 */
export function ReviewSummaryTaskBlock(props: { text: string }) {
    const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set())
    const parsed = parseReviewSummaryTask(props.text)

    if (!parsed || parsed.length === 0) {
        return <div className="text-sm text-[var(--app-hint)]">无法解析汇总任务</div>
    }

    const toggleRound = (roundNumber: number) => {
        setExpandedRounds(prev => {
            const next = new Set(prev)
            if (next.has(roundNumber)) {
                next.delete(roundNumber)
            } else {
                next.add(roundNumber)
            }
            return next
        })
    }

    const roundNumbers = parsed.map(r => r.roundNumber)
    const headerText = parsed.length === 1
        ? `第 ${roundNumbers[0]} 轮`
        : `第 ${roundNumbers.join(', ')} 轮`

    return (
        <div className="w-fit min-w-0 max-w-[92%] ml-auto">
            <div className="rounded-xl bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm overflow-hidden">
                {/* 头部 */}
                <div className="flex items-center gap-2 px-3 py-2">
                    <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        对话汇总任务
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                        ({headerText})
                    </span>
                </div>

                {/* 轮次列表 */}
                <div className="px-2 pb-2 space-y-1">
                    {parsed.map(round => (
                        <SingleRoundTaskCard
                            key={round.roundNumber}
                            round={round}
                            expanded={expandedRounds.has(round.roundNumber)}
                            onToggle={() => toggleRound(round.roundNumber)}
                        />
                    ))}
                </div>
            </div>
        </div>
    )
}

/**
 * 单轮汇总结果卡片
 */
function SingleSummaryResultCard(props: { summary: ParsedSummary }) {
    const { summary } = props

    return (
        <div className="rounded bg-white dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 overflow-hidden">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-green-50 dark:bg-green-800/30 border-b border-green-100 dark:border-green-700/50">
                <div className="flex items-center justify-center w-4 h-4 rounded-full bg-green-500 text-white text-[10px] font-bold shrink-0">
                    {summary.round}
                </div>
            </div>
            <div className="px-2 py-1.5">
                <div className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                    {summary.summary}
                </div>
            </div>
        </div>
    )
}

/**
 * Review JSON 汇总结果组件（支持多轮）
 */
export function ReviewSummaryResultBlock(props: { text: string }) {
    const parsed = parseReviewSummaryResult(props.text)

    if (!parsed || parsed.length === 0) {
        return <div className="text-sm text-[var(--app-hint)]">无法解析汇总结果</div>
    }

    const roundNumbers = parsed.map(s => s.round)
    // 单轮只显示数字，多轮显示详细信息
    const headerText = parsed.length === 1
        ? `${roundNumbers[0]}`
        : `${roundNumbers.join(', ')}`

    return (
        <div className="w-full">
            <div className="rounded-lg bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border border-green-200 dark:border-green-700 shadow-sm overflow-hidden">
                {/* 头部 */}
                <div className="flex items-center gap-1.5 px-2 py-1 bg-green-100/50 dark:bg-green-800/30 border-b border-green-200 dark:border-green-700">
                    <svg className="w-3 h-3 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-xs text-green-700 dark:text-green-300">
                        {headerText}
                    </span>
                </div>

                {/* 汇总内容 */}
                <div className="p-2 space-y-2">
                    {parsed.map(summary => (
                        <SingleSummaryResultCard key={summary.round} summary={summary} />
                    ))}
                </div>
            </div>
        </div>
    )
}

// ============================================
// Review 建议结果相关组件
// ============================================

interface ReviewSuggestion {
    id: string
    type: 'bug' | 'security' | 'performance' | 'improvement'
    severity: 'high' | 'medium' | 'low'
    title: string
    detail: string
}

interface ReviewSuggestionsResult {
    suggestions: ReviewSuggestion[]
    summary: string
}

/**
 * 检测是否为 Review 建议结果（包含 suggestions 数组）
 */
export function isReviewSuggestionsResult(text: string): boolean {
    const jsonStr = extractJsonFromText(text)
    if (!jsonStr) return false
    if (!looksLikeCompleteJson(jsonStr)) return false

    try {
        const parsed = JSON.parse(jsonStr)
        return parsed && Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0
    } catch {
        return false
    }
}

/**
 * 解析 Review 建议结果
 */
export function parseReviewSuggestionsResult(text: string): ReviewSuggestionsResult | null {
    const jsonStr = extractJsonFromText(text)
    if (!jsonStr) return null

    try {
        const parsed = JSON.parse(jsonStr)
        if (parsed && Array.isArray(parsed.suggestions)) {
            return {
                suggestions: parsed.suggestions.filter((s: unknown) =>
                    s && typeof s === 'object' &&
                    'id' in s && 'title' in s && 'detail' in s
                ),
                summary: parsed.summary || ''
            }
        }
    } catch {
        // ignore
    }
    return null
}

// 类型颜色映射
const suggestionTypeColors: Record<string, { bg: string; text: string; border: string }> = {
    bug: { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/30' },
    security: { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/30' },
    performance: { bg: 'bg-yellow-500/10', text: 'text-yellow-500', border: 'border-yellow-500/30' },
    improvement: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/30' }
}

// 严重程度颜色
const suggestionSeverityColors: Record<string, string> = {
    high: 'text-red-500',
    medium: 'text-yellow-500',
    low: 'text-green-500'
}

// 类型中文
const suggestionTypeLabels: Record<string, string> = {
    bug: 'Bug',
    security: '安全',
    performance: '性能',
    improvement: '改进'
}

// 严重程度中文
const suggestionSeverityLabels: Record<string, string> = {
    high: '高',
    medium: '中',
    low: '低'
}

/**
 * 单个建议卡片（只读展示）
 */
function SuggestionDisplayCard(props: { suggestion: ReviewSuggestion }) {
    const { suggestion } = props
    const colors = suggestionTypeColors[suggestion.type] || suggestionTypeColors.improvement

    return (
        <div className={`p-3 rounded-lg border ${colors.border} ${colors.bg}`}>
            {/* 标签 */}
            <div className="flex items-center gap-2 mb-2">
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors.bg} ${colors.text}`}>
                    {suggestionTypeLabels[suggestion.type] || suggestion.type}
                </span>
                <span className={`text-xs font-medium ${suggestionSeverityColors[suggestion.severity] || 'text-gray-500'}`}>
                    {suggestionSeverityLabels[suggestion.severity] || suggestion.severity}
                </span>
            </div>

            {/* 标题 */}
            <h4 className="font-medium text-[var(--app-fg)] mb-1">
                {suggestion.title}
            </h4>

            {/* 详情 */}
            <p className="text-sm text-[var(--app-hint)]">
                {suggestion.detail}
            </p>
        </div>
    )
}

/**
 * Review 建议结果展示组件
 */
export function ReviewSuggestionsResultBlock(props: { text: string }) {
    const parsed = parseReviewSuggestionsResult(props.text)

    if (!parsed || parsed.suggestions.length === 0) {
        return <div className="text-sm text-[var(--app-hint)]">无法解析建议结果</div>
    }

    return (
        <div className="w-full">
            <div className="rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 border border-blue-200 dark:border-blue-700 shadow-sm overflow-hidden">
                {/* 头部 */}
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-100/50 dark:bg-blue-800/30 border-b border-blue-200 dark:border-blue-700">
                    <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                        代码审查建议 ({parsed.suggestions.length} 条)
                    </span>
                </div>

                {/* 总体评价 */}
                {parsed.summary && (
                    <div className="px-3 py-2 bg-white/50 dark:bg-slate-800/50 border-b border-blue-100 dark:border-blue-800">
                        <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">总体评价</div>
                        <p className="text-sm text-[var(--app-fg)]">{parsed.summary}</p>
                    </div>
                )}

                {/* 建议列表 */}
                <div className="p-2 space-y-2">
                    {parsed.suggestions.map(suggestion => (
                        <SuggestionDisplayCard key={suggestion.id} suggestion={suggestion} />
                    ))}
                </div>
            </div>
        </div>
    )
}
