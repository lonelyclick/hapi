/**
 * Brain 模块 API 路由
 *
 * 常驻 brain session + MCP tools 模式
 */

import { Hono } from 'hono'
import type { SyncEngine } from '../sync/syncEngine'
import type { SSEManager } from '../sse/sseManager'
import type { WebAppEnv } from '../web/middleware/auth'
import type { BrainStore } from './store'
import type { AutoBrainService } from './autoBrain'
import { refiningSessions } from '../web/routes/messages'

export function createBrainRoutes(
    brainStore: BrainStore,
    getSyncEngine: () => SyncEngine | null,
    getSseManager: () => SSEManager | null,
    autoBrainService?: AutoBrainService
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // 获取主 Session 的 Brain Sessions 列表
    app.get('/brain/sessions', async (c) => {
        const mainSessionId = c.req.query('mainSessionId')
        if (!mainSessionId) {
            return c.json({ error: 'mainSessionId is required' }, 400)
        }

        const brainSessions = await brainStore.getBrainSessionsByMainSession(mainSessionId)

        return c.json({ brainSessions })
    })

    // 获取主 Session 当前活跃的 Brain Session
    // 注意：这个路由必须在 /brain/sessions/:id 之前定义，否则 'active' 会被当作 id
    app.get('/brain/sessions/active/:mainSessionId', async (c) => {
        const mainSessionId = c.req.param('mainSessionId')
        const brainSession = await brainStore.getActiveBrainSession(mainSessionId)

        const isRefining = refiningSessions.has(mainSessionId)

        if (brainSession) {
            return c.json({ ...brainSession, isRefining })
        }

        // Fallback: 返回最近完成的 brain session（用于恢复 noMessage 等持久化状态）
        const latest = await brainStore.getLatestBrainSession(mainSessionId)
        if (!latest) {
            return c.json({ error: 'No active brain session' }, 404)
        }

        return c.json({ ...latest, isRefining })
    })

    // 获取单个 Brain Session
    app.get('/brain/sessions/:id', async (c) => {
        const id = c.req.param('id')
        const brainSession = await brainStore.getBrainSession(id)

        if (!brainSession) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        return c.json(brainSession)
    })

    // 完成 Brain Session
    app.post('/brain/sessions/:id/complete', async (c) => {
        const id = c.req.param('id')
        const body = await c.req.json().catch(() => ({})) as { result?: string }

        const success = await brainStore.completeBrainSession(id, body.result ?? '')

        if (!success) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        return c.json({ success: true })
    })

    // 取消 Brain Session
    app.post('/brain/sessions/:id/cancel', async (c) => {
        const id = c.req.param('id')

        const success = await brainStore.updateBrainSessionStatus(id, 'cancelled')

        if (!success) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        return c.json({ success: true })
    })

    // 删除 Brain Session
    app.delete('/brain/sessions/:id', async (c) => {
        const id = c.req.param('id')

        const success = await brainStore.deleteBrainSession(id)

        if (!success) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        return c.json({ success: true })
    })

    // 获取 Brain Session 的最新执行进度日志（用于前端加载历史）
    app.get('/brain/sessions/:id/progress-log', async (c) => {
        const id = c.req.param('id')
        const brainSession = await brainStore.getBrainSession(id)
        if (!brainSession) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        const execution = await brainStore.getLatestExecutionWithProgress(id)
        if (!execution) {
            return c.json({ entries: [], isActive: false })
        }

        return c.json({
            entries: execution.progressLog,
            isActive: execution.status === 'running',
            executionId: execution.id
        })
    })

    // 触发 autoBrain 的 syncRounds
    app.post('/brain/sessions/:id/auto-sync', async (c) => {
        if (!autoBrainService) {
            return c.json({ error: 'AutoBrain service not available' }, 503)
        }

        const id = c.req.param('id')
        const brainSession = await brainStore.getBrainSession(id)
        if (!brainSession) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        // 异步触发
        autoBrainService.triggerSync(brainSession.mainSessionId).catch(err => {
            console.error('[Brain] auto-sync trigger failed:', err)
        })

        return c.json({
            success: true,
            message: 'Auto sync triggered (async)'
        })
    })

    return app
}
