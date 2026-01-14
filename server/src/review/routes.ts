/**
 * Review 模块 API 路由
 *
 * 这是一个试验性功能，用于多 Session 协作 Review 模式
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine, DecryptedMessage } from '../sync/syncEngine'
import type { SSEManager } from '../sse/sseManager'
import type { WebAppEnv } from '../web/middleware/auth'
import type { ReviewStore } from './store'

// Review 上下文最大消息数
const REVIEW_CONTEXT_MAX_MESSAGES = 10

// 支持的 Review 模型
const reviewModelValues = ['claude', 'codex', 'gemini', 'glm', 'minimax', 'grok', 'openrouter'] as const
const reviewModelVariantValues = ['opus', 'sonnet', 'haiku', 'gpt-5.2-codex', 'gpt-5.1-codex-max'] as const

const createReviewSessionSchema = z.object({
    mainSessionId: z.string().min(1),
    reviewModel: z.enum(reviewModelValues),
    reviewModelVariant: z.string().optional()
})

/**
 * 从消息内容中提取用户文本
 */
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

/**
 * 从主 Session 的消息中构建 Review 上下文
 * 提取最近 N 轮对话中所有用户的输入
 */
function buildReviewContext(messages: DecryptedMessage[]): string {
    const userMessages: string[] = []

    for (const message of messages) {
        const userText = extractUserText(message.content)
        if (userText) {
            userMessages.push(userText)
        }
    }

    if (userMessages.length === 0) {
        return '(无用户消息)'
    }

    return userMessages.join('\n\n---\n\n')
}

/**
 * 构建 Review Prompt
 */
function buildReviewPrompt(contextSummary: string): string {
    return `你是一个代码审查专家。请审查当前工作目录的代码变更。

## 任务背景（用户的需求描述）

${contextSummary}

## 请执行以下操作

1. 首先运行 \`git diff\` 查看当前的代码变更
2. 分析代码变更，从以下角度进行审查：
   - 代码正确性和潜在 bug
   - 安全问题
   - 性能问题
   - 代码风格和可维护性
   - 是否满足任务需求

3. 请用以下格式输出审查结果：

### 严重问题
（如有）

### 建议改进
（如有）

### 做得好的地方
（如有）

### 总结
（总体评价和建议）
`
}

