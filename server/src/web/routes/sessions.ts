import { Hono } from 'hono'
import { z } from 'zod'
import type { DecryptedMessage, Session, SyncEngine } from '../../sync/syncEngine'
import type { SSEManager } from '../../sse/sseManager'
import type { Store, UserRole } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'
import { buildInitPrompt } from '../prompts/initPrompt'

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

const RESUME_TIMEOUT_MS = 60_000
const RESUME_CONTEXT_MAX_LINES = 20
const RESUME_CONTEXT_MAX_CHARS = 16_000

function resolveUserRole(store: Store, email?: string): UserRole {
    if (!email) return 'developer'
    const users = store.getAllowedUsers()
    if (users.length === 0) return 'developer'
    const match = users.find(u => u.email.toLowerCase() === email.toLowerCase())
    return match?.role ?? 'developer'
}

async function waitForSessionOnline(engine: SyncEngine, sessionId: string, timeoutMs: number): Promise<boolean> {
    const existing = engine.getSession(sessionId)
    if (existing?.active) {
        return true
    }

    return await new Promise((resolve) => {
        let resolved = false
        let unsubscribe = () => {}

        const finalize = (result: boolean) => {
            if (resolved) return
            resolved = true
            clearTimeout(timer)
            unsubscribe()
            resolve(result)
        }

        const timer = setTimeout(() => finalize(false), timeoutMs)

        unsubscribe = engine.subscribe((event) => {
            if (event.sessionId !== sessionId) {
                return
            }
            if (event.type !== 'session-added' && event.type !== 'session-updated') {
                return
            }
            const session = engine.getSession(sessionId)
            if (session?.active) {
                finalize(true)
            }
        })

        const current = engine.getSession(sessionId)
        if (current?.active) {
            finalize(true)
        }
    })
}

async function sendInitPrompt(engine: SyncEngine, sessionId: string, role: UserRole): Promise<void> {
    try {
        const session = engine.getSession(sessionId)
        const projectRoot = session?.metadata?.path?.trim()
            || session?.metadata?.worktree?.basePath?.trim()
            || null
        const prompt = await buildInitPrompt(role, { projectRoot })
        if (!prompt.trim()) {
            return
        }
        await engine.sendMessage(sessionId, {
            text: prompt,
            sentFrom: 'webapp'
        })
    } catch {
        // Ignore failures.
    }
}

async function resolveSpawnTarget(
    engine: SyncEngine,
    machineId: string,
    session: Session
): Promise<{ ok: true; directory: string; sessionType?: 'simple' | 'worktree'; worktreeName?: string } | { ok: false; error: string }> {
    const metadata = session.metadata
    if (!metadata) {
        return { ok: false, error: 'Session metadata missing' }
    }

    const worktree = metadata.worktree
    const worktreePath = worktree?.worktreePath?.trim()
    if (worktreePath) {
        try {
            const exists = await engine.checkPathsExist(machineId, [worktreePath])
            if (exists[worktreePath]) {
                return { ok: true, directory: worktreePath, sessionType: 'simple' }
            }
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : 'Failed to check worktree path' }
        }
    }

    const worktreeBase = worktree?.basePath?.trim()
    if (worktreeBase) {
        try {
            const exists = await engine.checkPathsExist(machineId, [worktreeBase])
            if (!exists[worktreeBase]) {
                return { ok: false, error: `Worktree base path not found: ${worktreeBase}` }
            }
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : 'Failed to check worktree base path' }
        }
        return { ok: true, directory: worktreeBase, sessionType: 'worktree', worktreeName: worktree?.name }
    }

    const sessionPath = metadata.path?.trim()
    if (!sessionPath) {
        return { ok: false, error: 'Session path missing' }
    }

    try {
        const exists = await engine.checkPathsExist(machineId, [sessionPath])
        if (!exists[sessionPath]) {
            return { ok: false, error: `Session path not found: ${sessionPath}` }
        }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to check session path' }
    }

    return { ok: true, directory: sessionPath, sessionType: 'simple' }
}

function extractUserText(content: unknown): string | null {
    if (!content || typeof content !== 'object') {
        return null
    }
    const record = content as Record<string, unknown>
    if (record.role !== 'user') {
        return null
    }
    const body = record.content as Record<string, unknown> | string | undefined
    if (!body) {
        return null
    }
    if (typeof body === 'string') {
        return body.trim() || null
    }
    if (typeof body === 'object' && body.type === 'text' && typeof body.text === 'string') {
        return body.text.trim() || null
    }
    return null
}

function extractAgentText(content: unknown): string | null {
    if (!content || typeof content !== 'object') {
        return null
    }
    const record = content as Record<string, unknown>
    if (record.role !== 'agent') {
        return null
    }
    const payload = record.content as Record<string, unknown> | undefined
    const data = payload?.data
    if (!data || (typeof data !== 'object' && typeof data !== 'string')) {
        return null
    }
    if (typeof data === 'string') {
        return data.trim() || null
    }
    const dataRecord = data as Record<string, unknown>
    if (typeof dataRecord.message === 'string') {
        return dataRecord.message.trim() || null
    }
    if (dataRecord.type === 'message' && typeof dataRecord.message === 'string') {
        return dataRecord.message.trim() || null
    }
    if (dataRecord.type === 'assistant' && typeof dataRecord.message === 'object') {
        const message = dataRecord.message as Record<string, unknown>
        const contentValue = message.content
        if (typeof contentValue === 'string') {
            return contentValue.trim() || null
        }
        if (Array.isArray(contentValue)) {
            const texts = contentValue
                .map((item) => {
                    if (!item || typeof item !== 'object') return null
                    const itemRecord = item as Record<string, unknown>
                    if (itemRecord.type === 'text' && typeof itemRecord.text === 'string') {
                        return itemRecord.text.trim()
                    }
                    return null
                })
                .filter((text): text is string => Boolean(text))
            if (texts.length > 0) {
                return texts.join('\n')
            }
        }
    }
    return null
}

