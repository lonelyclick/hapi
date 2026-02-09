import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { IStore } from '../../store'
import type { BrainStore } from '../../brain/store'
import type { SSEManager } from '../../sse/sseManager'
import { buildRefinePrompt } from '../../brain/statePrompts'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParamWithShareCheck, requireSyncEngine } from './guards'

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    beforeSeq: z.coerce.number().int().min(1).optional()
})

const sendMessageBodySchema = z.object({
    text: z.string().min(1),
    localId: z.string().min(1).optional(),
    sentFrom: z.string().optional()
})

const clearMessagesBodySchema = z.object({
    keepCount: z.coerce.number().int().min(0).max(100).optional(),
    compact: z.boolean().optional()
})

// 跟踪正在 refine 的主 session（用于页面刷新后恢复状态）
export const refiningSessions = new Set<string>()

// 暂存被拦截的用户消息，供 Brain MCP 工具 brain_user_intent 取用
// key: mainSessionId, value: { text, timestamp }
export const pendingUserMessages = new Map<string, { text: string; timestamp: number }>()

export function createMessagesRoutes(getSyncEngine: () => SyncEngine | null, store: IStore, brainStore?: BrainStore, getSseManager?: () => SSEManager | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions/:id/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = await requireSessionFromParamWithShareCheck(c, engine, store)
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        const sessionId = sessionResult.sessionId

        const parsed = querySchema.safeParse(c.req.query())
        const limit = parsed.success ? (parsed.data.limit ?? 200) : 200
        const beforeSeq = parsed.success ? (parsed.data.beforeSeq ?? null) : null
        return c.json(await engine.getMessagesPage(sessionId, { limit, beforeSeq }))
    })

    app.post('/sessions/:id/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = await requireSessionFromParamWithShareCheck(c, engine, store, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        const sessionId = sessionResult.sessionId

        const body = await c.req.json().catch(() => null)
        const parsed = sendMessageBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const sentFrom = parsed.data.sentFrom || 'webapp'

        // 大脑模式：拦截用户消息，暂存后通知 Brain session 分析意图
        // 跳过来自 brain 的消息，避免循环拦截
        const activeBrain = (sentFrom !== 'brain-sdk-review' && sentFrom !== 'brain-sdk-info') && brainStore ? await brainStore.getActiveBrainSession(sessionId) : null
        if (activeBrain && activeBrain.brainSessionId) {
            console.log(`[Messages] Brain intercept: sessionId=${sessionId} brainId=${activeBrain.id} brainDisplayId=${activeBrain.brainSessionId} msgLen=${parsed.data.text.length}`)

            // 暂存用户消息，供 brain_user_intent MCP 工具取用
            pendingUserMessages.set(sessionId, { text: parsed.data.text, timestamp: Date.now() })
            refiningSessions.add(sessionId)

            // 发通知给 Brain session（使用状态驱动的 refine prompt）
            try {
                const refinePrompt = buildRefinePrompt(activeBrain.currentState)
                await engine.sendMessage(activeBrain.brainSessionId, {
                    text: refinePrompt,
                    sentFrom: 'webapp'
                })
                console.log(`[Messages] Brain intercept: notification sent to brain session ${activeBrain.brainSessionId}`)
            } catch (err) {
                console.error(`[Messages] Brain intercept: failed to notify brain session, falling back to direct send`, err)
                pendingUserMessages.delete(sessionId)
                refiningSessions.delete(sessionId)
                // fallback: 直接发给主 session
                await engine.sendMessage(sessionId, { text: parsed.data.text, localId: parsed.data.localId, sentFrom: sentFrom as 'webapp' | 'telegram-bot' | 'brain-review' | 'brain-sdk-review' | 'brain-sdk-info' })
                return c.json({ ok: true })
            }

            // SSE 广播 refine-started
            const sseManager = getSseManager?.()
            if (sseManager) {
                const session = engine.getSession(sessionId)
                sseManager.broadcast({
                    type: 'brain-sdk-progress',
                    namespace: session?.namespace,
                    sessionId,
                    data: {
                        brainSessionId: activeBrain.id,
                        progressType: 'refine-started',
                        data: {}
                    }
                } as unknown as import('../../sync/syncEngine.js').SyncEvent)
            }
            return c.json({ ok: true, intercepted: true })
        }

        await engine.sendMessage(sessionId, { text: parsed.data.text, localId: parsed.data.localId, sentFrom: sentFrom as 'webapp' | 'telegram-bot' | 'brain-review' | 'brain-sdk-review' | 'brain-sdk-info' })
        return c.json({ ok: true })
    })

    // Get message count for a session
    app.get('/sessions/:id/messages/count', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = await requireSessionFromParamWithShareCheck(c, engine, store)
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

        const sessionResult = await requireSessionFromParamWithShareCheck(c, engine, store)
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
