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
// SDK query removed – brain_summarize no longer spawns a temp agent

interface StartHappyServerOptions {
    api?: ApiClient
    sessionSource?: string
    mainSessionId?: string
}

export async function startHappyServer(client: ApiSessionClient, options?: StartHappyServerOptions) {
    const { api, sessionSource, mainSessionId } = options ?? {}
    const isBrainSession = sessionSource === 'brain-sdk'
    logger.debug(`[hapiMCP] startHappyServer: sessionSource=${sessionSource}, mainSessionId=${mainSessionId}, isBrain=${isBrainSession}, clientSessionId=${client.sessionId}`)
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
        const brainSummarizeInputSchema: z.ZodTypeAny = z.object({})

        mcp.registerTool<any, any>('brain_summarize', {
            description: 'Fetch and summarize the latest conversation round from the main session. Returns: the original user request, what was changed, how it was changed, and any complex/noteworthy flows.',
            title: 'Brain Summarize',
            inputSchema: brainSummarizeInputSchema,
        }, async () => {
            logger.debug(`[hapiMCP] brain_summarize called, mainSessionId=${mainSessionId}`)

            try {
                if (!mainSessionId) {
                    return {
                        content: [{ type: 'text' as const, text: '错误：未配置 mainSessionId，无法获取主 session 对话。请重新创建 Brain session。' }],
                        isError: true,
                    }
                }
                const targetSessionId = mainSessionId
                const messages = await api.getSessionMessages(targetSessionId, { limit: 50 })
                logger.debug(`[hapiMCP] Fetched ${messages.length} messages for session ${targetSessionId}`)

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

                const parts: string[] = []
                const startIdx = lastUserIdx >= 0 ? lastUserIdx : Math.max(0, messages.length - 2)
                for (let i = startIdx; i < messages.length; i++) {
                    const content = messages[i].content as Record<string, unknown> | null
                    if (!content) continue
                    const role = content.role as string
                    const text = extractText(content.content).trim()
                    if (!text) continue
                    if (role === 'user') {
                        parts.push(`**用户：** ${text.slice(0, 2000)}`)
                    } else if (role === 'assistant') {
                        parts.push(`**AI：** ${text.slice(0, 4000)}`)
                    }
                }

                if (parts.length === 0) {
                    return {
                        content: [{ type: 'text' as const, text: '当前没有可汇总的对话记录。' }],
                        isError: false,
                    }
                }

                const summary = parts.join('\n\n')

                return {
                    content: [{ type: 'text' as const, text: summary }],
                    isError: false,
                }
            } catch (error) {
                logger.debug('[hapiMCP] brain_summarize error:', error)
                return {
                    content: [{ type: 'text' as const, text: `对话汇总失败: ${error instanceof Error ? error.message : String(error)}` }],
                    isError: true,
                }
            }
        })

        toolNames.push('brain_summarize')
        logger.debug('[hapiMCP] Registered brain_summarize tool for brain session')

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
