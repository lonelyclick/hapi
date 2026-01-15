/**
 * MiniMax Function Calling 同步服务
 *
 * 使用 MiniMax API 的 function calling 来汇总对话轮次
 * 这比通过 Claude Code Session 更稳定、更便宜
 */

// MiniMax API 配置
const MINIMAX_API_URL = 'https://api.minimax.io/v1/chat/completions'
const MINIMAX_MODEL = 'MiniMax-M2.1'  // M2.1 标准版本

// 汇总结果类型
export interface RoundSummary {
    round: number
    summary: string
}

// Function calling 的 tool 定义
const SAVE_SUMMARIES_TOOL = {
    type: 'function' as const,
    function: {
        name: 'save_round_summaries',
        description: '保存对话轮次的汇总结果',
        parameters: {
            type: 'object',
            properties: {
                summaries: {
                    type: 'array',
                    description: '汇总结果数组',
                    items: {
                        type: 'object',
                        properties: {
                            round: {
                                type: 'number',
                                description: '轮次编号'
                            },
                            summary: {
                                type: 'string',
                                description: '该轮对话的汇总，200-500字，重点描述 AI 执行了什么操作、修改了哪些文件、解决了什么问题'
                            }
                        },
                        required: ['round', 'summary']
                    }
                }
            },
            required: ['summaries']
        }
    }
}

/**
 * 使用 MiniMax function calling 生成对话汇总
 */
export async function generateSummariesWithMinimax(
    apiKey: string,
    rounds: Array<{
        roundNumber: number
        userInput: string
        aiMessages: string[]
    }>
): Promise<RoundSummary[]> {
    // 构建 prompt
    let prompt = `## 对话汇总任务\n\n请帮我汇总以下 ${rounds.length} 轮对话的内容。\n\n`

    for (const round of rounds) {
        prompt += `### 第 ${round.roundNumber} 轮对话\n\n`
        prompt += `**用户输入：**\n${round.userInput}\n\n`
        prompt += `**AI 回复：**\n${round.aiMessages.join('\n\n---\n\n')}\n\n---\n\n`
    }

    prompt += `### 要求\n\n请调用 save_round_summaries 函数保存汇总结果。每轮对话需要一个汇总，用简洁的语言描述 AI 在这一轮中做了什么，重点关注：执行了什么操作、修改了哪些文件、解决了什么问题。每个汇总 200-500 字。`

    // 调用 MiniMax API
    const response = await fetch(MINIMAX_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: MINIMAX_MODEL,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            tools: [SAVE_SUMMARIES_TOOL],
            tool_choice: {
                type: 'function',
                function: { name: 'save_round_summaries' }
            },
            temperature: 0.3,  // 低温度确保输出稳定
            max_tokens: 8000
        })
    })

    if (!response.ok) {
        const errorText = await response.text()
        console.error('[MinimaxSync] API error:', response.status, errorText)
        throw new Error(`MiniMax API error: ${response.status} ${errorText}`)
    }

    const result = await response.json() as {
        choices?: Array<{
            message?: {
                content?: string
                tool_calls?: Array<{
                    function?: {
                        name?: string
                        arguments?: string
                    }
                }>
            }
        }>
    }
    console.log('[MinimaxSync] API response:', JSON.stringify(result, null, 2))

    // 解析 function call 结果
    const message = result.choices?.[0]?.message
    if (!message) {
        console.error('[MinimaxSync] No message in response')
        return []
    }

    // 检查 tool_calls
    const toolCalls = message.tool_calls
    if (!toolCalls || toolCalls.length === 0) {
        console.error('[MinimaxSync] No tool_calls in response')
        // 尝试从 content 解析（兼容旧格式）
        if (message.content) {
            return parseFromContent(message.content)
        }
        return []
    }

    // 找到 save_round_summaries 的调用
    for (const call of toolCalls) {
        if (call.function?.name === 'save_round_summaries') {
            try {
                const args = JSON.parse(call.function.arguments)
                let summaries = args.summaries

                // MiniMax 有时会返回双重编码的 JSON 字符串
                if (typeof summaries === 'string') {
                    try {
                        summaries = JSON.parse(summaries)
                    } catch {
                        console.error('[MinimaxSync] Failed to parse nested summaries string')
                    }
                }

                if (Array.isArray(summaries)) {
                    return summaries.filter((s: unknown) =>
                        s && typeof s === 'object' &&
                        'round' in (s as object) &&
                        'summary' in (s as object)
                    ) as RoundSummary[]
                }
            } catch (e) {
                console.error('[MinimaxSync] Failed to parse function arguments:', e)
            }
        }
    }

    return []
}

// Review 建议类型
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

