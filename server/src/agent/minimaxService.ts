/**
 * Layer 2 智能建议服务
 * 使用 Gemini API 生成智能建议
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { SessionSummary } from './types'
import type { SuggestionChip } from '../sync/syncEngine'

// 使用 Gemini API
const API_TIMEOUT_MS = 30_000  // 30秒超时

// 从凭证文件加载 Gemini 配置
function loadGeminiConfig(): { apiKey: string; model: string } {
    const credPath = join(homedir(), 'happy/yoho-task-v2/data/credentials/gemini/default.json')
    try {
        if (existsSync(credPath)) {
            const content = readFileSync(credPath, 'utf-8')
            const creds = JSON.parse(content)
            return {
                apiKey: creds.apiKey || '',
                model: creds.model || 'gemini-2.0-flash'
            }
        }
    } catch (error) {
        console.error('[MinimaxService] Failed to load Gemini credentials:', error)
    }
    return { apiKey: '', model: 'gemini-2.0-flash' }
}

const GEMINI_CONFIG = loadGeminiConfig()

export interface MinimaxReviewRequest {
    sessionId: string
    summary: SessionSummary
}

export interface MinimaxReviewResponse {
    chips: SuggestionChip[]
    error?: string
}

// Gemini API 响应格式
interface GeminiApiResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                text?: string
            }>
        }
    }>
    error?: {
        message: string
        code?: number
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
     * 构建 prompt - 生成用户可能输入的下一步指令
     */
    private buildPrompt(summary: SessionSummary): string {
        const pendingTodos = summary.todos
            ? (summary.todos as Array<{ s?: string; t?: string }>)
                .filter(t => t.s !== 'c')
                .map(t => t.t)
                .slice(0, 5)
            : []

        const completedTodos = summary.todos
            ? (summary.todos as Array<{ s?: string; t?: string }>)
                .filter(t => t.s === 'c')
                .map(t => t.t)
                .slice(-3)
            : []

        const codeChanges = summary.codeChanges?.slice(0, 5) || []
        const errors = summary.errors?.slice(0, 3) || []

        return `你是一个开发助手，帮助预测用户接下来可能想输入的指令。

## 当前会话状态
项目: ${summary.project || 'unknown'}
工作目录: ${summary.workDir}
最近活动: ${summary.recentActivity || '无'}

未完成任务: ${pendingTodos.length > 0 ? pendingTodos.join('; ') : '无'}
刚完成任务: ${completedTodos.length > 0 ? completedTodos.join('; ') : '无'}
代码变更: ${codeChanges.length > 0 ? codeChanges.join('; ') : '无'}
错误信息: ${errors.length > 0 ? errors.join('; ') : '无'}

## 任务
生成 2-4 个用户最可能想输入的下一步指令。这些指令应该：
- 简洁具体，可以直接作为用户输入发送
- 根据上下文推断用户的下一步意图

## 常见的下一步指令类型
- 如果有未完成任务："继续完成 xxx 任务"
- 如果有错误："修复 xxx 错误"
- 如果刚修改了代码："运行测试"、"测试一下刚才的修改"
- 如果任务都完成了："部署"、"提交代码"
- 通用操作："检查类型错误"、"运行 lint"、"构建项目"

## 输出格式
仅输出 JSON 数组，无其他文字：
[
  {"label": "标签", "text": "用户可能输入的具体指令", "category": "general", "icon": "▶️"}
]

## 规则
1. label: 2-6 个字的简短标签
2. text: 用户可能输入的具体指令（5-30字），要像用户自己会说的话
3. category: todo_check / error_analysis / code_review / general
4. icon: 使用相关 emoji
5. 指令要具体、可操作，不要泛泛的建议`
    }

    /**
     * 调用 Gemini API
     */
    private async callApi(prompt: string): Promise<string> {
        if (!GEMINI_CONFIG.apiKey) {
            throw new Error('Gemini API key not configured')
        }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CONFIG.model}:generateContent?key=${GEMINI_CONFIG.apiKey}`

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                { text: prompt }
                            ]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 1024,
                        responseMimeType: 'application/json'
                    }
                }),
                signal: controller.signal
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`API request failed: ${response.status} ${errorText}`)
            }

            const data = await response.json() as GeminiApiResponse

            if (data.error) {
                throw new Error(`API error: ${data.error.message}`)
            }

            const content = data.candidates?.[0]?.content?.parts?.[0]?.text
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
