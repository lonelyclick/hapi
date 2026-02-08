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
                // 1. Fetch conversation history
                const messages = await api.getSessionMessages(client.sessionId, { limit: 200 })
                logger.debug(`[hapiMCP] Fetched ${messages.length} messages for session ${client.sessionId}`)

                // 2. Build conversation summary from messages
                const conversationParts: string[] = []
                for (const msg of messages) {
                    const content = msg.content as Record<string, unknown> | null
                    if (!content) continue

                    const role = content.role as string
                    const body = content.content

                    if (role === 'user') {
                        let text = ''
                        if (typeof body === 'string') {
                            text = body
                        } else if (typeof body === 'object' && body && 'text' in (body as Record<string, unknown>)) {
                            text = String((body as Record<string, unknown>).text)
                        } else if (Array.isArray(body)) {
                            text = (body as Array<Record<string, unknown>>)
                                .filter(b => b.type === 'text' && typeof b.text === 'string')
                                .map(b => String(b.text))
                                .join('\n')
                        }
                        if (text.trim()) {
                            conversationParts.push(`**用户：** ${text.trim().slice(0, 500)}`)
                        }
                    } else if (role === 'assistant') {
                        let text = ''
                        if (typeof body === 'string') {
                            text = body
                        } else if (Array.isArray(body)) {
                            text = (body as Array<Record<string, unknown>>)
                                .filter(b => b.type === 'text' && typeof b.text === 'string')
                                .map(b => String(b.text))
                                .join('\n')
                        }
                        if (text.trim()) {
                            conversationParts.push(`**AI：** ${text.trim().slice(0, 500)}`)
                        }
                    }
                }

                // Limit conversation summary length
                const maxParts = 30
                const conversationSummary = conversationParts.length > maxParts
                    ? conversationParts.slice(-maxParts).join('\n\n')
                    : conversationParts.join('\n\n')

                // 3. Build prompt for temporary Claude agent
                const analysisPrompt = `你是一个资深的代码审查和项目分析专家。请基于以下 AI 编程会话的对话记录，分析当前项目状态并给出建议。

## 对话记录

${conversationSummary || '（无对话记录）'}

${args.context ? `## 额外关注点\n${args.context}\n` : ''}

## 任务

1. **会话汇总**：总结这次 AI 编程会话中做了什么（200-300字）
2. **代码审查**：用 Read/Grep/Glob 工具查看相关代码文件，检查是否有问题：
   - 潜在的 bug 或逻辑错误
   - 安全隐患
   - 性能问题
   - 代码风格和最佳实践
3. **改进建议**：给出 3-5 条具体的、可操作的改进建议

请用以下格式输出：

## 会话汇总
（总结内容）

## 发现的问题
（如果有的话，列出问题）

## 改进建议
1. （建议1）
2. （建议2）
...`

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
