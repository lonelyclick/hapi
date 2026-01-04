/**
 * Layer 2 智能建议服务
 * 使用 Grok API 生成智能建议
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { SessionSummary } from './types'
import type { SuggestionChip } from '../sync/syncEngine'

// 使用 Grok API (更快更稳定)
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions'
const API_TIMEOUT_MS = 30_000  // 30秒超时

// 从凭证文件加载 Grok 配置
function loadGrokConfig(): { apiKey: string; model: string } {
    const credPath = join(homedir(), 'happy/yoho-task-v2/data/credentials/grok/default.json')
    try {
        if (existsSync(credPath)) {
            const content = readFileSync(credPath, 'utf-8')
            const creds = JSON.parse(content)
            return {
                apiKey: creds.apiKey || '',
                model: creds.model || 'grok-code-fast-1'
            }
        }
    } catch (error) {
        console.error('[MinimaxService] Failed to load Grok credentials:', error)
    }
    return { apiKey: '', model: 'grok-code-fast-1' }
}

const GROK_CONFIG = loadGrokConfig()

export interface MinimaxReviewRequest {
    sessionId: string
    summary: SessionSummary
}

export interface MinimaxReviewResponse {
    chips: SuggestionChip[]
    error?: string
}

// Grok API 使用 OpenAI 兼容格式
interface GrokApiResponse {
    choices?: Array<{
        message?: {
            content: string
        }
    }>
    error?: {
        message: string
        type?: string
    }
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
     * 调用 Grok API
     */
    private async callApi(prompt: string): Promise<string> {
        if (!GROK_CONFIG.apiKey) {
            throw new Error('Grok API key not configured')
        }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

        try {
            const response = await fetch(GROK_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROK_CONFIG.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: GROK_CONFIG.model,
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
                const errorText = await response.text()
                throw new Error(`API request failed: ${response.status} ${errorText}`)
            }

            const data = await response.json() as GrokApiResponse

            if (data.error) {
                throw new Error(`API error: ${data.error.message}`)
            }

            const content = data.choices?.[0]?.message?.content
            if (!content) {
                throw new Error('Empty response from API')
            }

            return content
        } catch (error) {
            clearTimeout(timeoutId)
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error('API request timeout (30s)')
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
