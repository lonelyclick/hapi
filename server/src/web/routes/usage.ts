import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

export function createUsageRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // Get usage data for a specific machine
    app.get('/machines/:machineId/usage', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('machineId')
        const namespace = c.get('namespace')
        const machines = engine.getOnlineMachinesByNamespace(namespace)
        const machine = machines.find(m => m.id === machineId)

        if (!machine) {
            return c.json({ error: 'Machine not found or not in your namespace' }, 404)
        }

        try {
            const usage = await engine.getUsage(machineId)
            return c.json(usage)
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to get usage'
            }, 500)
        }
    })

    // Get usage data for all online machines
    app.get('/usage', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const namespace = c.get('namespace')
        const machines = engine.getOnlineMachinesByNamespace(namespace)

        const results: Record<string, {
            machineId: string
            machineName: string
            usage: unknown
            error?: string
        }> = {}

        await Promise.all(
            machines.map(async (machine) => {
                try {
                    const usage = await engine.getUsage(machine.id)
                    results[machine.id] = {
                        machineId: machine.id,
                        machineName: machine.metadata?.displayName ?? machine.metadata?.host ?? machine.id.slice(0, 8),
                        usage
                    }
                } catch (error) {
                    results[machine.id] = {
                        machineId: machine.id,
                        machineName: machine.metadata?.displayName ?? machine.metadata?.host ?? machine.id.slice(0, 8),
                        usage: null,
                        error: error instanceof Error ? error.message : 'Failed to get usage'
                    }
                }
            })
        )

        return c.json({
            machines: Object.values(results),
            timestamp: Date.now()
        })
    })

    return app
}
