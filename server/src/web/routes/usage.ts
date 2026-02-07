import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { readFile, readdir, stat, writeFile, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

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
    fiveHour: {
        utilization: number
        resetsAt: string
    } | null
    sevenDay: {
        utilization: number
        resetsAt: string
    } | null
    tokenUsage: {
        inputTokens: number
        outputTokens: number
        cachedInputTokens: number
        reasoningOutputTokens: number
        totalTokens: number
    } | null
    error?: string
}

interface LocalUsageData {
    today: {
        inputTokens: number
        outputTokens: number
        cacheCreationTokens: number
        cacheReadTokens: number
        totalTokens: number
        sessions: number
    }
    total: {
        inputTokens: number
        outputTokens: number
        cacheCreationTokens: number
        cacheReadTokens: number
        totalTokens: number
        sessions: number
    }
    error?: string
}

interface UsageResponse {
    claude: ClaudeUsageData | null
    codex: CodexUsageData | null
    local: LocalUsageData | null
    timestamp: number
}

/** Claude Code OAuth client ID (from claude-code source) */
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const CLAUDE_OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
/** Refresh token 提前 30 分钟（token 有效期 8 小时） */
const TOKEN_REFRESH_MARGIN_MS = 30 * 60_000

/**
 * Get Claude Code access token from credentials file
 * 自动检查 token 是否过期，过期则用 refreshToken 刷新并写回文件
 */
export async function getClaudeAccessToken(configDir?: string): Promise<string | null> {
    try {
        const baseDir = configDir || join(homedir(), '.claude')
        const credPath = join(baseDir, '.credentials.json')
        const content = await readFile(credPath, 'utf-8')
        const creds = JSON.parse(content)
        const oauth = creds.claudeAiOauth
        if (!oauth?.accessToken) {
            return creds.accessToken ?? null
        }

        // 检查 token 是否快过期
        const expiresAt = oauth.expiresAt ?? 0
        if (expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
            return oauth.accessToken
        }

        // Token 已过期或即将过期，尝试刷新
        if (!oauth.refreshToken) {
            return oauth.accessToken // 没有 refreshToken，只能用现有的
        }

        console.log(`[Usage] Token expired for ${baseDir}, refreshing...`)
        const refreshed = await refreshOAuthToken(oauth.refreshToken)
        if (!refreshed) {
            return oauth.accessToken // 刷新失败，返回旧 token
        }

        // 更新 credentials 文件
        creds.claudeAiOauth = {
            ...oauth,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: Date.now() + refreshed.expiresIn * 1000,
        }
        const tmpFile = credPath + '.tmp'
        await writeFile(tmpFile, JSON.stringify(creds, null, 2))
        await rename(tmpFile, credPath)
        console.log(`[Usage] Token refreshed for ${baseDir}`)

        return refreshed.accessToken
    } catch {
        return null
    }
}

/**
 * 使用 refreshToken 获取新的 accessToken
 */
async function refreshOAuthToken(refreshToken: string): Promise<{
    accessToken: string
    refreshToken: string
    expiresIn: number
} | null> {
    try {
        const resp = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'claude-code/2.1.33',
            },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: CLAUDE_OAUTH_CLIENT_ID,
            }),
        })
        if (!resp.ok) {
            console.error(`[Usage] Token refresh failed: ${resp.status} ${resp.statusText}`)
            return null
        }
        const data = await resp.json() as {
            access_token?: string
            refresh_token?: string
            expires_in?: number
        }
        if (!data.access_token) return null
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? refreshToken,
            expiresIn: data.expires_in ?? 28800,
        }
    } catch (error) {
        console.error('[Usage] Token refresh error:', error)
        return null
    }
}

/**
 * Simple cache for getClaudeUsage to avoid redundant API calls
 * Key: configDir (or 'default'), Value: { data, fetchedAt }
 */
const claudeUsageCache = new Map<string, { data: ClaudeUsageData; fetchedAt: number }>()
const CLAUDE_USAGE_CACHE_TTL_MS = 5 * 60_000 // 5 分钟缓存

/**
 * Fetch Claude Code usage from Anthropic API (with 60s cache)
 */
export async function getClaudeUsage(configDir?: string): Promise<ClaudeUsageData> {
    const cacheKey = configDir || 'default'
    const cached = claudeUsageCache.get(cacheKey)
    if (cached && (Date.now() - cached.fetchedAt) < CLAUDE_USAGE_CACHE_TTL_MS) {
        return cached.data
    }

    const data = await fetchClaudeUsageFromApi(configDir)
    claudeUsageCache.set(cacheKey, { data, fetchedAt: Date.now() })
    return data
}

