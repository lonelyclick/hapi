import { Hono } from 'hono'
import { z } from 'zod'
import type { DecryptedMessage, Session, SyncEngine } from '../../sync/syncEngine'
import type { SSEManager } from '../../sse/sseManager'
import type { IStore, UserRole, StoredSession } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine, requireSessionFromParam, requireSyncEngine } from './guards'
import { buildInitPrompt } from '../prompts/initPrompt'

type SessionSummaryMetadata = {
    name?: string
    path: string
    machineId?: string
    source?: string
    summary?: { text: string }
    flavor?: string | null
    runtimeAgent?: string
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
    createdBy?: string
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
        source: session.metadata.source,
        summary: session.metadata.summary ? { text: session.metadata.summary.text } : undefined,
        flavor: session.metadata.flavor ?? null,
        runtimeAgent: session.metadata.runtimeAgent,
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
        createdBy: session.createdBy,
        metadata,
        todoProgress,
        pendingRequestsCount,
        modelMode: session.modelMode,
        modelReasoningEffort: session.modelReasoningEffort
    }
}

// Convert StoredSession (from database) to SessionSummary
function storedSessionToSummary(stored: StoredSession): SessionSummary {
    const meta = stored.metadata as SessionSummaryMetadata | null
    const todos = stored.todos as Array<{ status: string }> | null

    const todoProgress = todos?.length ? {
        completed: todos.filter(t => t.status === 'completed').length,
        total: todos.length
    } : null

    return {
        id: stored.id,
        active: stored.active,
        activeAt: stored.activeAt ?? stored.updatedAt,
        updatedAt: stored.updatedAt,
        createdBy: stored.createdBy ?? undefined,
        metadata: meta,
        todoProgress,
        pendingRequestsCount: 0  // Offline sessions have no pending requests
    }
}

const permissionModeValues = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'read-only', 'safe-yolo', 'yolo'] as const
const modelModeValues = ['default', 'sonnet', 'opus', 'gpt-5.2-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5.2'] as const
const reasoningEffortValues = ['low', 'medium', 'high', 'xhigh'] as const

const permissionModeSchema = z.object({
    mode: z.enum(permissionModeValues)
})

const modelModeSchema = z.object({
    model: z.enum(modelModeValues),
    reasoningEffort: z.enum(reasoningEffortValues).optional()
})

const createSessionSchema = z.object({
    machineId: z.string().min(1),
    directory: z.string().min(1),
    agent: z.enum(['claude', 'codex', 'gemini', 'glm', 'minimax', 'grok', 'openrouter', 'aider-cli']).optional(),
    yolo: z.boolean().optional(),
    sessionType: z.enum(['simple', 'worktree']).optional(),
    worktreeName: z.string().optional(),
    claudeAgent: z.string().min(1).optional(),
    openrouterModel: z.string().min(1).optional(),
    permissionMode: z.enum(permissionModeValues).optional(),
    modelMode: z.enum(modelModeValues).optional(),
    modelReasoningEffort: z.enum(reasoningEffortValues).optional(),
    source: z.string().min(1).max(100).optional()
})

const RESUME_TIMEOUT_MS = 60_000
const RESUME_CONTEXT_MAX_LINES = 20
const RESUME_CONTEXT_MAX_CHARS = 16_000

