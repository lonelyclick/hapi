/**
 * Usage data fetching for Claude Code and Codex
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execAsync = promisify(exec);

export interface ClaudeUsageData {
    fiveHour: {
        utilization: number;
        resetsAt: string;
    } | null;
    sevenDay: {
        utilization: number;
        resetsAt: string;
    } | null;
    error?: string;
}

export interface CodexUsageData {
    model?: string;
    approvalPolicy?: string;
    writableRoots?: string[];
    tokenUsage?: {
        used?: number;
        remaining?: number;
    };
    error?: string;
}

export interface UsageResponse {
    claude: ClaudeUsageData | null;
    codex: CodexUsageData | null;
    timestamp: number;
}

/**
 * Get Claude Code access token from keychain (macOS) or credential store
 */
async function getClaudeAccessToken(): Promise<string | null> {
    const os = platform();

    if (os === 'darwin') {
        try {
            const { stdout } = await execAsync(
                'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null'
            );
            const trimmed = stdout.trim();
            if (!trimmed) return null;

            // Parse JSON to get accessToken
            const creds = JSON.parse(trimmed);
            return creds.accessToken ?? null;
        } catch {
            return null;
        }
    }

    if (os === 'linux') {
        // On Linux, try to read from secret-tool or file
        try {
            const { stdout } = await execAsync(
                'secret-tool lookup service "Claude Code-credentials" 2>/dev/null'
            );
            const trimmed = stdout.trim();
            if (!trimmed) return null;

            const creds = JSON.parse(trimmed);
            return creds.accessToken ?? null;
        } catch {
            // Fallback: try reading from ~/.claude/.credentials.json
            try {
                const { stdout } = await execAsync(
                    'cat ~/.claude/.credentials.json 2>/dev/null'
                );
                const creds = JSON.parse(stdout.trim());
                return creds.accessToken ?? null;
            } catch {
                return null;
            }
        }
    }

    return null;
}

/**
 * Fetch Claude Code usage from Anthropic API
 */
export async function getClaudeUsage(): Promise<ClaudeUsageData> {
    try {
        const accessToken = await getClaudeAccessToken();

        if (!accessToken) {
            return {
                fiveHour: null,
                sevenDay: null,
                error: 'No Claude Code credentials found'
            };
        }

        const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'anthropic-beta': 'oauth-2025-04-20',
                'User-Agent': 'claude-code/2.1.33',
                'Accept': 'application/json, text/plain, */*'
            }
        });

        if (!response.ok) {
            return {
                fiveHour: null,
                sevenDay: null,
                error: `API error: ${response.status} ${response.statusText}`
            };
        }

        const data = await response.json() as {
            five_hour?: { utilization?: number; resets_at?: string };
            seven_day?: { utilization?: number; resets_at?: string };
        };

        return {
            fiveHour: data.five_hour ? {
                utilization: data.five_hour.utilization ?? 0,
                resetsAt: data.five_hour.resets_at ?? ''
            } : null,
            sevenDay: data.seven_day ? {
                utilization: data.seven_day.utilization ?? 0,
                resetsAt: data.seven_day.resets_at ?? ''
            } : null
        };
    } catch (error) {
        return {
            fiveHour: null,
            sevenDay: null,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Get Codex usage - currently just returns placeholder
 * TODO: Implement actual Codex status parsing
 */
export async function getCodexUsage(): Promise<CodexUsageData> {
    // Codex doesn't have a straightforward API for usage
    // The /status command is only available in interactive mode
    return {
        error: 'Codex usage API not yet implemented'
    };
}

/**
 * Get combined usage data for all supported agents
 */
export async function getAllUsage(): Promise<UsageResponse> {
    const [claude, codex] = await Promise.all([
        getClaudeUsage(),
        getCodexUsage()
    ]);

    return {
        claude,
        codex,
        timestamp: Date.now()
    };
}