async function fetchClaudeUsageFromApi(configDir?: string): Promise<ClaudeUsageData> {
    try {
        const accessToken = await getClaudeAccessToken(configDir)

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
                'User-Agent': 'claude-code/2.1.33',
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

        // Anthropic API returns utilization as 0-100 percentage, convert to 0-1 ratio
        return {
            fiveHour: data.five_hour ? {
                utilization: (data.five_hour.utilization ?? 0) / 100,
                resetsAt: data.five_hour.resets_at ?? ''
            } : null,
            sevenDay: data.seven_day ? {
                utilization: (data.seven_day.utilization ?? 0) / 100,
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
 * Parse a JSONL file and extract usage data
 */
async function parseJsonlFile(filePath: string, todayStart: number): Promise<{
    today: { input: number; output: number; cacheCreate: number; cacheRead: number }
    total: { input: number; output: number; cacheCreate: number; cacheRead: number }
    hasToday: boolean
}> {
    const result = {
        today: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
        total: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
        hasToday: false
    }

    try {
        const fileStream = createReadStream(filePath)
        const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity
        })

        for await (const line of rl) {
            if (!line.trim()) continue
            try {
                const entry = JSON.parse(line) as {
                    type?: string
                    timestamp?: string
                    message?: {
                        usage?: {
                            input_tokens?: number
                            output_tokens?: number
                            cache_creation_input_tokens?: number
                            cache_read_input_tokens?: number
                        }
                    }
                }

                if (entry.type === 'assistant' && entry.message?.usage) {
                    const usage = entry.message.usage
                    const input = usage.input_tokens ?? 0
                    const output = usage.output_tokens ?? 0
                    const cacheCreate = usage.cache_creation_input_tokens ?? 0
                    const cacheRead = usage.cache_read_input_tokens ?? 0

                    result.total.input += input
                    result.total.output += output
                    result.total.cacheCreate += cacheCreate
                    result.total.cacheRead += cacheRead

                    // Check if this entry is from today
                    if (entry.timestamp) {
                        const entryTime = new Date(entry.timestamp).getTime()
                        if (entryTime >= todayStart) {
                            result.today.input += input
                            result.today.output += output
                            result.today.cacheCreate += cacheCreate
                            result.today.cacheRead += cacheRead
                            result.hasToday = true
                        }
                    }
                }
            } catch {
                // Skip invalid JSON lines
            }
        }
    } catch {
        // File read error, skip
    }

    return result
}

/**
 * Get local usage data from Claude Code JSONL files
 */
async function getLocalUsage(): Promise<LocalUsageData> {
    try {
        const projectsDir = join(homedir(), '.claude', 'projects')

        // Get today's start timestamp (midnight local time)
        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

        const today = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, sessions: 0 }
        const total = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, sessions: 0 }

        // Read all project directories
        let projectDirs: string[]
        try {
            projectDirs = await readdir(projectsDir)
        } catch {
            return { today, total, error: 'No Claude Code projects found' }
        }

        for (const projectDir of projectDirs) {
            const projectPath = join(projectsDir, projectDir)

            try {
                const projectStat = await stat(projectPath)
                if (!projectStat.isDirectory()) continue

                // Read all JSONL files in the project
                const files = await readdir(projectPath)
                for (const file of files) {
                    if (!file.endsWith('.jsonl')) continue

                    const filePath = join(projectPath, file)
                    const fileStat = await stat(filePath)
                    if (!fileStat.isFile() || fileStat.size === 0) continue

                    const result = await parseJsonlFile(filePath, todayStart)

                    total.inputTokens += result.total.input
                    total.outputTokens += result.total.output
                    total.cacheCreationTokens += result.total.cacheCreate
                    total.cacheReadTokens += result.total.cacheRead
                    total.sessions += 1

                    if (result.hasToday) {
                        today.inputTokens += result.today.input
                        today.outputTokens += result.today.output
                        today.cacheCreationTokens += result.today.cacheCreate
                        today.cacheReadTokens += result.today.cacheRead
                        today.sessions += 1
                    }
                }
            } catch {
                // Skip inaccessible directories
            }
        }

        today.totalTokens = today.inputTokens + today.outputTokens + today.cacheCreationTokens + today.cacheReadTokens
        total.totalTokens = total.inputTokens + total.outputTokens + total.cacheCreationTokens + total.cacheReadTokens

        return { today, total }
    } catch (error) {
        return {
            today: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, sessions: 0 },
            total: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, sessions: 0 },
            error: error instanceof Error ? error.message : 'Unknown error'
        }
    }
}

