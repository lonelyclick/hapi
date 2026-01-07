import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { IStore, UserRole } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { buildInitPrompt } from '../prompts/initPrompt'
import { requireMachine } from './guards'

const spawnBodySchema = z.object({
    directory: z.string().min(1),
    agent: z.enum(['claude', 'codex', 'gemini', 'glm', 'minimax', 'grok', 'openrouter', 'aider-cli']).optional(),
    yolo: z.boolean().optional(),
    sessionType: z.enum(['simple', 'worktree']).optional(),
    worktreeName: z.string().optional(),
    claudeAgent: z.string().min(1).optional(),
    openrouterModel: z.string().min(1).optional(),
    source: z.string().min(1).max(100).optional()
})

const pathsExistsSchema = z.object({
    paths: z.array(z.string().min(1)).max(1000)
})

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

async function sendInitPromptAfterOnline(engine: SyncEngine, sessionId: string, role: UserRole): Promise<void> {
    const isOnline = await waitForSessionOnline(engine, sessionId, 60_000)
    if (!isOnline) {
        return
    }
    await sendInitPrompt(engine, sessionId, role)
}

export function createMachinesRoutes(getSyncEngine: () => SyncEngine | null, store: IStore): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/machines', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const namespace = c.get('namespace')
        const machines = engine.getOnlineMachinesByNamespace(namespace)
        return c.json({ machines })
    })

    app.post('/machines/:id/spawn', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = spawnBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const rawSource = parsed.data.source?.trim()
        const source = rawSource ? rawSource : 'external-api'

        const result = await engine.spawnSession(
            machineId,
            parsed.data.directory,
            parsed.data.agent,
            parsed.data.yolo,
            parsed.data.sessionType,
            parsed.data.worktreeName,
            { claudeAgent: parsed.data.claudeAgent, openrouterModel: parsed.data.openrouterModel, source }
        )

        // 如果 spawn 成功，等 session online 后发送初始化 prompt（动态生成）
        if (result.type === 'success') {
            const email = c.get('email')
            // 获取用户角色
            let role: UserRole = 'developer'
            if (email) {
                const users = store.getAllowedUsers()
                if (users.length > 0) {
                    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase())
                    if (user) {
                        role = user.role
                    }
                }
            }
            void sendInitPromptAfterOnline(engine, result.sessionId, role)
        }

        return c.json(result)
    })

    app.post('/machines/:id/paths/exists', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = pathsExistsSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const uniquePaths = Array.from(new Set(parsed.data.paths.map((path) => path.trim()).filter(Boolean)))
        if (uniquePaths.length === 0) {
            return c.json({ exists: {} })
        }

        try {
            const exists = await engine.checkPathsExist(machineId, uniquePaths)
            return c.json({ exists })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to check paths' }, 500)
        }
    })

    return app
}
