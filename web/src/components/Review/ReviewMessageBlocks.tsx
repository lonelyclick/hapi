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

    // 匹配所有轮次块
    const roundBlocks = text.split(/(?=### 第 \d+ 轮对话)/).filter(block => block.includes('### 第'))

    for (const block of roundBlocks) {
        // 提取轮次号
        const roundMatch = block.match(/### 第 (\d+) 轮对话/)
        if (!roundMatch) continue
        const roundNumber = parseInt(roundMatch[1], 10)

        // 提取用户输入
        const userInputMatch = block.match(/\*\*用户输入：\*\*\n([\s\S]*?)\n\n\*\*AI 回复：\*\*/)
        const userInput = userInputMatch ? userInputMatch[1].trim() : ''

        // 提取 AI 回复 - 到下一个分隔符或 ### 要求
        const aiReplyMatch = block.match(/\*\*AI 回复：\*\*\n([\s\S]*?)(?:\n---\n|\n\n### 要求|$)/)
        const aiReply = aiReplyMatch ? aiReplyMatch[1].trim() : ''

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
        <div className="rounded-lg bg-white dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-800/30 border-b border-green-100 dark:border-green-700/50">
                <div className="flex items-center justify-center w-5 h-5 rounded-full bg-green-500 text-white text-xs font-bold shrink-0">
                    {summary.round}
                </div>
                <span className="text-xs font-medium text-green-700 dark:text-green-300">
                    第 {summary.round} 轮
                </span>
            </div>
            <div className="px-3 py-2">
                <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
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
    const headerText = parsed.length === 1
        ? `第 ${roundNumbers[0]} 轮汇总完成`
        : `${parsed.length} 轮汇总完成 (第 ${roundNumbers.join(', ')} 轮)`

    return (
        <div className="w-full">
            <div className="rounded-xl bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border border-green-200 dark:border-green-700 shadow-sm overflow-hidden">
                {/* 头部 */}
                <div className="flex items-center gap-2 px-3 py-2 bg-green-100/50 dark:bg-green-800/30 border-b border-green-200 dark:border-green-700">
                    <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm font-medium text-green-700 dark:text-green-300">
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
