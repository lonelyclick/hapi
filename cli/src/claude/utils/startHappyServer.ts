/**
 * HAPI MCP server
 * Provides HAPI CLI specific tools including chat session title management
 * and brain analysis capabilities
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { ApiClient } from "@/api/api";
import { randomUUID } from "node:crypto";
import { query as sdkQuery } from "@/claude/sdk/query";
import type { SDKMessage } from "@/claude/sdk/types";

interface StartHappyServerOptions {
    api?: ApiClient
    sessionSource?: string
    mainSessionId?: string
}

export async function startHappyServer(client: ApiSessionClient, options?: StartHappyServerOptions) {
    const { api, sessionSource, mainSessionId } = options ?? {}
    const isBrainSession = sessionSource === 'brain-sdk'
    // Handler that sends title updates via the client
    const handler = async (title: string) => {
        logger.debug('[hapiMCP] Changing title to:', title);
        try {
            // Send title as a summary message, similar to title generator
            client.sendClaudeSessionMessage({
                type: 'summary',
                summary: title,
                leafUuid: randomUUID()
            });
            
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };

    //
    // Create the MCP server
    //

    const mcp = new McpServer({
        name: "HAPI MCP",
        version: "1.0.0",
    });

    // Avoid TS instantiation depth issues by widening the schema type.
    const changeTitleInputSchema: z.ZodTypeAny = z.object({
        title: z.string().describe('The new title for the chat session'),
    });

    mcp.registerTool<any, any>('change_title', {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: changeTitleInputSchema,
    }, async (args: { title: string }) => {
        const response = await handler(args.title);
        logger.debug('[hapiMCP] Response:', response);
        
        if (response.success) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Successfully changed chat title to: "${args.title}"`,
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    //
    // Brain Analyze tool (only for brain sessions)
    //
    const toolNames = ['change_title']

    if (isBrainSession && api) {
        const brainAnalyzeInputSchema: z.ZodTypeAny = z.object({
            context: z.string().optional().describe('Optional extra context about what to focus on'),
        })

        mcp.registerTool<any, any>('brain_analyze', {
            description: 'Analyze the current AI session conversation and project code. Spawns a temporary Claude agent that reads the conversation history and project files, then returns a structured summary with actionable suggestions.',
            title: 'Brain Analyze',
            inputSchema: brainAnalyzeInputSchema,
        }, async (args: { context?: string }) => {
            logger.debug('[hapiMCP] brain_analyze called with context:', args.context)

            try {
                // 1. Fetch latest messages from main session
                const targetSessionId = mainSessionId || client.sessionId
                const messages = await api.getSessionMessages(targetSessionId, { limit: 50 })
                logger.debug(`[hapiMCP] Fetched ${messages.length} messages for session ${targetSessionId}`)

                // 2. Extract only the latest round (last user message + subsequent assistant messages)
                const extractText = (body: unknown): string => {
                    if (typeof body === 'string') return body
                    if (typeof body === 'object' && body && 'text' in (body as Record<string, unknown>)) {
                        return String((body as Record<string, unknown>).text)
                    }
                    if (Array.isArray(body)) {
                        return (body as Array<Record<string, unknown>>)
                            .filter(b => b.type === 'text' && typeof b.text === 'string')
                            .map(b => String(b.text))
                            .join('\n')
                    }
                    return ''
                }

                // Find the last user message index
                let lastUserIdx = -1
                for (let i = messages.length - 1; i >= 0; i--) {
                    const content = messages[i].content as Record<string, unknown> | null
                    if (content?.role === 'user') {
                        lastUserIdx = i
                        break
                    }
                }

                const conversationParts: string[] = []
                const startIdx = lastUserIdx >= 0 ? lastUserIdx : Math.max(0, messages.length - 2)
                for (let i = startIdx; i < messages.length; i++) {
                    const content = messages[i].content as Record<string, unknown> | null
                    if (!content) continue
                    const role = content.role as string
                    const text = extractText(content.content).trim()
                    if (!text) continue
                    if (role === 'user') {
                        conversationParts.push(`**用户：** ${text.slice(0, 1000)}`)
                    } else if (role === 'assistant') {
                        conversationParts.push(`**AI：** ${text.slice(0, 2000)}`)
                    }
                }

                const conversationSummary = conversationParts.join('\n\n')

                // 3. Build prompt for temporary Claude agent
                const analysisPrompt = `你是一个资深的代码审查和项目分析专家。请基于以下最新一轮 AI 编程会话的对话记录，审查代码改动并给出建议。

## 最新一轮对话

${conversationSummary || '（无对话记录）'}

${args.context ? `## 额外关注点\n${args.context}\n` : ''}

## 任务

1. **本轮汇总**：总结这轮对话中 AI 做了什么（100-200字）
2. **代码审查**：用 Read/Grep/Glob 工具查看本轮涉及的代码文件，检查是否有问题：
   - 潜在的 bug 或逻辑错误
   - 安全隐患
   - 性能问题
   - 代码风格和最佳实践
3. **改进建议**：给出具体的、可操作的改进建议（如果没有问题就说没有）

请用以下格式输出：

## 本轮汇总
（总结内容）

## 发现的问题
（如果有的话，列出问题；没有就写"无明显问题"）

## 改进建议
（如果有的话列出；没有就写"暂无"）`

                // 4. Call SDK query() to spawn temporary Claude agent
                logger.debug('[hapiMCP] Spawning temporary Claude agent for brain analysis...')

                let resultText = ''
                const queryInstance = sdkQuery({
                    prompt: analysisPrompt,
                    options: {
                        cwd: process.cwd(),
                        allowedTools: ['Read', 'Grep', 'Glob'],
                        disallowedTools: ['Bash', 'Edit', 'Write', 'Task', 'WebFetch', 'WebSearch', 'TodoWrite', 'NotebookEdit'],
                        permissionMode: 'bypassPermissions',
                        maxTurns: 15,
                        pathToClaudeCodeExecutable: 'claude',
                    }
                })

                for await (const message of queryInstance) {
                    if (message.type === 'result') {
                        const resultMsg = message as SDKMessage & { result?: string; subtype?: string }
                        if (resultMsg.result) {
                            resultText = resultMsg.result
                        }
                    }
                }

                logger.debug(`[hapiMCP] Brain analysis completed, result length: ${resultText.length}`)

                if (!resultText) {
                    resultText = '分析完成，但未能生成结果。请稍后重试。'
                }

                return {
                    content: [{ type: 'text' as const, text: resultText }],
                    isError: false,
                }
            } catch (error) {
                logger.debug('[hapiMCP] brain_analyze error:', error)
                return {
                    content: [{ type: 'text' as const, text: `Brain 分析失败: ${error instanceof Error ? error.message : String(error)}` }],
                    isError: true,
                }
            }
        })

        toolNames.push('brain_analyze')
        logger.debug('[hapiMCP] Registered brain_analyze tool for brain session')

        // brain_send_message: Send review results to the main session
        if (mainSessionId) {
            const brainSendMessageInputSchema: z.ZodTypeAny = z.object({
                message: z.string().describe('The review message to send to the main session'),
                type: z.enum(['review', 'suggestion', 'info']).optional().describe('Message type: review (code review), suggestion (improvement suggestion), info (general info). Defaults to review.'),
            })

            mcp.registerTool<any, any>('brain_send_message', {
                description: 'Send a message from Brain to the main AI session. Use this to deliver code review results, suggestions, or other feedback to the main session where the AI coding assistant is working.',
                title: 'Brain Send Message',
                inputSchema: brainSendMessageInputSchema,
            }, async (args: { message: string; type?: 'review' | 'suggestion' | 'info' }) => {
                logger.debug(`[hapiMCP] brain_send_message called, type=${args.type}, mainSessionId=${mainSessionId}`)

                try {
                    const msgType = args.type ?? 'review'
                    const prefix = msgType === 'review'
                        ? '[发送者: Brain 代码审查]'
                        : msgType === 'suggestion'
                            ? '[发送者: Brain 改进建议]'
                            : '[发送者: Brain]'

                    const fullMessage = `${prefix}\n\n${args.message}`

                    // Send message to main session via server API
                    await api.sendMessageToSession(mainSessionId, fullMessage, 'brain-sdk-review')

                    logger.debug(`[hapiMCP] Message sent to main session ${mainSessionId}`)

                    return {
                        content: [{ type: 'text' as const, text: `已成功发送${msgType === 'review' ? '代码审查' : msgType === 'suggestion' ? '改进建议' : ''}消息给主 session` }],
                        isError: false,
                    }
                } catch (error) {
                    logger.debug('[hapiMCP] brain_send_message error:', error)
                    return {
                        content: [{ type: 'text' as const, text: `发送消息失败: ${error instanceof Error ? error.message : String(error)}` }],
                        isError: true,
                    }
                }
            })

            toolNames.push('brain_send_message')
            logger.debug('[hapiMCP] Registered brain_send_message tool for brain session')
        }
    }

    const transport = new StreamableHTTPServerTransport({
        // NOTE: Returning session id here will result in claude
        // sdk spawn to fail with `Invalid Request: Server already initialized`
        sessionIdGenerator: undefined
    });
    await mcp.connect(transport);

    //
    // Create the HTTP server
    //

    const server = createServer(async (req, res) => {
        try {
            await transport.handleRequest(req, res);
        } catch (error) {
            logger.debug("Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    return {
        url: baseUrl.toString(),
        toolNames,
        stop: () => {
            logger.debug('[hapiMCP] Stopping server');
            mcp.close();
            server.close();
        }
    }
}
