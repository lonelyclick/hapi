import { z } from 'zod'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'
import { Hono } from 'hono'

// OpenCode 特有配置schema
const openCodeConfigSchema = z.object({
    model: z.string().min(1),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional()
})

const openCodeStatusUpdateSchema = z.object({
    initialized: z.boolean(),
    sessionActive: z.boolean(),
    lastActivity: z.number().optional(),
    errorCount: z.number().optional()
})

const openCodeCapabilitiesSchema = z.object({
    fs: z.boolean(),
    terminal: z.boolean(),
    mcp: z.boolean(),
    tools: z.array(z.string())
})

export function createOpenCodeRoutes(
    getSyncEngine: () => any,
    getSseManager: () => any
) {
    const app = new Hono<WebAppEnv>()

    // 获取 OpenCode session 配置
    app.get('/sessions/:id/opencode/config', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult

        const session = sessionResult.session
        if (session.metadata?.flavor !== 'opencode') {
            return c.json({ error: 'Not an OpenCode session' }, 400)
        }

        const config = {
            model: session.metadata?.runtimeModel || 'anthropic/claude-sonnet-4-20250514',
            reasoningEffort: session.metadata?.runtimeModelReasoningEffort,
            capabilities: session.metadata?.opencodeCapabilities || {
                fs: false,
                terminal: false,
                mcp: false,
                tools: []
            },
            status: session.metadata?.opencodeStatus || {
                initialized: false,
                sessionActive: false,
                errorCount: 0
            }
        }

        return c.json({ config })
    })

    // 更新 OpenCode 模型配置
    app.post('/sessions/:id/opencode/config', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult

        const session = sessionResult.session
        if (session.metadata?.flavor !== 'opencode') {
            return c.json({ error: 'Not an OpenCode session' }, 400)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = openCodeConfigSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid config', details: parsed.error.issues }, 400)
        }

        try {
            // 更新 session metadata 中的 OpenCode 配置
            const updatedMetadata = {
                ...session.metadata,
                runtimeModel: parsed.data.model,
                runtimeModelReasoningEffort: parsed.data.reasoningEffort
            }

            await engine.updateSessionMetadata(sessionResult.sessionId, updatedMetadata, session.metadataVersion)
            
            return c.json({ 
                success: true, 
                config: {
                    model: parsed.data.model,
                    reasoningEffort: parsed.data.reasoningEffort
                }
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update OpenCode config'
            return c.json({ error: message }, 500)
        }
    })

    // 更新 OpenCode 状态
    app.post('/sessions/:id/opencode/status', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult

        const session = sessionResult.session
        if (session.metadata?.flavor !== 'opencode') {
            return c.json({ error: 'Not an OpenCode session' }, 400)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = openCodeStatusUpdateSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid status update', details: parsed.error.issues }, 400)
        }

        try {
            // 更新 session metadata 中的 OpenCode 状态
            const currentStatus = session.metadata?.opencodeStatus || {}
            const updatedStatus = {
                ...currentStatus,
                ...parsed.data,
                lastActivity: parsed.data.lastActivity || Date.now()
            }

            const updatedMetadata = {
                ...session.metadata,
                opencodeStatus: updatedStatus
            }

            await engine.updateSessionMetadata(sessionResult.sessionId, updatedMetadata, session.metadataVersion)
            
            return c.json({ 
                success: true, 
                status: updatedStatus 
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update OpenCode status'
            return c.json({ error: message }, 500)
        }
    })

    // 更新 OpenCode 能力
    app.post('/sessions/:id/opencode/capabilities', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult

        const session = sessionResult.session
        if (session.metadata?.flavor !== 'opencode') {
            return c.json({ error: 'Not an OpenCode session' }, 400)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = openCodeCapabilitiesSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid capabilities', details: parsed.error.issues }, 400)
        }

        try {
            // 更新 session metadata 中的 OpenCode 能力
            const updatedMetadata = {
                ...session.metadata,
                opencodeCapabilities: parsed.data
            }

            await engine.updateSessionMetadata(sessionResult.sessionId, updatedMetadata, session.metadataVersion)
            
            return c.json({ 
                success: true, 
                capabilities: parsed.data 
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update OpenCode capabilities'
            return c.json({ error: message }, 500)
        }
    })

    // 获取 OpenCode session 统计信息
    app.get('/sessions/:id/opencode/stats', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult

        const session = sessionResult.session
        if (session.metadata?.flavor !== 'opencode') {
            return c.json({ error: 'Not an OpenCode session' }, 400)
        }

        try {
            // 获取消息统计
            const messages = await engine.getMessages(sessionResult.sessionId, 1000)
            const messageCount = messages.length
            
            // 获取错误统计（从 agent state 中）
            const errorCount = session.agentState?.completedRequests 
                ? Object.values(session.agentState.completedRequests).filter(req => req.status === 'denied' || req.status === 'canceled').length
                : 0

            // 计算活跃时长
            const activeDuration = session.activeAt && session.active 
                ? Date.now() - session.activeAt 
                : 0

            const stats = {
                sessionId: sessionResult.sessionId,
                messageCount,
                errorCount,
                activeDuration,
                currentModel: session.metadata?.runtimeModel,
                currentReasoningEffort: session.metadata?.runtimeModelReasoningEffort,
                capabilities: session.metadata?.opencodeCapabilities || {
                    fs: false,
                    terminal: false,
                    mcp: false,
                    tools: []
                },
                status: session.metadata?.opencodeStatus || {
                    initialized: false,
                    sessionActive: false,
                    errorCount: 0
                },
                uptime: session.activeAt && session.active ? Date.now() - session.createdAt : 0
            }

            return c.json({ stats })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to get OpenCode stats'
            return c.json({ error: message }, 500)
        }
    })

    return app
}