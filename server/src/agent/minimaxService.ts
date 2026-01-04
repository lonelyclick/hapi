/**
 * MiniMax API 调用服务
 * 用于 Layer 2 智能建议生成
 */

import type { SessionSummary } from './types'
import type { SuggestionChip } from '../sync/syncEngine'

// 暂时硬编码 API Key，后续可迁移到凭证系统
const MINIMAX_API_KEY = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJHcm91cE5hbWUiOiJ5b2hvIiwiVXNlck5hbWUiOiJ5b2hvIiwiQWNjb3VudCI6IiIsIlN1YmplY3RJRCI6IjE4NDM1NjI5OTQ1OTU4MTMxNzgiLCJQaG9uZSI6IjEzNjMyMDQxNzA2IiwiR3JvdXBJRCI6IjE4NDM1NjI5OTQ1OTE2MTg4NzAiLCJQYWdlTmFtZSI6IiIsIk1haWwiOiIiLCJDcmVhdGVUaW1lIjoiMjAyNS0wMS0wNCAxNDoyNTozMCIsIlRva2VuVHlwZSI6MSwiaXNzIjoibWluaW1heCJ9.dFcPmYW7x7WFv3Pu0WVqvyMvh8bXVNfAErlE6urZFn-Cqxa1k31kXKDnCDN5zR6W_OW4yKm13l6_eUoUuJVHsOqNI_A-p1cU_3vGVJvb2BFDNiNsH_4gL_Bs2OP-m3-A-X8mcWH4bQlsrSL8_tDxUYwfCLwH_fzqDLcxZx40_hphLPJFD_Qz_RYLHhXNKq_xI5QPLDLcXv0S9dZ8bfpUvvkgAMUhCfJYWjP__bJw3tV6wLHxdF9fkXZ6tLtXU4rVs2rR_TdrAOq4e0BqH3m8vP3I2c0qXlLfJYl0MvXGH5tO0vnJKHy7K3Q5eFZ1dC6K9rPBqZVLpIu0f7vJnH2Hcw'
const MINIMAX_API_URL = 'https://api.minimax.chat/v1/text/chatcompletion_v2'
const MINIMAX_MODEL = 'abab5.5-chat'
const MINIMAX_TIMEOUT_MS = 30_000

export interface MinimaxReviewRequest {
    sessionId: string
    summary: SessionSummary
}

export interface MinimaxReviewResponse {
    chips: SuggestionChip[]
    error?: string
}

interface MinimaxApiResponse {
    base_resp?: {
        status_code: number
        status_msg: string
    }
    choices?: Array<{
        message?: {
            content: string
        }
    }>
}

export class MinimaxService {
    /**
     * 审查会话并生成建议芯片
     */
    async reviewSession(request: MinimaxReviewRequest): Promise<MinimaxReviewResponse> {
        try {
            const prompt = this.buildPrompt(request.summary)
            const response = await this.callApi(prompt)
            const chips = this.parseResponse(response, request.sessionId)
            return { chips }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            console.error('[MinimaxService] Review failed:', message)
            return { chips: [], error: message }
        }
    }

    /**
     * 构建 prompt
     */
    private buildPrompt(summary: SessionSummary): string {
        const todos = summary.todos
            ? (summary.todos as Array<{ s?: string; t?: string }>)
                .map(t => `- [${t.s === 'c' ? 'x' : ' '}] ${t.t}`)
                .join('\n')
            : '无'

        const codeChanges = summary.codeChanges?.length
            ? summary.codeChanges.join('\n- ')
            : '无'

        const errors = summary.errors?.length
            ? summary.errors.join('\n- ')
            : '无'

        const decisions = summary.decisions?.length
            ? summary.decisions.join('\n- ')
            : '无'

        return `你是一个代码审查助手。分析以下开发会话上下文，给出 2-4 个具体可操作的建议。

## 会话上下文
- 项目: ${summary.project || 'unknown'}
- 工作目录: ${summary.workDir}
- 最近活动: ${summary.recentActivity || '无'}
- 待办任务:
${todos}
- 代码变更:
- ${codeChanges}
- 错误信息:
- ${errors}
- 决策记录:
- ${decisions}

## 输出格式
直接输出 JSON 数组，不要有其他文字：
[
  {"label": "简短标签", "text": "具体建议内容", "category": "code_review", "icon": "💡"},
  {"label": "简短标签", "text": "具体建议内容", "category": "general", "icon": "🔍"}
]

## 规则
1. label 不超过 6 个字
2. text 要具体可操作（30-80字）
3. category 只能是: code_review, error_analysis, general
4. icon 使用相关 emoji
5. 不要重复本地已检测的问题（如 todos 中的任务、errors 中的错误）
6. 聚焦：代码质量、性能优化、安全隐患、架构建议
7. 如果没有值得建议的内容，返回空数组 []`
    }

    /**
     * 调用 MiniMax API
     */
    private async callApi(prompt: string): Promise<string> {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), MINIMAX_TIMEOUT_MS)

        try {
            const response = await fetch(MINIMAX_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${MINIMAX_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: MINIMAX_MODEL,
                    messages: [
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3,
                    max_tokens: 1024
                }),
                signal: controller.signal
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
                throw new Error(`API request failed: ${response.status} ${response.statusText}`)
            }

            const data = await response.json() as MinimaxApiResponse

            if (data.base_resp?.status_code !== 0) {
                throw new Error(`API error: ${data.base_resp?.status_msg || 'Unknown error'}`)
            }

            const content = data.choices?.[0]?.message?.content
            if (!content) {
                throw new Error('Empty response from API')
            }

            return content
        } catch (error) {
            clearTimeout(timeoutId)
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error('API request timeout')
            }
            throw error
        }
    }

    /**
     * 解析 API 响应
     */
    private parseResponse(response: string, sessionId: string): SuggestionChip[] {
        try {
            // 尝试从响应中提取 JSON 数组
            const jsonMatch = response.match(/\[[\s\S]*\]/)
            if (!jsonMatch) {
                console.log('[MinimaxService] No JSON array found in response')
                return []
            }

            const parsed = JSON.parse(jsonMatch[0]) as Array<{
                label?: string
                text?: string
                category?: string
                icon?: string
            }>

            if (!Array.isArray(parsed)) {
                return []
            }

            // 转换为 SuggestionChip 格式
            return parsed
                .filter(item => item.label && item.text)
                .slice(0, 4) // 最多 4 个芯片
                .map((item, index) => ({
                    id: `minimax_${sessionId}_${Date.now()}_${index}`,
                    label: String(item.label).slice(0, 12),
                    text: String(item.text),
                    category: this.normalizeCategory(item.category),
                    icon: item.icon || '💡'
                }))
        } catch (error) {
            console.error('[MinimaxService] Failed to parse response:', error)
            return []
        }
    }

    /**
     * 规范化 category
     */
    private normalizeCategory(category?: string): 'todo_check' | 'error_analysis' | 'code_review' | 'general' {
        switch (category) {
            case 'code_review':
                return 'code_review'
            case 'error_analysis':
                return 'error_analysis'
            case 'todo_check':
                return 'todo_check'
            default:
                return 'general'
        }
    }
}