export function createReviewRoutes(
    reviewStore: ReviewStore,
    getSyncEngine: () => SyncEngine | null,
    getSseManager: () => SSEManager | null
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // 创建 Review Session
    app.post('/review/sessions', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = createReviewSessionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', details: parsed.error.issues }, 400)
        }

        const { mainSessionId, reviewModel, reviewModelVariant } = parsed.data
        const namespace = c.get('namespace')

        // 获取主 Session
        const mainSession = engine.getSessionByNamespace(mainSessionId, namespace)
        if (!mainSession) {
            return c.json({ error: 'Main session not found' }, 404)
        }

        if (!mainSession.active) {
            return c.json({ error: 'Main session is not active' }, 400)
        }

        const machineId = mainSession.metadata?.machineId?.trim()
        if (!machineId) {
            return c.json({ error: 'Main session has no machine' }, 400)
        }

        const machine = engine.getMachineByNamespace(machineId, namespace)
        if (!machine || !machine.active) {
            return c.json({ error: 'Machine is offline' }, 409)
        }

        // 获取主 Session 的最近消息，提取用户输入作为上下文
        const page = await engine.getMessagesPage(mainSessionId, {
            limit: REVIEW_CONTEXT_MAX_MESSAGES * 2,  // 获取更多消息以确保有足够的用户消息
            beforeSeq: null
        })

        const contextSummary = buildReviewContext(page.messages)

        // 获取主 Session 的工作目录
        const directory = mainSession.metadata?.path
        if (!directory) {
            return c.json({ error: 'Main session has no working directory' }, 400)
        }

        // 创建 Review Session（在同一目录下）
        const spawnResult = await engine.spawnSession(
            machineId,
            directory,
            reviewModel as 'claude' | 'codex' | 'gemini' | 'glm' | 'minimax' | 'grok' | 'openrouter',
            false,  // 不使用 yolo 模式
            'simple',
            undefined,
            {
                modelMode: reviewModelVariant as 'opus' | 'sonnet' | undefined,
                source: 'review'
            }
        )

        if (spawnResult.type !== 'success') {
            return c.json({ error: spawnResult.message }, 500)
        }

        const reviewSessionId = spawnResult.sessionId

        // 等待 Review Session 上线
        const waitForOnline = async (sessionId: string, timeoutMs: number): Promise<boolean> => {
            const start = Date.now()
            while (Date.now() - start < timeoutMs) {
                const session = engine.getSession(sessionId)
                if (session?.active) {
                    return true
                }
                await new Promise(resolve => setTimeout(resolve, 500))
            }
            return false
        }

        const isOnline = await waitForOnline(reviewSessionId, 60_000)
        if (!isOnline) {
            return c.json({ error: 'Review session failed to come online' }, 500)
        }

        // 保存 Review Session 记录（状态为 pending，等待用户手动触发）
        const reviewSession = await reviewStore.createReviewSession({
            namespace,
            mainSessionId,
            reviewSessionId,
            reviewModel,
            reviewModelVariant,
            contextSummary
        })

        return c.json({
            id: reviewSession.id,
            reviewSessionId,
            mainSessionId,
            reviewModel,
            reviewModelVariant,
            status: 'pending'
        })
    })

    // 获取主 Session 的 Review Sessions 列表
    app.get('/review/sessions', async (c) => {
        const mainSessionId = c.req.query('mainSessionId')
        if (!mainSessionId) {
            return c.json({ error: 'mainSessionId is required' }, 400)
        }

        const reviewSessions = await reviewStore.getReviewSessionsByMainSession(mainSessionId)

        return c.json({ reviewSessions })
    })

    // 获取主 Session 当前活跃的 Review Session
    // 注意：这个路由必须在 /review/sessions/:id 之前定义，否则 'active' 会被当作 id
    app.get('/review/sessions/active/:mainSessionId', async (c) => {
        const mainSessionId = c.req.param('mainSessionId')
        const reviewSession = await reviewStore.getActiveReviewSession(mainSessionId)

        if (!reviewSession) {
            return c.json({ error: 'No active review session' }, 404)
        }

        return c.json(reviewSession)
    })

    // 获取单个 Review Session
    app.get('/review/sessions/:id', async (c) => {
        const id = c.req.param('id')
        const reviewSession = await reviewStore.getReviewSession(id)

        if (!reviewSession) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        return c.json(reviewSession)
    })

    // 完成 Review Session
    app.post('/review/sessions/:id/complete', async (c) => {
        const id = c.req.param('id')
        const body = await c.req.json().catch(() => ({})) as { result?: string }

        const success = await reviewStore.completeReviewSession(id, body.result ?? '')

        if (!success) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        return c.json({ success: true })
    })

    // 触发 Review（发送 prompt 开始 Review）
    app.post('/review/sessions/:id/start', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        const reviewSession = await reviewStore.getReviewSession(id)
        if (!reviewSession) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        if (reviewSession.status !== 'pending') {
            return c.json({ error: 'Review session is not in pending status' }, 400)
        }

        // 发送 Review Prompt 给 Review Session
        const reviewPrompt = buildReviewPrompt(reviewSession.contextSummary)

        await engine.sendMessage(reviewSession.reviewSessionId, {
            text: reviewPrompt,
            sentFrom: 'webapp'
        })

        // 更新状态为 active
        await reviewStore.updateReviewSessionStatus(id, 'active')

        return c.json({ success: true, status: 'active' })
    })

    // 取消 Review Session
    app.post('/review/sessions/:id/cancel', async (c) => {
        const id = c.req.param('id')

        const success = await reviewStore.updateReviewSessionStatus(id, 'cancelled')

        if (!success) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        return c.json({ success: true })
    })

    // 删除 Review Session
    app.delete('/review/sessions/:id', async (c) => {
        const id = c.req.param('id')

        const success = await reviewStore.deleteReviewSession(id)

        if (!success) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        return c.json({ success: true })
    })

    // 发送对话摘要给 Review AI
    app.post('/review/sessions/:id/summarize', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const reviewSession = await reviewStore.getReviewSession(id)
        if (!reviewSession) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        // 获取主 Session 的最近消息
        const messagesResult = await engine.getMessagesPage(reviewSession.mainSessionId, { limit: 30, beforeSeq: null })

        // 提取用户消息作为摘要
        const userMessages = messagesResult.messages
            .filter((m) => {
                const content = m.content as Record<string, unknown>
                return content?.role === 'user'
            })
            .map((m) => {
                const content = m.content as Record<string, unknown>
                const payload = content?.content as Record<string, unknown>
                return typeof payload?.text === 'string' ? payload.text : ''
            })
            .filter(Boolean)
            .slice(-10)  // 最近 10 条

        if (userMessages.length === 0) {
            return c.json({ error: 'No user messages found' }, 400)
        }

        const summary = `以下是主 Session 中用户的最新对话内容，请基于这些内容进行 Review：

${userMessages.map((msg, i) => `[${i + 1}] ${msg}`).join('\n\n')}

请分析上述对话内容，并给出你的 Review 意见。`

        // 发送给 Review Session
        await engine.sendMessage(reviewSession.reviewSessionId, {
            text: summary,
            sentFrom: 'webapp'
        })

        // 如果是 pending 状态，更新为 active
        if (reviewSession.status === 'pending') {
            await reviewStore.updateReviewSessionStatus(id, 'active')
        }

        return c.json({ success: true })
    })

    // 执行 Review 并发送结果到主 Session
    app.post('/review/sessions/:id/execute', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const reviewSession = await reviewStore.getReviewSession(id)
        if (!reviewSession) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        // 获取 Review Session 的最新 AI 回复
        const messagesResult = await engine.getMessagesPage(reviewSession.reviewSessionId, { limit: 50, beforeSeq: null })

        // 提取最新的 AI 回复
        const agentMessages = messagesResult.messages
            .filter((m) => {
                const content = m.content as Record<string, unknown>
                return content?.role === 'agent'
            })
            .map((m) => {
                const content = m.content as Record<string, unknown>
                const payload = content?.content as Record<string, unknown>
                const data = payload?.data
                if (typeof data === 'string') return data
                if (typeof data === 'object' && data) {
                    const d = data as Record<string, unknown>
                    if (typeof d.message === 'string') return d.message
                }
                return ''
            })
            .filter(Boolean)

        if (agentMessages.length === 0) {
            return c.json({ error: 'No review output found' }, 400)
        }

        // 获取最新的 Review 输出
        const latestReview = agentMessages[agentMessages.length - 1]

        // 发送到主 Session
        const reviewMessage = `## Review AI 反馈

以下是来自 Review AI (${reviewSession.reviewModel}) 的反馈意见：

---

${latestReview}

---

*此消息由 Review AI 自动生成*`

        await engine.sendMessage(reviewSession.mainSessionId, {
            text: reviewMessage,
            sentFrom: 'webapp'
        })

        // 标记 Review 为完成
        await reviewStore.updateReviewSessionStatus(id, 'completed')

        return c.json({ success: true })
    })

    return app
}
