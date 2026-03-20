/**
 * Brain MCP Tools
 *
 * Provides session orchestration tools for Brain mode.
 * Brain sessions can create, control, and monitor other hapi sessions.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ApiClient } from '@/api/api'
import { logger } from '@/ui/logger'

const EARLY_RETURN_MS = 30_000      // 30s then early return
const POLL_MAX_WAIT_MS = 150_000    // poll waits up to 150s
const POLL_INTERVAL_MS = 5_000      // check every 5s
const STALE_THRESHOLD = 12          // 12 * 5s = 60s without new messages = stale

interface BrainToolsOptions {
    apiClient: ApiClient
    machineId: string
    brainSessionId: string
}

/**
 * Extract the last assistant text from raw message content objects.
 * Messages from getSessionMessages have { content: unknown } where content
 * is a Claude SDK message object.
 */
function extractLastAgentText(messages: Array<{ content: unknown }>): string | null {
    // Walk backwards to find the last assistant message with text
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        const content = msg.content as any
        if (!content) continue

        // Claude SDK format: { type: 'assistant', content: [...blocks] }
        if (content.type === 'assistant' && Array.isArray(content.content)) {
            const textBlocks = content.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
            if (textBlocks.length > 0) {
                return textBlocks.join('\n')
            }
        }

        // Simple text message format
        if (typeof content.text === 'string' && content.role === 'assistant') {
            return content.text
        }
    }
    return null
}

async function waitForCompletion(
    api: ApiClient,
    sessionId: string,
    timeoutMs: number
): Promise<{ completed: boolean; text: string | null; exitReason: string }> {
    const startTime = Date.now()
    let lastMessageCount = 0
    let stuckCount = 0

    while (Date.now() - startTime < timeoutMs) {
        try {
            const session = await api.getSession(sessionId)

            // Session went inactive
            if (!session.active) {
                const messages = await api.getSessionMessages(sessionId, { limit: 20 })
                const text = extractLastAgentText(messages)
                return { completed: true, text, exitReason: 'inactive' }
            }

            // Session finished thinking
            if (!session.thinking) {
                const messages = await api.getSessionMessages(sessionId, { limit: 20 })
                const text = extractLastAgentText(messages)
                return { completed: true, text, exitReason: 'done' }
            }

            // Stale detection: thinking=true but no new messages for 60s
            const messages = await api.getSessionMessages(sessionId, { limit: 5 })
            const currentCount = messages.length
            if (currentCount === lastMessageCount) {
                stuckCount++
                if (stuckCount >= STALE_THRESHOLD) {
                    const allMessages = await api.getSessionMessages(sessionId, { limit: 20 })
                    const text = extractLastAgentText(allMessages)
                    return { completed: false, text, exitReason: 'stale' }
                }
            } else {
                stuckCount = 0
                lastMessageCount = currentCount
            }
        } catch (err) {
            logger.debug('[brain] Error polling session:', err)
        }

        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    }

    // Timeout - get latest output
    try {
        const messages = await api.getSessionMessages(sessionId, { limit: 20 })
        const text = extractLastAgentText(messages)
        return { completed: false, text, exitReason: 'timeout' }
    } catch {
        return { completed: false, text: null, exitReason: 'timeout' }
    }
}

