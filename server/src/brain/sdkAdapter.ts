/**
 * Claude Agent SDK 适配器
 *
 * 封装 @anthropic-ai/claude-agent-sdk 的 query 函数
 * 提供流式查询和消息转换功能
 */

import {
    query as sdkQuery,
    type PermissionMode,
    type PermissionResult,
    type Query as SDKQuery,
    type SDKMessage
} from '@anthropic-ai/claude-agent-sdk'

/**
 * Brain 模式配置
 */
export interface BrainQueryOptions {
    // 工作目录
    cwd: string
    // Claude Code 可执行文件路径 (可选，默认使用 SDK 内置的 cli.js)
    pathToClaudeCodeExecutable?: string
    // 模型 (默认 sonnet，也可以用 opus、haiku)
    model?: string
    // 系统提示词
    systemPrompt?: string
    // 追加系统提示词
    appendSystemPrompt?: string
    // 最大轮次
    maxTurns?: number
    // 指定可用工具集合（用于严格限制 toolset）
    tools?: string[]
    // 允许的工具
    allowedTools?: string[]
    // 禁用的工具
    disallowedTools?: string[]
    // 权限模式
    permissionMode?: PermissionMode
    // 中止控制器
    abortController?: AbortController
    // 传递给 Claude Code 子进程的环境变量
    env?: Record<string, string | undefined>
}

/**
 * 消息回调类型
 */
export interface MessageCallbacks {
    // 收到助手消息时回调
    onAssistantMessage?: (message: { content: string; uuid: string }) => void
    // 收到工具使用消息时回调
    onToolUse?: (toolName: string, input: Record<string, unknown>) => void
    // 收到工具结果时回调
    onToolResult?: (toolName: string, result: unknown) => void
    // 收到系统消息时回调
    onSystemMessage?: (message: SDKMessage) => void
    // 收到结果时回调
    onResult?: (result: {
        success: boolean
        result?: string
        error?: string
        numTurns: number
        totalCostUsd: number
        durationMs: number
    }) => void
    // 进度更新
    onProgress?: (type: 'thinking' | 'tool' | 'done', data?: unknown) => void
}

/**
 * 执行 Brain 查询
 *
 * @param prompt - 用户提示词
 * @param options - 查询选项
 * @param callbacks - 消息回调
 * @returns Promise，在查询完成时 resolve
 */
