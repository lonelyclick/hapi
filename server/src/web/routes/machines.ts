import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { IStore, UserRole } from '../../store'
import type { BrainStore } from '../../brain/store'
import type { AutoBrainService } from '../../brain/autoBrain'
import type { WebAppEnv } from '../middleware/auth'
import { buildInitPrompt } from '../prompts/initPrompt'
import { requireMachine } from './guards'

const spawnBodySchema = z.object({
    directory: z.string().min(1),
    agent: z.enum(['claude', 'opencode']).optional(),
    yolo: z.boolean().optional(),
    sessionType: z.enum(['simple', 'worktree']).optional(),
    worktreeName: z.string().optional(),
    claudeSettingsType: z.enum(['litellm', 'claude']).optional(),
    claudeAgent: z.string().min(1).optional(),
    opencodeModel: z.string().min(1).optional(),
    opencodeVariant: z.string().min(1).optional(),
    enableBrain: z.boolean().optional(),
    source: z.string().min(1).max(100).optional()
})

const pathsExistsSchema = z.object({
    paths: z.array(z.string().min(1)).max(1000)
})

async function sendInitPrompt(engine: SyncEngine, sessionId: string, role: UserRole, userName?: string | null): Promise<void> {
    try {
        const session = engine.getSession(sessionId)
        const projectRoot = session?.metadata?.path?.trim()
            || session?.metadata?.worktree?.basePath?.trim()
            || null
        console.log(`[machines/sendInitPrompt] sessionId=${sessionId}, role=${role}, projectRoot=${projectRoot}, userName=${userName}`)
        const prompt = await buildInitPrompt(role, { projectRoot, userName })
        if (!prompt.trim()) {
            console.warn(`[machines/sendInitPrompt] Empty prompt for session ${sessionId}, skipping`)
            return
        }
        console.log(`[machines/sendInitPrompt] Sending prompt to session ${sessionId}, length=${prompt.length}`)
        await engine.sendMessage(sessionId, {
            text: prompt,
            sentFrom: 'webapp'
        })
        console.log(`[machines/sendInitPrompt] Successfully sent init prompt to session ${sessionId}`)
    } catch (err) {
        console.error(`[machines/sendInitPrompt] Failed for session ${sessionId}:`, err)
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


export function createMachinesRoutes(getSyncEngine: () => SyncEngine | null, store: IStore, brainStore?: BrainStore, autoBrainService?: AutoBrainService): Hono<WebAppEnv> {
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
            { claudeSettingsType: parsed.data.claudeSettingsType, claudeAgent: parsed.data.claudeAgent, opencodeModel: parsed.data.opencodeModel, opencodeVariant: parsed.data.opencodeVariant, source }
        )

        // 如果 spawn 成功，等 session online 后设置 createdBy 并发送初始化 prompt
        if (result.type === 'success') {
            const email = c.get('email')
            const namespace = c.get('namespace')
            const role = c.get('role')  // Role from Keycloak token
            const userName = c.get('name')
            // Wait for session to be online, then set createdBy and send init prompt
            void (async () => {
                console.log(`[machines/spawn] Waiting for session ${result.sessionId} to come online...`)
                const isOnline = await waitForSessionOnline(engine, result.sessionId, 60_000)
                if (!isOnline) {
                    console.warn(`[machines/spawn] Session ${result.sessionId} did not come online within 60s, skipping init prompt`)
                    return
                }
                console.log(`[machines/spawn] Session ${result.sessionId} is online, waiting for socket to join room...`)
                // Wait for CLI socket to actually join the session room (not just session-alive)
                const hasSocket = await engine.waitForSocketInRoom(result.sessionId, 5000)
                if (!hasSocket) {
                    console.warn(`[machines/spawn] No socket joined room for session ${result.sessionId} within 5s, sending anyway`)
                }
                console.log(`[machines/spawn] Sending init prompt to session ${result.sessionId}`)
                // Set createdBy after session is confirmed online (exists in DB)
                if (email) {
                    await store.setSessionCreatedBy(result.sessionId, email, namespace)
                }
                await sendInitPrompt(engine, result.sessionId, role, userName)

                // 如果启用 Brain，异步创建 Brain session
                if (parsed.data.enableBrain && brainStore) {
                    try {
                        console.log(`[machines/spawn] Creating Brain session for ${result.sessionId}...`)
                        const mainSession = engine.getSession(result.sessionId)
                        const directory = mainSession?.metadata?.path
                        if (directory) {
                            const brainSpawnResult = await engine.spawnSession(
                                machineId,
                                directory,
                                'claude',
                                false,
                                'simple',
                                undefined,
                                { source: 'brain' }
                            )
                            if (brainSpawnResult.type === 'success') {
                                const brainOnline = await waitForSessionOnline(engine, brainSpawnResult.sessionId, 60_000)
                                if (brainOnline) {
                                    // 发送 Brain 初始化 Prompt
                                    await engine.sendMessage(brainSpawnResult.sessionId, {
                                        text: [
                                            '你是一个「大脑」角色，负责审查和分析另一个编程 Session 的对话内容。',
                                            '',
                                            `## 项目信息`,
                                            `- 项目路径：\`${directory}\``,
                                            `- 主 Session ID：${result.sessionId}`,
                                            '',
                                            '## 你的职责',
                                            '- 你会持续收到来自主 Session 的对话汇总（用户提问 + AI 回复摘要）',
                                            '- 请从全局视角审查代码变更，发现潜在的 bug、安全问题、性能问题和改进建议',
                                            '- 每次收到汇总后，给出简洁的分析和建议',
                                            '',
                                            '## 记忆系统',
                                            `你有一个持久化记忆目录：\`${directory}/.yoho-brain/\``,
                                            '- **每次收到对话汇总时，先读取该目录下的记忆文件**（尤其是 `MEMORY.md`），了解之前的上下文和已知问题',
                                            '- 分析完成后，将重要的发现、决策、架构变更等写入记忆文件，供后续参考',
                                            '- 建议的记忆文件结构：',
                                            '  - `MEMORY.md` — 总体记忆索引，记录关键决策和架构概览（保持简洁，不超过 200 行）',
                                            '  - `issues.md` — 发现的问题和跟踪状态',
                                            '  - `architecture.md` — 项目架构和重要设计决策',
                                            '',
                                            '## 回复格式',
                                            '- 如果发现问题，列出具体的建议（类型、严重程度、描述）',
                                            '- 如果没有问题，简短回复即可',
                                            '- 使用中文回复',
                                            '',
                                            '等待接收对话汇总...'
                                        ].join('\n'),
                                        sentFrom: 'webapp'
                                    })
                                    console.log(`[machines/spawn] Sent brain init prompt to ${brainSpawnResult.sessionId}`)

                                    // 构建上下文（复用 brain 模块的消息解析逻辑）
                                    const page = await engine.getMessagesPage(result.sessionId, { limit: 20, beforeSeq: null })
                                    const contextMessages: string[] = []
                                    for (const m of page.messages) {
                                        const content = m.content as Record<string, unknown> | null
                                        if (!content || content.role !== 'user') continue
                                        const body = content.content as Record<string, unknown> | string | undefined
                                        if (!body) continue
                                        if (typeof body === 'string') {
                                            const trimmed = body.trim()
                                            if (trimmed) contextMessages.push(trimmed)
                                        } else if (typeof body === 'object' && body.type === 'text' && typeof body.text === 'string') {
                                            const trimmed = (body.text as string).trim()
                                            if (trimmed) contextMessages.push(trimmed)
                                        }
                                    }
                                    const contextSummary = contextMessages.join('\n') || 'New session'

                                    await brainStore.createBrainSession({
                                        namespace,
                                        mainSessionId: result.sessionId,
                                        brainSessionId: brainSpawnResult.sessionId,
                                        brainModel: 'claude',
                                        contextSummary
                                    })
                                    console.log(`[machines/spawn] Brain session created: ${brainSpawnResult.sessionId}`)

                                    if (autoBrainService) {
                                        setTimeout(() => {
                                            autoBrainService.triggerSync(result.sessionId).catch(err => {
                                                console.error('[machines/spawn] Failed to trigger brain sync:', err)
                                            })
                                        }, 3000)
                                    }
                                } else {
                                    console.warn(`[machines/spawn] Brain session did not come online`)
                                }
                            } else {
                                console.warn(`[machines/spawn] Failed to spawn Brain session:`, brainSpawnResult.message)
                            }
                        }
                    } catch (err) {
                        console.error(`[machines/spawn] Failed to create Brain session:`, err)
                    }
                }
            })()
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
