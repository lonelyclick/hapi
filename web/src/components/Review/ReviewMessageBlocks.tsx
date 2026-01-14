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
 */
export function isReviewSummaryTask(text: string): boolean {
    return text.includes('## 对话汇总任务') && text.includes('请帮我汇总以下这一轮对话的内容')
}

/**
 * 从汇总任务消息中提取信息
 */
export function parseReviewSummaryTask(text: string): {
    roundNumber: number
    userInput: string
    aiReply: string
} | null {
    // 提取轮次号
    const roundMatch = text.match(/### 第 (\d+) 轮对话/)
    if (!roundMatch) return null
    const roundNumber = parseInt(roundMatch[1], 10)

    // 提取用户输入
    const userInputMatch = text.match(/\*\*用户输入：\*\*\n([\s\S]*?)\n\n\*\*AI 回复：\*\*/)
    const userInput = userInputMatch ? userInputMatch[1].trim() : ''

    // 提取 AI 回复
    const aiReplyMatch = text.match(/\*\*AI 回复：\*\*\n([\s\S]*?)\n\n### 要求/)
    const aiReply = aiReplyMatch ? aiReplyMatch[1].trim() : ''

    return { roundNumber, userInput, aiReply }
}

/**
 * 检测是否为 Review JSON 汇总结果
 */
export function isReviewSummaryResult(text: string): boolean {
    // 检查是否包含 ```json 代码块，且内容有 round 和 summary 字段
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
    if (!jsonMatch) return false
    try {
        const parsed = JSON.parse(jsonMatch[1])
        return typeof parsed.round === 'number' && typeof parsed.summary === 'string'
    } catch {
        return false
    }
}

/**
 * 从 JSON 汇总结果中提取信息
 */
export function parseReviewSummaryResult(text: string): {
    round: number
    summary: string
} | null {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
    if (!jsonMatch) return null
    try {
        const parsed = JSON.parse(jsonMatch[1])
        if (typeof parsed.round === 'number' && typeof parsed.summary === 'string') {
            return { round: parsed.round, summary: parsed.summary }
        }
    } catch {
        // ignore
    }
    return null
}

/**
 * Review 汇总任务消息组件（用户消息样式）
 */
export function ReviewSummaryTaskBlock(props: { text: string }) {
    const [expanded, setExpanded] = useState(false)
    const parsed = parseReviewSummaryTask(props.text)

    if (!parsed) {
        return <div className="text-sm text-[var(--app-hint)]">无法解析汇总任务</div>
    }

    return (
        <div className="w-fit min-w-0 max-w-[92%] ml-auto">
            <div className="rounded-xl bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm overflow-hidden">
                {/* 头部 */}
                <div
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => setExpanded(!expanded)}
                >
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-500 text-white text-xs font-bold shrink-0">
                        {parsed.roundNumber}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            对话汇总任务
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {parsed.userInput.slice(0, 50)}{parsed.userInput.length > 50 ? '...' : ''}
                        </div>
                    </div>
                    <svg
                        className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>

                {/* 展开内容 */}
                {expanded && (
                    <div className="px-3 pb-3 space-y-2 border-t border-slate-200 dark:border-slate-600">
                        <div className="pt-2">
                            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">用户输入</div>
                            <div className="text-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 rounded-lg p-2 max-h-32 overflow-y-auto">
                                {parsed.userInput}
                            </div>
                        </div>
                        <div>
                            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">AI 回复摘要</div>
                            <div className="text-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 rounded-lg p-2 max-h-48 overflow-y-auto whitespace-pre-wrap">
                                {parsed.aiReply.slice(0, 500)}{parsed.aiReply.length > 500 ? '...' : ''}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

/**
 * Review JSON 汇总结果组件（AI 消息样式）
 */
export function ReviewSummaryResultBlock(props: { text: string }) {
    const parsed = parseReviewSummaryResult(props.text)

    if (!parsed) {
        return <div className="text-sm text-[var(--app-hint)]">无法解析汇总结果</div>
    }

    return (
        <div className="w-full">
            <div className="rounded-xl bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border border-green-200 dark:border-green-700 shadow-sm overflow-hidden">
                {/* 头部 */}
                <div className="flex items-center gap-2 px-3 py-2 bg-green-100/50 dark:bg-green-800/30 border-b border-green-200 dark:border-green-700">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold shrink-0">
                        {parsed.round}
                    </div>
                    <div className="flex items-center gap-1.5">
                        <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-sm font-medium text-green-700 dark:text-green-300">
                            第 {parsed.round} 轮汇总完成
                        </span>
                    </div>
                </div>

                {/* 汇总内容 */}
                <div className="px-3 py-2">
                    <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                        {parsed.summary}
                    </div>
                </div>
            </div>
        </div>
    )
}