export async function executeBrainQuery(
    prompt: string,
    options: BrainQueryOptions,
    callbacks: MessageCallbacks = {}
): Promise<void> {
    const {
        cwd,
        // 使用 glm-4.7 模型（litellm 支持，而 claude-sonnet-4-5 映射的 kimi API 返回 401）
        model = 'glm-4.7',
        systemPrompt,
        appendSystemPrompt,
        maxTurns = 20,
        tools = ['Read', 'Grep', 'Glob'],
        allowedTools = ['Read', 'Grep', 'Glob'],
        disallowedTools = ['Bash', 'Edit', 'Write', 'Task'],
        permissionMode = 'dontAsk',
        abortController,
        env
    } = options

    // 创建 SDK 查询
    // 构建完整的 systemPrompt（如果有 appendSystemPrompt，拼接在一起）
    let finalSystemPrompt = systemPrompt
    if (appendSystemPrompt && systemPrompt) {
        finalSystemPrompt = `${systemPrompt}\n\n${appendSystemPrompt}`
    } else if (appendSystemPrompt) {
        finalSystemPrompt = appendSystemPrompt
    }

    // SDK 会将 env 透传给 Claude Code 子进程。
    // 注意：SDK 在传入 env 时不会自动合并 process.env，因此这里必须做 merge。
    // 同时如果未配置 ANTHROPIC_*，但配置了 LITELLM_*，则自动映射为 Anthropic 环境变量。
    const finalEnv: Record<string, string | undefined> = { ...process.env, ...(env ?? {}) }

    const litellmApiKey = finalEnv.LITELLM_API_KEY
    const litellmBaseUrl = finalEnv.LITELLM_BASE_URL

    if (!finalEnv.ANTHROPIC_API_KEY && litellmApiKey) {
        finalEnv.ANTHROPIC_API_KEY = litellmApiKey
    }

    if (!finalEnv.ANTHROPIC_BASE_URL) {
        if (litellmBaseUrl) {
            finalEnv.ANTHROPIC_BASE_URL = litellmBaseUrl
        } else if (litellmApiKey) {
            finalEnv.ANTHROPIC_BASE_URL = 'http://localhost:4000'
        }
    }

    const canUseTool = async (toolName: string, _input: Record<string, unknown>, context: { toolUseID: string }): Promise<PermissionResult> => {
        if (disallowedTools.includes(toolName)) {
            return { behavior: 'deny', message: `Tool disallowed in Brain mode: ${toolName}`, toolUseID: context.toolUseID }
        }

        if (allowedTools.includes(toolName)) {
            return { behavior: 'allow', toolUseID: context.toolUseID }
        }

        return { behavior: 'deny', message: `Tool not allowed in Brain mode: ${toolName}`, toolUseID: context.toolUseID }
    }

    const query: SDKQuery = sdkQuery({
        prompt,
        options: {
            cwd,
            model,
            systemPrompt: finalSystemPrompt,
            maxTurns,
            tools,
            allowedTools,
            disallowedTools,
            permissionMode,
            abortController,
            canUseTool,
            env: finalEnv,
            // 指定 SDK 内置的 Claude Code 可执行文件路径
            pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
        }
    })

    // 处理流式消息
    try {
        for await (const message of query) {
            switch (message.type) {
                case 'system':
                    callbacks.onSystemMessage?.(message)
                    // 使用 'init' 作为会话开始的标志
                    if (message.subtype === 'init') {
                        const msg = message as { session_id?: string }
                        callbacks.onProgress?.('thinking', { sessionId: msg.session_id })
                    }
                    break

                case 'assistant':
                    // 提取文本内容
                    const textContent = extractTextContent(message)
                    if (textContent) {
                        callbacks.onAssistantMessage?.({
                            content: textContent,
                            uuid: (message as { uuid: string }).uuid
                        })
                    }

                    // 处理工具使用
                    const msg = message as { message?: { content?: Array<{ type: string; name?: string; input?: unknown }> } }
                    if (msg.message?.content) {
                        for (const block of msg.message.content) {
                            if (block.type === 'tool_use' && block.name) {
                                callbacks.onToolUse?.(block.name, (block.input || {}) as Record<string, unknown>)
                                callbacks.onProgress?.('tool', {
                                    toolName: block.name,
                                    input: block.input
                                })
                            }
                        }
                    }
                    break

                case 'tool_progress':
                    const toolMsg = message as { tool_name: string }
                    callbacks.onToolResult?.(toolMsg.tool_name, undefined)
                    break

                case 'result':
                    const resMsg = message as {
                        subtype: string
                        result?: string
                        errors?: string[]
                        num_turns: number
                        total_cost_usd: number
                        duration_ms: number
                    }
                    const isSuccess = resMsg.subtype === 'success'
                    callbacks.onResult?.({
                        success: isSuccess,
                        result: resMsg.result,
                        error: isSuccess
                            ? undefined
                            : Array.isArray(resMsg.errors) && resMsg.errors.length > 0
                                ? resMsg.errors.join('\n')
                                : 'Query failed',
                        numTurns: resMsg.num_turns,
                        totalCostUsd: resMsg.total_cost_usd,
                        durationMs: resMsg.duration_ms
                    })
                    callbacks.onProgress?.('done')
                    break

                default:
                    // 处理其他消息类型
                    callbacks.onSystemMessage?.(message)
            }
        }
    } catch (error) {
        if ((error as Error).name === 'AbortError') {
            // 用户中止
            callbacks.onResult?.({
                success: false,
                error: 'Aborted by user',
                numTurns: 0,
                totalCostUsd: 0,
                durationMs: 0
            })
            callbacks.onProgress?.('done')
            return
        }

        // 其他错误
        callbacks.onResult?.({
            success: false,
            error: (error as Error).message,
            numTurns: 0,
            totalCostUsd: 0,
            durationMs: 0
        })
        callbacks.onProgress?.('done')
        throw error
    } finally {
        query.close()
    }
}

/**
 * 从 SDK 助手消息中提取文本内容
 */
function extractTextContent(message: { message?: { content?: Array<{ type: string; text?: string }> } }): string | null {
    const content = message.message?.content
    if (!content || !Array.isArray(content)) {
        return null
    }

    const textBlocks = content
        .filter(block => block.type === 'text' && block.text)
        .map(block => block.text!)

    return textBlocks.length > 0 ? textBlocks.join('\n\n') : null
}

/**
 * 创建可中止的查询控制器
 */
export class BrainQueryController {
    private abortController: AbortController | null = null
    private currentPromise: Promise<void> | null = null

    /**
     * 开始一个新的查询
     */
    async start(
        prompt: string,
        options: BrainQueryOptions,
        callbacks: MessageCallbacks = {}
    ): Promise<void> {
        // 如果有正在进行的查询，先中止它
        if (this.currentPromise) {
            this.abort()
            try {
                await this.currentPromise
            } catch {
                // 忽略中止错误
            }
        }

        // 创建新的中止控制器
        this.abortController = new AbortController()

        // 执行查询
        const promise = executeBrainQuery(
            prompt,
            { ...options, abortController: this.abortController },
            callbacks
        )
        this.currentPromise = promise
        void promise.finally(() => {
            if (this.currentPromise === promise) {
                this.currentPromise = null
                this.abortController = null
            }
        })

        return promise
    }

    /**
     * 中止当前查询
     */
    abort(): void {
        if (this.abortController) {
            this.abortController.abort()
            this.abortController = null
        }
    }

    /**
     * 检查是否有正在进行的查询
     */
    isRunning(): boolean {
        return this.currentPromise !== null
    }
}
