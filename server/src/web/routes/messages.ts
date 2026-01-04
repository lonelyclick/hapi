import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine, Session } from '../../sync/syncEngine'
import type { Store, UserRole } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'
import { buildManualAdvisorPrompt } from '../../agent/advisorPrompt'

/**
 * 解析用户角色
 */
function resolveUserRole(store: Store, email?: string): UserRole {
    if (!email) return 'developer'
    const users = store.getAllowedUsers()
    if (users.length === 0) return 'developer'
    const match = users.find(u => u.email.toLowerCase() === email.toLowerCase())
    return match?.role ?? 'developer'
}

/**
 * 检查是否为 CTO/Advisor 会话
 */
function isCTOSession(session: Session | null): boolean {
    if (!session) return false
    const metadata = session.metadata as Record<string, unknown> | null
    // 检查 claudeAgent 是否为 advisor 或 cto
    const agent = metadata?.claudeAgent as string | undefined
    if (agent === 'advisor' || agent === 'cto') return true
    // 检查 isAdvisor 或 isCTO 标记
    if (metadata?.isAdvisor === true || metadata?.isCTO === true) return true
    // 检查会话名称是否包含 CTO 或 Advisor
    const name = session.metadata?.name?.toLowerCase() || ''
    if (name.includes('cto') || name.includes('advisor')) return true
    return false
}

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
        const namespace = c.get('namespace')

        // 获取会话信息
        const session = engine.getSession(sessionId)

        // 检查是否为 CTO 会话 - 每条消息都注入 CTO 指令
        if (isCTOSession(session)) {
            const workingDir = (session?.metadata as Record<string, unknown>)?.path as string || undefined
            const ctoPrompt = buildManualAdvisorPrompt({ workingDir })
            messageText = `${ctoPrompt}\n${messageText}`
        }
        // 普通会话：检查是否需要注入 Role Prompt（仅对首条用户消息生效）
        else if (store && !store.isRolePromptSent(sessionId)) {
            const email = c.get('email')
            const role = resolveUserRole(store, email)
            const rolePrompt = store.getRolePrompt(role)

            if (rolePrompt?.trim()) {
                // 将 Role Prompt 作为前缀注入
                messageText = `${rolePrompt.trim()}\n\n---\n\n${messageText}`
                // 标记已发送 Role Prompt
                store.setSessionRolePromptSent(sessionId, namespace)
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