function buildResumeContextMessage(session: Session, messages: DecryptedMessage[]): string | null {
    const summary = session.metadata?.summary?.text?.trim()
    const lines: string[] = [
        '#InitPrompt-ResumeContext',
        '以下是从旧会话自动迁移的上下文（可能不完整）：'
    ]
    if (summary) {
        lines.push(`摘要：${summary}`)
    }

    const dialogLines: string[] = []
    for (const message of messages) {
        const userText = extractUserText(message.content)
        if (userText) {
            dialogLines.push(`用户：${userText}`)
            continue
        }
        const agentText = extractAgentText(message.content)
        if (agentText) {
            dialogLines.push(`助手：${agentText}`)
        }
    }

    if (dialogLines.length > RESUME_CONTEXT_MAX_LINES) {
        dialogLines.splice(0, dialogLines.length - RESUME_CONTEXT_MAX_LINES)
    }

    if (dialogLines.length > 0) {
        lines.push('最近对话片段：')
        lines.push(...dialogLines)
    }

    if (lines.length <= 2) {
        return null
    }

    const content = lines.join('\n')
    if (content.length <= RESUME_CONTEXT_MAX_CHARS) {
        return content
    }
    return `${content.slice(0, RESUME_CONTEXT_MAX_CHARS)}...`
}

export function createSessionsRoutes(
    getSyncEngine: () => SyncEngine | null,
    getSseManager: () => SSEManager | null,
    store: Store
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
        const forceParam = c.req.query('force')
        const force = forceParam === '1' || forceParam === 'true'
        try {
            const deleted = await engine.deleteSession(sessionResult.sessionId, { terminateSession: shouldTerminate, force })
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

    app.post('/sessions/:id/resume', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionId = sessionResult.sessionId
        const session = sessionResult.session

        if (session.active) {
            return c.json({ type: 'already-active', sessionId })
        }

        const flavor = session.metadata?.flavor ?? 'claude'
        if (flavor !== 'claude' && flavor !== 'codex') {
            return c.json({ error: 'Resume not supported for this session flavor' }, 400)
        }

        const machineId = session.metadata?.machineId?.trim()
        if (!machineId) {
            return c.json({ error: 'Session machine not found' }, 409)
        }

        const machine = engine.getMachineByNamespace(machineId, c.get('namespace'))
        if (!machine || !machine.active) {
            return c.json({ error: 'Machine is offline' }, 409)
        }

        const spawnTarget = await resolveSpawnTarget(engine, machineId, session)
        if (!spawnTarget.ok) {
            return c.json({ error: spawnTarget.error }, 409)
        }

        const resumeAttempt = await engine.spawnSession(
            machineId,
            spawnTarget.directory,
            flavor,
            undefined,
            spawnTarget.sessionType,
            spawnTarget.worktreeName,
            { sessionId }
        )

        if (resumeAttempt.type === 'success') {
            const online = await waitForSessionOnline(engine, sessionId, RESUME_TIMEOUT_MS)
            if (online) {
                return c.json({ type: 'resumed', sessionId })
            }
        }

        const resumeSessionId = (() => {
            const value = flavor === 'claude'
                ? session.metadata?.claudeSessionId
                : session.metadata?.codexSessionId
            return typeof value === 'string' && value.trim() ? value : undefined
        })()

        const fallbackResult = await engine.spawnSession(
            machineId,
            spawnTarget.directory,
            flavor,
            undefined,
            spawnTarget.sessionType,
            spawnTarget.worktreeName,
            { resumeSessionId }
        )

        if (fallbackResult.type !== 'success') {
            return c.json({ error: fallbackResult.message }, 409)
        }

        const newSessionId = fallbackResult.sessionId
        const online = await waitForSessionOnline(engine, newSessionId, RESUME_TIMEOUT_MS)
        if (!online) {
            return c.json({ error: 'Session resume timed out' }, 409)
        }

        const role = resolveUserRole(store, c.get('email'))
        await sendInitPrompt(engine, newSessionId, role)

        if (!resumeSessionId) {
            const page = engine.getMessagesPage(sessionId, { limit: RESUME_CONTEXT_MAX_LINES * 2, beforeSeq: null })
            const contextMessage = buildResumeContextMessage(session, page.messages)
            if (contextMessage) {
                await engine.sendMessage(newSessionId, { text: contextMessage, sentFrom: 'webapp' })
            }
        }

        return c.json({
            type: 'created',
            sessionId: newSessionId,
            resumedFrom: sessionId,
            usedResume: Boolean(resumeSessionId)
        })
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
