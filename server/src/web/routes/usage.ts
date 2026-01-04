import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface ClaudeUsageData {
    fiveHour: {
        utilization: number
        resetsAt: string
    } | null
    sevenDay: {
        utilization: number
        resetsAt: string
    } | null
    error?: string
}

interface CodexUsageData {
    error?: string
}

interface UsageResponse {
    claude: ClaudeUsageData | null
    codex: CodexUsageData | null
    timestamp: number
}

/**
 * Get Claude Code access token from credentials file
 */
async function getClaudeAccessToken(): Promise<string | null> {
    try {
        const credPath = join(homedir(), '.claude', '.credentials.json')
        const content = await readFile(credPath, 'utf-8')
        const creds = JSON.parse(content)
        // Try claudeAiOauth.accessToken first (newer format), then accessToken (older format)
        return creds.claudeAiOauth?.accessToken ?? creds.accessToken ?? null
    } catch {
        return null
    }
}

/**
 * Fetch Claude Code usage from Anthropic API
 */
async function getClaudeUsage(): Promise<ClaudeUsageData> {
    try {
        const accessToken = await getClaudeAccessToken()

        if (!accessToken) {
            return {
                fiveHour: null,
                sevenDay: null,
                error: 'No Claude Code credentials found'
            }
        }

        const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'anthropic-beta': 'oauth-2025-04-20',
                'User-Agent': 'claude-code/2.0.32',
                'Accept': 'application/json, text/plain, */*'
            }
        })

        if (!response.ok) {
            return {
                fiveHour: null,
                sevenDay: null,
                error: `API error: ${response.status} ${response.statusText}`
            }
        }

        const data = await response.json() as {
            five_hour?: { utilization?: number; resets_at?: string }
            seven_day?: { utilization?: number; resets_at?: string }
        }

        return {
            fiveHour: data.five_hour ? {
                utilization: data.five_hour.utilization ?? 0,
                resetsAt: data.five_hour.resets_at ?? ''
            } : null,
            sevenDay: data.seven_day ? {
                utilization: data.seven_day.utilization ?? 0,
                resetsAt: data.seven_day.resets_at ?? ''
            } : null
        }
    } catch (error) {
        return {
            fiveHour: null,
            sevenDay: null,
            error: error instanceof Error ? error.message : 'Unknown error'
        }
    }
}

/**
 * Get usage data directly (server-side, no RPC)
 */
async function getUsageDirectly(): Promise<UsageResponse> {
    const claude = await getClaudeUsage()

    return {
        claude,
        codex: { error: 'Codex usage API not yet implemented' },
        timestamp: Date.now()
    }
}

export function createUsageRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // Get usage data directly from server (no RPC needed)
    app.get('/usage', async (c) => {
        try {
            const usage = await getUsageDirectly()
            return c.json(usage)
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to get usage'
            }, 500)
        }
    })

    // Keep machine-specific endpoint for future use
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

        // For now, return the same server-side usage data
        try {
            const usage = await getUsageDirectly()
            return c.json(usage)
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to get usage'
            }, 500)
        }
    })

    return app
}
