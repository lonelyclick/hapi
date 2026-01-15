/**
 * MiniMax Function Calling 同步服务
 *
 * 使用 MiniMax API 的 function calling 来汇总对话轮次
 * 这比通过 Claude Code Session 更稳定、更便宜
 */

// MiniMax API 配置
const MINIMAX_API_URL = 'https://api.minimax.io/v1/chat/completions'
const MINIMAX_MODEL = 'MiniMax-M2.1-lightning'  // 快速版本，适合简单任务

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
                if (Array.isArray(args.summaries)) {
                    return args.summaries.filter((s: unknown) =>
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