function resolveUserRole(store: IStore, email?: string): UserRole {
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

async function sendInitPromptAfterOnline(engine: SyncEngine, sessionId: string, role: UserRole): Promise<void> {
    const isOnline = await waitForSessionOnline(engine, sessionId, 60_000)
    if (!isOnline) {
        return
    }
    await sendInitPrompt(engine, sessionId, role)
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
    store: IStore
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.post('/sessions', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = createSessionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', details: parsed.error.issues }, 400)
        }

        const machine = requireMachine(c, engine, parsed.data.machineId)
        if (machine instanceof Response) {
            return machine
        }

        const rawSource = parsed.data.source?.trim()
        const source = rawSource ? rawSource : 'external-api'

        const result = await engine.spawnSession(
            parsed.data.machineId,
            parsed.data.directory,
            parsed.data.agent,
            parsed.data.yolo,
            parsed.data.sessionType,
            parsed.data.worktreeName,
            {
                claudeAgent: parsed.data.claudeAgent,
                openrouterModel: parsed.data.openrouterModel,
                permissionMode: parsed.data.permissionMode,
                modelMode: parsed.data.modelMode,
                modelReasoningEffort: parsed.data.modelReasoningEffort,
                source
            }
        )

        if (result.type === 'success') {
            const email = c.get('email')
            const namespace = c.get('namespace')
            const role = resolveUserRole(store, email)
            // Wait for session to be online, then set createdBy and send init prompt
            void (async () => {
                const isOnline = await waitForSessionOnline(engine, result.sessionId, 60_000)
                if (!isOnline) return
                // Set createdBy after session is confirmed online (exists in DB)
                if (email) {
                    await store.setSessionCreatedBy(result.sessionId, email, namespace)
                }
                await sendInitPrompt(engine, result.sessionId, role)
            })()
        }

        return c.json(result)
    })

    app.get('/sessions', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const getPendingCount = (s: Session) => s.agentState?.requests ? Object.keys(s.agentState.requests).length : 0

        const namespace = c.get('namespace')
        const sseManager = getSseManager()

        // Get sessions from memory (SyncEngine) - these have live active status
        const memorySessions = engine.getSessionsByNamespace(namespace)
        const memorySessionMap = new Map(memorySessions.map(s => [s.id, s]))

        // Get all sessions from database (for offline sessions not in memory)
        const storedSessions = await store.getSessionsByNamespace(namespace)
        const storedSessionIds = new Set(storedSessions.map(s => s.id))

        // Build session summaries:
        // 1. For sessions in memory: use memory state (has live active status)
        // 2. For sessions only in database: use database state (offline sessions)

        const sessionSummaries: SessionSummary[] = []

        // Add sessions from memory (with live data)
        for (const memorySession of memorySessions) {
            const summary = toSessionSummary(memorySession)

            // Add viewers info
            if (sseManager) {
                const viewers = sseManager.getSessionViewers(namespace, memorySession.id)
                if (viewers.length > 0) {
                    summary.viewers = viewers.map(v => ({
                        email: v.email,
                        clientId: v.clientId,
                        deviceType: v.deviceType
                    }))
                }
            }

            sessionSummaries.push(summary)
        }

        // Add sessions from database that are not in memory (offline sessions)
        for (const stored of storedSessions) {
            if (!memorySessionMap.has(stored.id)) {
                sessionSummaries.push(storedSessionToSummary(stored))
            }
        }

        // Sort: active first, then by pending requests, then by updatedAt
        const allSessions = sessionSummaries.sort((a, b) => {
            // Active sessions first
            if (a.active !== b.active) {
                return a.active ? -1 : 1
            }
            // Within active sessions, sort by pending requests count
            if (a.active && a.pendingRequestsCount !== b.pendingRequestsCount) {
                return b.pendingRequestsCount - a.pendingRequestsCount
            }
            // Then by updatedAt
            return b.updatedAt - a.updatedAt
        })

        const activeCount = allSessions.filter(s => s.active).length
        console.log(`[sessions] memory=${memorySessions.length}, stored=${storedSessions.length}, fromDB=${storedSessions.filter(s => !memorySessionMap.has(s.id)).length}, active=${activeCount}`)

        return c.json({ sessions: allSessions })
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

        // Preserve mode settings from original session
        const modeSettings = {
            permissionMode: session.permissionMode,
            modelMode: session.modelMode,
            modelReasoningEffort: session.modelReasoningEffort,
            claudeAgent: flavor === 'claude' ? (session.metadata?.runtimeAgent ?? undefined) : undefined
        }

        const resumeAttempt = await engine.spawnSession(
            machineId,
            spawnTarget.directory,
            flavor,
            undefined,
            spawnTarget.sessionType,
            spawnTarget.worktreeName,
            { sessionId, ...modeSettings }
        )

        if (resumeAttempt.type === 'success') {
            const online = await waitForSessionOnline(engine, sessionId, RESUME_TIMEOUT_MS)
            if (online) {
                // Set createdBy after session is confirmed online (exists in DB)
                const email = c.get('email')
                if (email) {
                    const namespace = c.get('namespace')
                    void store.setSessionCreatedBy(sessionId, email, namespace)
                }
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
            { resumeSessionId, ...modeSettings }
        )

        if (fallbackResult.type !== 'success') {
            return c.json({ error: fallbackResult.message }, 409)
        }

        const newSessionId = fallbackResult.sessionId

        const online = await waitForSessionOnline(engine, newSessionId, RESUME_TIMEOUT_MS)
        if (!online) {
            return c.json({ error: 'Session resume timed out' }, 409)
        }

        // Set createdBy after session is confirmed online (exists in DB)
        const email = c.get('email')
        if (email) {
            const namespace = c.get('namespace')
            void store.setSessionCreatedBy(newSessionId, email, namespace)
        }

        const role = resolveUserRole(store, email)
        await sendInitPrompt(engine, newSessionId, role)

        if (!resumeSessionId) {
            const page = await engine.getMessagesPage(sessionId, { limit: RESUME_CONTEXT_MAX_LINES * 2, beforeSeq: null })
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

    // 刷新账号：将旧 session 迁移到当前活跃账号，保留对话上下文
    app.post('/sessions/:id/refresh-account', async (c) => {
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

        const flavor = session.metadata?.flavor ?? 'claude'
        if (flavor !== 'claude') {
            return c.json({ error: 'Refresh account only supported for Claude sessions' }, 400)
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

        // Preserve mode settings from original session
        const modeSettings = {
            permissionMode: session.permissionMode,
            modelMode: session.modelMode,
            modelReasoningEffort: session.modelReasoningEffort,
            claudeAgent: session.metadata?.runtimeAgent ?? undefined
        }

        // Spawn new session with current active account
        const spawnResult = await engine.spawnSession(
            machineId,
            spawnTarget.directory,
            flavor,
            undefined,
            spawnTarget.sessionType,
            spawnTarget.worktreeName,
            modeSettings
        )

        if (spawnResult.type !== 'success') {
            return c.json({ error: spawnResult.message }, 409)
        }

        const newSessionId = spawnResult.sessionId

        const online = await waitForSessionOnline(engine, newSessionId, RESUME_TIMEOUT_MS)
        if (!online) {
            return c.json({ error: 'New session failed to come online' }, 409)
        }

        // Set createdBy after session is confirmed online (exists in DB)
        const email = c.get('email')
        if (email) {
            const namespace = c.get('namespace')
            void store.setSessionCreatedBy(newSessionId, email, namespace)
        }

        // Send init prompt
        const role = resolveUserRole(store, email)
        await sendInitPrompt(engine, newSessionId, role)

        // Transfer context from old session
        const page = await engine.getMessagesPage(sessionId, { limit: RESUME_CONTEXT_MAX_LINES * 2, beforeSeq: null })
        const contextMessage = buildResumeContextMessage(session, page.messages)
        if (contextMessage) {
            await engine.sendMessage(newSessionId, { text: contextMessage, sentFrom: 'webapp' })
        }

        return c.json({
            type: 'success',
            newSessionId,
            oldSessionId: sessionId
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
        const grokModels = new Set(['grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning', 'grok-code-fast-1', 'grok-4-fast-reasoning', 'grok-4-fast-non-reasoning', 'grok-4-0709', 'grok-3-mini', 'grok-3'])
        const reasoningLevels = new Set(['low', 'medium', 'high', 'xhigh'])

        if (flavor === 'claude' && !claudeModels.has(parsed.data.model)) {
            return c.json({ error: 'Invalid model for Claude sessions' }, 400)
        }
        if (flavor === 'codex' && parsed.data.model !== 'default' && !codexModels.has(parsed.data.model)) {
            return c.json({ error: 'Invalid model for Codex sessions' }, 400)
        }
        if (flavor === 'grok' && parsed.data.model !== 'default' && !grokModels.has(parsed.data.model)) {
            return c.json({ error: 'Invalid model for Grok sessions' }, 400)
        }
        // OpenRouter accepts any model string (provider/model format)
        if (flavor === 'openrouter' && !parsed.data.model.includes('/')) {
            return c.json({ error: 'Invalid model for OpenRouter sessions (expected format: provider/model)' }, 400)
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

    // 广播用户输入状态
    app.post('/sessions/:id/typing', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        if (!body || typeof body.text !== 'string') {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const email = c.get('email') ?? 'anonymous'
        const clientId = c.get('clientId') ?? 'unknown'
        const namespace = c.get('namespace')

        // 广播 typing 事件给同一 session 的其他用户
        engine.emit({
            type: 'typing-changed',
            namespace,
            sessionId: sessionResult.sessionId,
            typing: {
                email,
                clientId,
                text: body.text,
                updatedAt: Date.now()
            }
        })

        return c.json({ ok: true })
    })

    // ==================== Session Notification Subscriptions ====================

    /**
     * 订阅 session 通知
     * POST /sessions/:id/subscribe
     * Body: { chatId?: string, clientId?: string }
     * 至少需要提供 chatId 或 clientId 其中之一
     */
    app.post('/sessions/:id/subscribe', async (c) => {
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const body = await c.req.json().catch(() => null)

        if (!body) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const chatId = typeof body.chatId === 'string' ? body.chatId : null
        const clientId = typeof body.clientId === 'string' ? body.clientId : null

        if (!chatId && !clientId) {
            return c.json({ error: 'Either chatId or clientId is required' }, 400)
        }

        let subscription
        if (chatId) {
            subscription = store.subscribeToSessionNotifications(sessionId, chatId, namespace)
        } else if (clientId) {
            subscription = store.subscribeToSessionNotificationsByClientId(sessionId, clientId, namespace)
        }

        if (!subscription) {
            return c.json({ error: 'Failed to subscribe' }, 500)
        }

        return c.json({ ok: true, subscription })
    })

    /**
     * 取消订阅 session 通知
     * DELETE /sessions/:id/subscribe
     * Body: { chatId?: string, clientId?: string }
     */
    app.delete('/sessions/:id/subscribe', async (c) => {
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const body = await c.req.json().catch(() => null)

        if (!body) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const chatId = typeof body.chatId === 'string' ? body.chatId : null
        const clientId = typeof body.clientId === 'string' ? body.clientId : null

        if (!chatId && !clientId) {
            return c.json({ error: 'Either chatId or clientId is required' }, 400)
        }

        let success = false
        if (chatId) {
            // First try to remove from subscriptions table
            success = store.unsubscribeFromSessionNotifications(sessionId, chatId)
            // Also check if this chatId is the creator and clear it
            const creatorChatId = store.getSessionCreatorChatId(sessionId)
            if (creatorChatId === chatId) {
                const cleared = store.clearSessionCreatorChatId(sessionId, namespace)
                success = success || cleared
            }
        } else if (clientId) {
            success = store.unsubscribeFromSessionNotificationsByClientId(sessionId, clientId)
        }

        return c.json({ ok: success })
    })

    /**
     * 获取 session 的所有订阅者
     * GET /sessions/:id/subscribers
     */
    app.get('/sessions/:id/subscribers', async (c) => {
        const sessionId = c.req.param('id')
        const chatIdSubscribers = await store.getSessionNotificationSubscribers(sessionId)
        const clientIdSubscribers = await store.getSessionNotificationSubscriberClientIds(sessionId)
        const creatorChatId = await store.getSessionCreatorChatId(sessionId)
        const recipients = await store.getSessionNotificationRecipients(sessionId)

        return c.json({
            sessionId,
            creatorChatId,
            subscribers: chatIdSubscribers,          // Telegram chatId 订阅者
            clientIdSubscribers: clientIdSubscribers, // clientId 订阅者
            totalRecipients: recipients.length + clientIdSubscribers.length
        })
    })

    /**
     * 设置 session 的创建者 chatId
     * POST /sessions/:id/creator
     * Body: { chatId: string }
     */
    app.post('/sessions/:id/creator', async (c) => {
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const body = await c.req.json().catch(() => null)

        if (!body || typeof body.chatId !== 'string') {
            return c.json({ error: 'Invalid body, expected { chatId: string }' }, 400)
        }

        const success = store.setSessionCreatorChatId(sessionId, body.chatId, namespace)
        return c.json({ ok: success })
    })

    /**
     * 移除指定订阅者（owner 或任何人都可以操作）
     * DELETE /sessions/:id/subscribers/:subscriberId
     * subscriberId 可以是 chatId 或 clientId
     * Query: type=chatId|clientId （可选，默认为 chatId）
     */
    app.delete('/sessions/:id/subscribers/:subscriberId', async (c) => {
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const subscriberId = c.req.param('subscriberId')
        const type = c.req.query('type') || 'chatId'

        let success = false
        if (type === 'clientId') {
            success = store.unsubscribeFromSessionNotificationsByClientId(sessionId, subscriberId)
        } else {
            // chatId - 同时检查是否是 creator
            success = store.unsubscribeFromSessionNotifications(sessionId, subscriberId)
            const creatorChatId = store.getSessionCreatorChatId(sessionId)
            if (creatorChatId === subscriberId) {
                const cleared = store.clearSessionCreatorChatId(sessionId, namespace)
                success = success || cleared
            }
        }

        return c.json({ ok: success })
    })

    /**
     * 清除所有订阅者（owner 操作）
     * DELETE /sessions/:id/subscribers
     * 清除所有订阅者，包括 creator
     */
    app.delete('/sessions/:id/subscribers', async (c) => {
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')

        // 清除所有 chatId 订阅者
        const chatIdSubscribers = store.getSessionNotificationSubscribers(sessionId)
        for (const chatId of chatIdSubscribers) {
            store.unsubscribeFromSessionNotifications(sessionId, chatId)
        }

        // 清除所有 clientId 订阅者
        const clientIdSubscribers = store.getSessionNotificationSubscriberClientIds(sessionId)
        for (const clientId of clientIdSubscribers) {
            store.unsubscribeFromSessionNotificationsByClientId(sessionId, clientId)
        }

        // 清除 creator
        store.clearSessionCreatorChatId(sessionId, namespace)

        return c.json({
            ok: true,
            removed: {
                chatIds: chatIdSubscribers.length,
                clientIds: clientIdSubscribers.length,
                creator: true
            }
        })
    })

    return app
}