// Function calling 的 tool 定义 - 解析 Review 结果
const PARSE_REVIEW_RESULT_TOOL = {
    type: 'function' as const,
    function: {
        name: 'save_review_result',
        description: '保存代码审查结果',
        parameters: {
            type: 'object',
            properties: {
                suggestions: {
                    type: 'array',
                    description: '审查建议列表',
                    items: {
                        type: 'object',
                        properties: {
                            id: {
                                type: 'string',
                                description: '建议的唯一ID，如 bug-1, security-1, perf-1, improve-1'
                            },
                            type: {
                                type: 'string',
                                enum: ['bug', 'security', 'performance', 'improvement'],
                                description: '建议类型：bug(缺陷), security(安全), performance(性能), improvement(改进)'
                            },
                            severity: {
                                type: 'string',
                                enum: ['high', 'medium', 'low'],
                                description: '严重程度：high(高), medium(中), low(低)'
                            },
                            title: {
                                type: 'string',
                                description: '建议标题，简短描述问题'
                            },
                            detail: {
                                type: 'string',
                                description: '详细说明，包括问题描述、影响范围、修复建议'
                            }
                        },
                        required: ['id', 'type', 'severity', 'title', 'detail']
                    }
                },
                summary: {
                    type: 'string',
                    description: '整体审查总结，简要说明代码质量和主要问题'
                }
            },
            required: ['suggestions', 'summary']
        }
    }
}

/**
 * 使用 MiniMax function calling 解析 Review AI 的输出为结构化 JSON
 */
export async function parseReviewResultWithMinimax(
    apiKey: string,
    reviewText: string
): Promise<ReviewResult | null> {
    const prompt = `## 代码审查结果解析任务

请分析以下代码审查内容，提取出所有的建议和问题，并调用 save_review_result 函数保存结构化结果。

### 审查内容

${reviewText}

### 要求

1. 仔细阅读审查内容，识别所有提到的问题、建议或改进点
2. 为每个建议分类：bug(缺陷)、security(安全)、performance(性能)、improvement(改进)
3. 评估严重程度：high(高)、medium(中)、low(低)
4. 如果审查结论是"代码质量良好，没有问题"，则 suggestions 为空数组
5. 调用 save_review_result 函数保存结果`

    try {
        const response = await fetch(MINIMAX_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: MINIMAX_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                tools: [PARSE_REVIEW_RESULT_TOOL],
                tool_choice: {
                    type: 'function',
                    function: { name: 'save_review_result' }
                },
                temperature: 0.3,
                max_tokens: 8000
            })
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error('[MinimaxSync] parseReviewResult API error:', response.status, errorText)
            return null
        }

        const result = await response.json() as {
            choices?: Array<{
                message?: {
                    content?: string
                    tool_calls?: Array<{
                        function?: {
                            name?: string
                            arguments?: string
                        }
                    }>
                }
            }>
        }
        console.log('[MinimaxSync] parseReviewResult response:', JSON.stringify(result, null, 2))

        const message = result.choices?.[0]?.message
        if (!message) {
            console.error('[MinimaxSync] No message in parseReviewResult response')
            return null
        }

        // 检查 tool_calls
        const toolCalls = message.tool_calls
        if (toolCalls && toolCalls.length > 0) {
            for (const call of toolCalls) {
                if (call.function?.name === 'save_review_result' && call.function.arguments) {
                    try {
                        const args = JSON.parse(call.function.arguments)
                        return {
                            suggestions: args.suggestions || [],
                            summary: args.summary || ''
                        }
                    } catch (e) {
                        console.error('[MinimaxSync] Failed to parse review result arguments:', e)
                    }
                }
            }
        }

        return null
    } catch (err) {
        console.error('[MinimaxSync] parseReviewResultWithMinimax error:', err)
        return null
    }
}

/**
 * 从 content 中解析汇总（兼容不返回 tool_calls 的情况）
 */
function parseFromContent(content: string): RoundSummary[] {
    // 尝试解析 <tool_calls> 标签（MiniMax M1 格式）
    const toolCallMatch = content.match(/<tool_calls>([\s\S]*?)<\/tool_calls>/)
    if (toolCallMatch) {
        try {
            const callData = JSON.parse(toolCallMatch[1].trim())
            if (callData.name === 'save_round_summaries' && callData.arguments?.summaries) {
                return callData.arguments.summaries
            }
        } catch {
            // 继续尝试其他格式
        }
    }

    // 尝试解析 JSON 代码块
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[1])
            if (Array.isArray(parsed)) {
                return parsed.filter(s => s.round && s.summary)
            }
            if (parsed.summaries && Array.isArray(parsed.summaries)) {
                return parsed.summaries.filter((s: unknown) =>
                    s && typeof s === 'object' &&
                    'round' in (s as object) &&
                    'summary' in (s as object)
                )
            }
        } catch {
            // 解析失败
        }
    }

    return []
}
