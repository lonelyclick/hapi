import { ApiClient } from '@/api/api'
import type { ClaudeAccount } from '@/api/types'
import { logger } from '@/ui/logger'
import { existsSync, symlinkSync, mkdirSync, readdirSync, lstatSync, unlinkSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

/** Patterns indicating the account is exhausted/unauthorized */
const ACCOUNT_EXHAUSTION_PATTERNS = [
    /\b401\b/,
    /unauthorized/i,
    /authentication.*failed/i,
    /token.*exhaust/i,
    /rate.*limit/i,
    /quota.*exceeded/i,
    /over.?capacity/i,
]

export function isAccountExhaustedError(errorMessage: string): boolean {
    return ACCOUNT_EXHAUSTION_PATTERNS.some(p => p.test(errorMessage))
}

export interface AccountRotationResult {
    success: boolean
    newAccount?: ClaudeAccount
    reason: string
}

/**
 * Select a new account, create symlinks for session continuity,
 * and return the new account info.
 */
export async function rotateAccount(opts: {
    api: ApiClient
    currentConfigDir?: string
    claudeSessionId: string | null
    workingDirectory: string
}): Promise<AccountRotationResult> {
    const newAccount = await opts.api.selectBestClaudeAccount()
    if (!newAccount) {
        return { success: false, reason: 'no_accounts_available' }
    }

    // Don't rotate to the same account (compare by configDir which is always available)
    if (opts.currentConfigDir && newAccount.configDir === opts.currentConfigDir) {
        return { success: false, reason: 'same_account_selected' }
    }

    // Create symlink for session file if we have a Claude session ID
    if (opts.claudeSessionId) {
        createSessionSymlink({
            sessionId: opts.claudeSessionId,
            newAccountConfigDir: newAccount.configDir,
            workingDirectory: opts.workingDirectory,
        })
    }

    return { success: true, newAccount, reason: 'rotated' }
}

/**
 * Symlink logic extracted from runClaude.ts.
 * Creates a symlink in the new account's project dir pointing to
 * the session .jsonl file from any other account dir.
 */
function createSessionSymlink(opts: {
    sessionId: string
    newAccountConfigDir: string
    workingDirectory: string
}): void {
    const projectId = resolve(opts.workingDirectory).replace(/[^a-zA-Z0-9]/g, '-')
    const newProjectDir = join(opts.newAccountConfigDir, 'projects', projectId)
    const targetFile = join(newProjectDir, `${opts.sessionId}.jsonl`)

    // Check if target exists as a valid file (existsSync follows symlinks)
    // Also handle broken symlinks: lstatSync succeeds but existsSync returns false
    let needsSymlink = !existsSync(targetFile)
    if (needsSymlink) {
        try { lstatSync(targetFile); unlinkSync(targetFile) } catch {}  // Remove broken symlink if present
    }

    if (!needsSymlink) return

    // Search all account dirs for the session file
    const accountsDir = dirname(opts.newAccountConfigDir)
    try {
        const accounts = readdirSync(accountsDir, { withFileTypes: true })
        for (const entry of accounts) {
            if (!entry.isDirectory()) continue
            const candidateDir = join(accountsDir, entry.name)
            if (candidateDir === opts.newAccountConfigDir) continue
            const sourceFile = join(candidateDir, 'projects', projectId, `${opts.sessionId}.jsonl`)
            if (existsSync(sourceFile)) {
                mkdirSync(newProjectDir, { recursive: true })
                symlinkSync(sourceFile, targetFile)
                logger.debug(`[accountRotation] Symlinked session file: ${sourceFile} -> ${targetFile}`)
                break
            }
        }
    } catch (err) {
        logger.debug(`[accountRotation] Failed to create session symlink:`, err)
    }
}
