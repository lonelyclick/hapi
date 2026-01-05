import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import type { AdvisorService } from '../../agent/advisorService'

export function createAutonomousRoutes(
    getAdvisorService: () => AdvisorService | null
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // 获取自主模式状态
    app.get('/autonomous/status', (c) => {
        const advisorService = getAdvisorService()
        if (!advisorService) {
            return c.json({
                available: false,
                enabled: false,
                error: 'Advisor service not available'
            })
        }

        const status = advisorService.getAutonomousStatus()
        return c.json({
            available: true,
            enabled: advisorService.isAutonomousModeEnabled(),
            ...status
        })
    })

    // 启用自主模式
    app.post('/autonomous/enable', (c) => {
        const advisorService = getAdvisorService()
        if (!advisorService) {
            return c.json({
                success: false,
                error: 'Advisor service not available'
            }, 503)
        }

        advisorService.enableAutonomousMode()
        return c.json({
            success: true,
            message: 'Autonomous mode enabled'
        })
    })

    // 禁用自主模式
    app.post('/autonomous/disable', (c) => {
        const advisorService = getAdvisorService()
        if (!advisorService) {
            return c.json({
                success: false,
                error: 'Advisor service not available'
            }, 503)
        }

        advisorService.disableAutonomousMode()
        return c.json({
            success: true,
            message: 'Autonomous mode disabled'
        })
    })

    return app
}
