import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    beforeSeq: z.coerce.number().int().min(1).optional()
})

const sendMessageBodySchema = z.object({
    text: z.string().min(1),
    localId: z.string().min(1).optional()
})

const clearMessagesBodySchema = z.object({
    keepCount: z.coerce.number().int().min(0).max(100).optional(),
    compact: z.boolean().optional()
})

export function createMessagesRoutes(getSyncEngine: () => SyncEngine | null, store?: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions/:id/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        const sessionId = sessionResult.sessionId

        const parsed = querySchema.safeParse(c.req.query())
        const limit = parsed.success ? (parsed.data.limit ?? 50) : 50
        const beforeSeq = parsed.success ? (parsed.data.beforeSeq ?? null) : null
        return c.json(engine.getMessagesPage(sessionId, { limit, beforeSeq }))
    })

    app.post('/sessions/:id/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        const sessionId = sessionResult.sessionId

        const body = await c.req.json().catch(() => null)
        const parsed = sendMessageBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        let messageText = parsed.data.text

        // 检查是否需要注入 Role Prompt（仅对首条消息生效）
        if (store) {
            const email = c.get('email')
            if (email) {
                // 检查会话是否已有消息（判断是否为首条消息）
                const messageCount = engine.getMessageCount(sessionId)
                if (messageCount === 0) {
                    // 获取用户角色
                    const user = store.getAllowedUsers().find(u => u.email === email)
                    if (user) {
                        // 获取该角色的 Role Prompt
                        const rolePrompt = store.getRolePrompt(user.role)
                        if (rolePrompt) {
                            // 将 Role Prompt 作为前缀注入
                            messageText = `${rolePrompt}\n\n---\n\n${messageText}`
                        }
                    }
                }
            }
        }

        await engine.sendMessage(sessionId, { text: messageText, localId: parsed.data.localId, sentFrom: 'webapp' })
        return c.json({ ok: true })
    })

    // Get message count for a session
    app.get('/sessions/:id/messages/count', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const count = engine.getMessageCount(sessionResult.sessionId)
        return c.json({ count })
    })

    // Clear messages for a session, keeping the most recent N messages
    // If compact=true and session is active, send /compact command first to preserve context
    app.delete('/sessions/:id/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => ({}))
        const parsed = clearMessagesBodySchema.safeParse(body)
        const keepCount = parsed.success ? (parsed.data.keepCount ?? 30) : 30
        const shouldCompact = parsed.success ? (parsed.data.compact ?? false) : false

        // If compact requested and session is active, send /compact command first
        if (shouldCompact) {
            const session = engine.getSession(sessionResult.sessionId)
            if (session && session.active) {
                await engine.sendMessage(sessionResult.sessionId, {
                    text: '/compact',
                    sentFrom: 'webapp'
                })
                // Give Claude a moment to process the compact command
                // The actual compaction happens asynchronously in the CLI
            }
        }

        const result = engine.clearSessionMessages(sessionResult.sessionId, keepCount)
        return c.json({ ok: true, ...result, compacted: shouldCompact })
    })

    return app
}
