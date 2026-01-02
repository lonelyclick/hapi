import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine, Session } from '../../sync/syncEngine'
import type { SSEManager } from '../../sse/sseManager'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'

type SessionSummaryMetadata = {
    name?: string
    path: string
    machineId?: string
    summary?: { text: string }
    flavor?: string | null
    runtimeModel?: string
    runtimeModelReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
    worktree?: {
        basePath: string
        branch: string
        name: string
        worktreePath?: string
        createdAt?: number
    }
}

type SessionViewer = {
    email: string
    clientId: string
    deviceType?: string
}

type SessionSummary = {
    id: string
    active: boolean
    activeAt: number
    updatedAt: number
    metadata: SessionSummaryMetadata | null
    todoProgress: { completed: number; total: number } | null
    pendingRequestsCount: number
    modelMode?: 'default' | 'sonnet' | 'opus' | 'gpt-5.2-codex' | 'gpt-5.1-codex-max' | 'gpt-5.1-codex-mini' | 'gpt-5.2'
    modelReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
    viewers?: SessionViewer[]
}

function toSessionSummary(session: Session): SessionSummary {
    const pendingRequestsCount = session.agentState?.requests ? Object.keys(session.agentState.requests).length : 0

    const metadata: SessionSummaryMetadata | null = session.metadata ? {
        name: session.metadata.name,
        path: session.metadata.path,
        machineId: session.metadata.machineId ?? undefined,
        summary: session.metadata.summary ? { text: session.metadata.summary.text } : undefined,
        flavor: session.metadata.flavor ?? null,
        runtimeModel: session.metadata.runtimeModel,
        runtimeModelReasoningEffort: session.metadata.runtimeModelReasoningEffort,
        worktree: session.metadata.worktree
    } : null

    const todoProgress = session.todos?.length ? {
        completed: session.todos.filter(t => t.status === 'completed').length,
        total: session.todos.length
    } : null

    return {
        id: session.id,
        active: session.active,
        activeAt: session.activeAt,
        updatedAt: session.updatedAt,
        metadata,
        todoProgress,
        pendingRequestsCount,
        modelMode: session.modelMode,
        modelReasoningEffort: session.modelReasoningEffort
    }
}

const permissionModeSchema = z.object({
    mode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'read-only', 'safe-yolo', 'yolo'])
})

const modelModeSchema = z.object({
    model: z.enum([
        'default',
        'sonnet',
        'opus',
        'gpt-5.2-codex',
        'gpt-5.1-codex-max',
        'gpt-5.1-codex-mini',
        'gpt-5.2'
    ]),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional()
})

export function createSessionsRoutes(
    getSyncEngine: () => SyncEngine | null,
    getSseManager: () => SSEManager | null
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const getPendingCount = (s: Session) => s.agentState?.requests ? Object.keys(s.agentState.requests).length : 0

        const namespace = c.get('namespace')
        const sseManager = getSseManager()
        const sessions = engine.getSessionsByNamespace(namespace)
            .sort((a, b) => {
                // Active sessions first
                if (a.active !== b.active) {
                    return a.active ? -1 : 1
                }
                // Within active sessions, sort by pending requests count
                const aPending = getPendingCount(a)
                const bPending = getPendingCount(b)
                if (a.active && aPending !== bPending) {
                    return bPending - aPending
                }
                // Then by updatedAt
                return b.updatedAt - a.updatedAt
            })
            .map((session) => {
                const summary = toSessionSummary(session)
                // 添加该 session 的查看者
                if (sseManager) {
                    const viewers = sseManager.getSessionViewers(namespace, session.id)
                    if (viewers.length > 0) {
                        summary.viewers = viewers.map(v => ({
                            email: v.email,
                            clientId: v.clientId,
                            deviceType: v.deviceType
                        }))
                    }
                }
                return summary
            })

        return c.json({ sessions })
    })

    app.get('/sessions/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        return c.json({ session: sessionResult.session })
    })

    app.delete('/sessions/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const shouldTerminate = sessionResult.session.active
        try {
            const deleted = await engine.deleteSession(sessionResult.sessionId, { terminateSession: shouldTerminate })
            if (!deleted) {
                return c.json({ error: 'Session not found' }, 404)
            }
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to terminate session'
            return c.json({ error: message }, 409)
        }
    })

    app.post('/sessions/:id/abort', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.abortSession(sessionResult.sessionId)
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/switch', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.switchSession(sessionResult.sessionId, 'remote')
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/permission-mode', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = permissionModeSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        const mode = parsed.data.mode
        const claudeModes = new Set(['default', 'acceptEdits', 'bypassPermissions', 'plan'])
        const codexModes = new Set(['default', 'read-only', 'safe-yolo', 'yolo'])

        if (flavor === 'gemini') {
            return c.json({ error: 'Permission mode not supported for Gemini sessions' }, 400)
        }

        if (flavor === 'codex' ? !codexModes.has(mode) : !claudeModes.has(mode)) {
            return c.json({ error: 'Invalid permission mode for session flavor' }, 400)
        }

        try {
            await engine.applySessionConfig(sessionResult.sessionId, { permissionMode: mode })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply permission mode'
            return c.json({ error: message }, 409)
        }
    })

    app.post('/sessions/:id/model', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = modelModeSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (flavor === 'gemini') {
            return c.json({ error: 'Model mode is not supported for Gemini sessions' }, 400)
        }

        const claudeModels = new Set(['default', 'sonnet', 'opus'])
        const codexModels = new Set(['gpt-5.2-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5.2'])
        const reasoningLevels = new Set(['low', 'medium', 'high', 'xhigh'])

        if (flavor === 'claude' && !claudeModels.has(parsed.data.model)) {
            return c.json({ error: 'Invalid model for Claude sessions' }, 400)
        }
        if (flavor === 'codex' && parsed.data.model !== 'default' && !codexModels.has(parsed.data.model)) {
            return c.json({ error: 'Invalid model for Codex sessions' }, 400)
        }
        if (parsed.data.reasoningEffort && !reasoningLevels.has(parsed.data.reasoningEffort)) {
            return c.json({ error: 'Invalid reasoning level' }, 400)
        }

        try {
            console.log('[session model] apply', {
                sessionId: sessionResult.sessionId,
                flavor,
                model: parsed.data.model,
                reasoningEffort: parsed.data.reasoningEffort ?? null
            })
            const applied = await engine.applySessionConfig(sessionResult.sessionId, {
                modelMode: parsed.data.model,
                modelReasoningEffort: parsed.data.reasoningEffort
            })
            console.log('[session model] applied', {
                sessionId: sessionResult.sessionId,
                applied
            })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply model mode'
            return c.json({ error: message }, 409)
        }
    })

    app.get('/sessions/:id/slash-commands', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        // Session must exist but doesn't need to be active
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        // Get agent type from session metadata, default to 'claude'
        const agent = sessionResult.session.metadata?.flavor ?? 'claude'

        try {
            const result = await engine.listSlashCommands(sessionResult.sessionId, agent)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list slash commands'
            })
        }
    })

    // 获取在线用户
    app.get('/online-users', (c) => {
        const sseManager = getSseManager()
        if (!sseManager) {
            return c.json({ users: [] })
        }

        const namespace = c.get('namespace')
        const users = sseManager.getOnlineUsers(namespace)
        return c.json({ users })
    })

    return app
}
