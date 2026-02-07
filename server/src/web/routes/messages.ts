import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { IStore } from '../../store'
import type { BrainStore } from '../../brain/store'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParamWithShareCheck, requireSyncEngine } from './guards'
import { buildRefineSystemPrompt } from '../../brain/brainSdkService'

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

/**
 * Spawn 一个 refine worker 来预处理用户消息
 * 返回 true 表示成功拦截，false 表示 fallback 到直接发送
 */
async function spawnRefineWorker(
    engine: SyncEngine,
    mainSessionId: string,
    brainSessionId: string,
    userMessage: string
): Promise<boolean> {
    try {
        const { spawn } = await import('child_process')
        const { existsSync } = await import('fs')
        const pathMod = await import('path')

        let workerPath: string | null = null
        const serverDir = pathMod.dirname(process.execPath)
        const candidate1 = pathMod.join(serverDir, 'hapi-brain-worker')
        const candidate2 = '/home/guang/softwares/hapi/cli/dist-exe/bun-linux-x64/hapi-brain-worker'
        if (existsSync(candidate1)) workerPath = candidate1
        else if (existsSync(candidate2)) workerPath = candidate2

        if (!workerPath) {
            console.warn('[Messages] Brain worker not found, skipping intercept')
            return false
        }

        const mainSession = engine.getSession(mainSessionId)
        const projectPath = mainSession?.metadata?.path || '/tmp'

        const config = JSON.stringify({
            executionId: `refine-${Date.now()}`,
            brainSessionId,
            mainSessionId,
            prompt: userMessage,
            projectPath,
            model: 'claude-sonnet-4-5-20250929',
            systemPrompt: buildRefineSystemPrompt(),
            serverCallbackUrl: `http://127.0.0.1:${process.env.WEBAPP_PORT || '3006'}`,
            serverToken: process.env.CLI_API_TOKEN || '',
            phase: 'refine',
            refineSentFrom: 'webapp'
        })

        const child = spawn(workerPath, [config], {
            detached: true,
            stdio: 'ignore',
            env: process.env as NodeJS.ProcessEnv
        })
        child.unref()
        console.log('[Messages] Spawned refine worker PID:', child.pid, 'for message intercept')
        return true
    } catch (err) {
        console.error('[Messages] Failed to spawn refine worker:', err)
        return false
    }
}

export function createMessagesRoutes(getSyncEngine: () => SyncEngine | null, store: IStore, brainStore?: BrainStore): Hono<WebAppEnv> {
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

        // 大脑模式：拦截用户消息，让 Brain Worker 先处理再发给主 session
        const activeBrain = brainStore ? await brainStore.getActiveBrainSession(sessionId) : null
        if (activeBrain) {
            console.log(`[Messages] Brain intercept: sessionId=${sessionId} brainId=${activeBrain.id} model=claude-sonnet-4-5-20250929 msgLen=${parsed.data.text.length}`)
            const intercepted = await spawnRefineWorker(engine, sessionId, activeBrain.id, parsed.data.text)
            if (intercepted) {
                console.log(`[Messages] Brain intercept: message intercepted, waiting for refine worker callback`)
                // 先发一条提示，让用户知道 Brain 正在处理
                await engine.sendMessage(sessionId, {
                    text: '🧠 Brain 正在处理你的消息...',
                    sentFrom: 'brain-review'
                })
                return c.json({ ok: true, intercepted: true })
            }
            console.warn(`[Messages] Brain intercept: failed to spawn refine worker, falling back to direct send`)
        }

        await engine.sendMessage(sessionId, { text: parsed.data.text, localId: parsed.data.localId, sentFrom: 'webapp' })
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