export function registerBrainTools(
    mcp: McpServer,
    toolNames: string[],
    options: BrainToolsOptions
): void {
    const { apiClient: api, machineId, brainSessionId } = options

    // ===== 1. hapi_session_create =====
    const createSchema: z.ZodTypeAny = z.object({
        directory: z.string().describe('工作目录的绝对路径，如 /home/guang/softwares/hapi'),
        machineId: z.string().optional().describe('目标机器 ID。不填则使用当前机器。'),
        agent: z.enum(['claude', 'codex', 'opencode']).optional().describe('Agent 类型，默认 claude'),
    })

    mcp.registerTool<any, any>('hapi_session_create', {
        title: 'Create Session',
        description: '在指定机器上创建新的工作 session。返回 sessionId 用于后续操作。',
        inputSchema: createSchema,
    }, async (args: { directory: string; machineId?: string; agent?: string }) => {
        try {
            const targetMachineId = args.machineId || machineId
            logger.debug(`[brain] Creating session: machine=${targetMachineId}, dir=${args.directory}, agent=${args.agent || 'claude'}`)

            const result = await api.brainSpawnSession({
                machineId: targetMachineId,
                directory: args.directory,
                agent: args.agent,
                source: 'brain-child',
                mainSessionId: brainSessionId,
            })

            if (result.type === 'success') {
                // Wait for session to come online (up to 30s)
                let ready = false
                for (let i = 0; i < 30; i++) {
                    try {
                        const session = await api.getSession(result.sessionId)
                        if (session.active) {
                            ready = true
                            break
                        }
                    } catch { /* not ready yet */ }
                    await new Promise(r => setTimeout(r, 1000))
                }

                return {
                    content: [{
                        type: 'text' as const,
                        text: `Session 创建成功。\n\nsessionId: ${result.sessionId}\n状态: ${ready ? '已上线' : '启动中（可能需要等待几秒）'}`,
                    }],
                }
            }

            return {
                content: [{
                    type: 'text' as const,
                    text: `创建失败: ${result.message}`,
                }],
                isError: true,
            }
        } catch (err: any) {
            return {
                content: [{
                    type: 'text' as const,
                    text: `创建失败: ${err.message || String(err)}`,
                }],
                isError: true,
            }
        }
    })

    // ===== 2. hapi_session_send =====
    const sendSchema: z.ZodTypeAny = z.object({
        sessionId: z.string().describe('目标 session ID'),
        message: z.string().describe('要发送的消息/任务指令'),
    })

    mcp.registerTool<any, any>('hapi_session_send', {
        title: 'Send to Session',
        description: '向指定 session 发送消息。发送后等待最多 30 秒获取初步结果。如果任务未完成，你 MUST 调用 hapi_session_poll 等待最终结果。',
        inputSchema: sendSchema,
    }, async (args: { sessionId: string; message: string }) => {
        try {
            // Check if session is thinking first
            const session = await api.getSession(args.sessionId)
            if (session.thinking) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Session ${args.sessionId} 正在处理上一个任务（thinking=true）。请先调用 hapi_session_poll 等待其完成，然后再发送新消息。`,
                    }],
                }
            }

            // Send message
            await api.sendMessageToSession(args.sessionId, args.message, 'brain')

            // Wait for initial result (earlyReturn after 30s)
            const result = await waitForCompletion(api, args.sessionId, EARLY_RETURN_MS)

            if (result.completed) {
                const output = result.text || '（无输出）'
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Session ${args.sessionId} 任务已完成。\n\n${output}`,
                    }],
                }
            }

            // earlyReturn - still working
            const progress = result.text ? `\n\n当前进度：\n${result.text}` : ''
            return {
                content: [{
                    type: 'text' as const,
                    text: `消息已发送，Session ${args.sessionId} 正在执行中。${progress}\n\n⚠️ [强制] 你 MUST 立即调用 hapi_session_poll(sessionId="${args.sessionId}") 等待最终结果。禁止说"等做完再汇报"然后结束对话——你必须现在就 poll 并等到完成。`,
                }],
            }
        } catch (err: any) {
            return {
                content: [{
                    type: 'text' as const,
                    text: `发送失败: ${err.message || String(err)}`,
                }],
                isError: true,
            }
        }
    })

    // ===== 3. hapi_session_poll =====
    const pollSchema: z.ZodTypeAny = z.object({
        sessionId: z.string().describe('目标 session ID'),
    })

    mcp.registerTool<any, any>('hapi_session_poll', {
        title: 'Poll Session',
        description: '轮询指定 session 的状态，等待任务完成。内部自动等待最多 150 秒。',
        inputSchema: pollSchema,
    }, async (args: { sessionId: string }) => {
        try {
            const result = await waitForCompletion(api, args.sessionId, POLL_MAX_WAIT_MS)

            if (result.completed || result.exitReason === 'stale') {
                const output = result.text || '（无输出）'
                const statusMsg = result.exitReason === 'inactive'
                    ? '（Session 已停止，可能被中断或崩溃）'
                    : result.exitReason === 'stale'
                        ? '（Session 可能已僵死，60秒内无新消息）'
                        : ''
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Session ${args.sessionId} 任务已完成。${statusMsg}\n\n${output}`,
                    }],
                }
            }

            // Timeout
            const progress = result.text ? `\n\n当前进度：\n${result.text}` : ''
            return {
                content: [{
                    type: 'text' as const,
                    text: `轮询超时（150秒），Session ${args.sessionId} 仍在工作中。${progress}\n\n你可以再次调用 hapi_session_poll 继续等待。`,
                }],
            }
        } catch (err: any) {
            return {
                content: [{
                    type: 'text' as const,
                    text: `轮询失败: ${err.message || String(err)}`,
                }],
                isError: true,
            }
        }
    })

    // ===== 4. hapi_session_list =====
    const listSchema: z.ZodTypeAny = z.object({})

    mcp.registerTool<any, any>('hapi_session_list', {
        title: 'List Sessions',
        description: '列出所有可用的 session 及其状态。',
        inputSchema: listSchema,
    }, async () => {
        try {
            const data = await api.listSessions()
            if (!data.sessions || data.sessions.length === 0) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: '当前没有任何 session。',
                    }],
                }
            }

            const lines = data.sessions.map(s => {
                const status = !s.active
                    ? '⬜ 离线'
                    : s.thinking
                        ? '🔄 执行中'
                        : '✅ 空闲'
                const name = s.metadata?.summary?.text || s.metadata?.path || '未命名'
                const source = s.metadata?.source ? ` [${s.metadata.source}]` : ''
                return `- ${s.id.slice(0, 8)} [${status}] ${name}${source}`
            })

            return {
                content: [{
                    type: 'text' as const,
                    text: `当前 sessions (${data.sessions.length}):\n${lines.join('\n')}`,
                }],
            }
        } catch (err: any) {
            return {
                content: [{
                    type: 'text' as const,
                    text: `列出失败: ${err.message || String(err)}`,
                }],
                isError: true,
            }
        }
    })

    // ===== 5. hapi_session_close =====
    const closeSchema: z.ZodTypeAny = z.object({
        sessionId: z.string().describe('要关闭的 session ID'),
    })

    mcp.registerTool<any, any>('hapi_session_close', {
        title: 'Close Session',
        description: '关闭指定 session。',
        inputSchema: closeSchema,
    }, async (args: { sessionId: string }) => {
        try {
            const result = await api.deleteSession(args.sessionId)
            if (result.ok) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Session ${args.sessionId} 已关闭。`,
                    }],
                }
            }
            return {
                content: [{
                    type: 'text' as const,
                    text: `关闭失败: 操作未成功。`,
                }],
                isError: true,
            }
        } catch (err: any) {
            return {
                content: [{
                    type: 'text' as const,
                    text: `关闭失败: ${err.message || String(err)}`,
                }],
                isError: true,
            }
        }
    })

    toolNames.push(
        'hapi_session_create',
        'hapi_session_send',
        'hapi_session_poll',
        'hapi_session_list',
        'hapi_session_close',
    )

    logger.debug(`[brain] Registered 5 brain tools for session ${brainSessionId}`)
}