/**
 * Get Codex usage from local JSONL files
 */
async function getCodexUsage(): Promise<CodexUsageData> {
    try {
        const sessionsDir = join(homedir(), '.codex', 'sessions')

        // Find the most recent JSONL file with rate_limits info
        let latestRateLimits: {
            primary?: { used_percent?: number; resets_at?: number }
            secondary?: { used_percent?: number; resets_at?: number }
        } | null = null
        let latestTokenUsage: {
            input_tokens?: number
            output_tokens?: number
            cached_input_tokens?: number
            reasoning_output_tokens?: number
            total_tokens?: number
        } | null = null
        let latestTimestamp = 0

        // Get current date for path
        const now = new Date()
        const year = now.getFullYear()
        const month = String(now.getMonth() + 1).padStart(2, '0')
        const day = String(now.getDate()).padStart(2, '0')

        // Check today's sessions directory first
        const todayDir = join(sessionsDir, String(year), month, day)

        try {
            const files = await readdir(todayDir)
            for (const file of files) {
                if (!file.endsWith('.jsonl')) continue

                const filePath = join(todayDir, file)
                try {
                    const fileStream = createReadStream(filePath)
                    const rl = createInterface({
                        input: fileStream,
                        crlfDelay: Infinity
                    })

                    for await (const line of rl) {
                        if (!line.trim()) continue
                        try {
                            const entry = JSON.parse(line) as {
                                timestamp?: string
                                type?: string
                                payload?: {
                                    type?: string
                                    info?: {
                                        total_token_usage?: {
                                            input_tokens?: number
                                            output_tokens?: number
                                            cached_input_tokens?: number
                                            reasoning_output_tokens?: number
                                            total_tokens?: number
                                        }
                                    }
                                    rate_limits?: {
                                        primary?: { used_percent?: number; resets_at?: number }
                                        secondary?: { used_percent?: number; resets_at?: number }
                                    }
                                }
                            }

                            if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
                                const entryTime = entry.timestamp ? new Date(entry.timestamp).getTime() : 0
                                if (entryTime > latestTimestamp) {
                                    latestTimestamp = entryTime
                                    if (entry.payload.rate_limits) {
                                        latestRateLimits = entry.payload.rate_limits
                                    }
                                    if (entry.payload.info?.total_token_usage) {
                                        latestTokenUsage = entry.payload.info.total_token_usage
                                    }
                                }
                            }
                        } catch {
                            // Skip invalid JSON lines
                        }
                    }
                } catch {
                    // Skip unreadable files
                }
            }
        } catch {
            // Today's directory doesn't exist
        }

        if (!latestRateLimits) {
            return {
                fiveHour: null,
                sevenDay: null,
                tokenUsage: null,
                error: 'No Codex usage data found'
            }
        }

        return {
            fiveHour: latestRateLimits.primary ? {
                utilization: (latestRateLimits.primary.used_percent ?? 0) / 100,
                resetsAt: latestRateLimits.primary.resets_at
                    ? new Date(latestRateLimits.primary.resets_at * 1000).toISOString()
                    : ''
            } : null,
            sevenDay: latestRateLimits.secondary ? {
                utilization: (latestRateLimits.secondary.used_percent ?? 0) / 100,
                resetsAt: latestRateLimits.secondary.resets_at
                    ? new Date(latestRateLimits.secondary.resets_at * 1000).toISOString()
                    : ''
            } : null,
            tokenUsage: latestTokenUsage ? {
                inputTokens: latestTokenUsage.input_tokens ?? 0,
                outputTokens: latestTokenUsage.output_tokens ?? 0,
                cachedInputTokens: latestTokenUsage.cached_input_tokens ?? 0,
                reasoningOutputTokens: latestTokenUsage.reasoning_output_tokens ?? 0,
                totalTokens: latestTokenUsage.total_tokens ?? 0
            } : null
        }
    } catch (error) {
        return {
            fiveHour: null,
            sevenDay: null,
            tokenUsage: null,
            error: error instanceof Error ? error.message : 'Unknown error'
        }
    }
}

/**
 * Get usage data directly (server-side, no RPC)
 */
async function getUsageDirectly(): Promise<UsageResponse> {
    const [claude, codex, local] = await Promise.all([
        getClaudeUsage(),
        getCodexUsage(),
        getLocalUsage()
    ])

    return {
        claude,
        codex,
        local,
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
