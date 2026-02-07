/**
 * Generate temporary settings file with Claude hooks for session tracking.
 *
 * Creates a settings.json file that configures Claude's SessionStart hook
 * to notify our HTTP server when sessions change (new session, resume, compact, etc.).
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync, mkdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { getHappyCliCommand } from '@/utils/spawnHappyCLI';

/**
 * Copy the appropriate settings file based on claudeSettingsType.
 * @param claudeSettingsType - 'litellm' or 'claude'
 * @returns true if copied successfully, false otherwise
 */
export function setupClaudeSettings(claudeSettingsType?: 'litellm' | 'claude'): boolean {
    try {
        const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
        const settingsPath = join(claudeConfigDir, 'settings.json');

        // If claudeSettingsType is specified, copy the appropriate settings file
        if (claudeSettingsType) {
            const sourceFileName = claudeSettingsType === 'litellm' ? 'settings.litellm.json' : 'settings.claude.json';
            const sourcePath = join(claudeConfigDir, sourceFileName);

            if (existsSync(sourcePath)) {
                const sourceContent = readFileSync(sourcePath, 'utf-8');
                writeFileSync(settingsPath, sourceContent);
                logger.info(`[setupClaudeSettings] Copied ${sourceFileName} to settings.json`);
                return true;
            } else {
                logger.warn(`[setupClaudeSettings] Source file not found: ${sourcePath}`);
                return false;
            }
        }

        // No claudeSettingsType specified, keep existing settings.json as-is
        return true;
    } catch (error) {
        logger.warn(`[setupClaudeSettings] Error: ${error}`);
        return false;
    }
}

function shellQuote(value: string): string {
    if (value.length === 0) {
        return '""';
    }

    if (/^[A-Za-z0-9_\/:=-]+$/.test(value)) {
        return value;
    }

    return '"' + value.replace(/(["\\$`])/g, '\\$1') + '"';
}

function shellJoin(parts: string[]): string {
    return parts.map(shellQuote).join(' ');
}

/**
 * Generate a temporary settings file with SessionStart hook configuration.
 */
export function generateHookSettingsFile(port: number, token: string): string {
    const hooksDir = join(configuration.happyHomeDir, 'tmp', 'hooks');
    mkdirSync(hooksDir, { recursive: true });

    const filename = `session-hook-${process.pid}.json`;
    const filepath = join(hooksDir, filename);

    const { command, args } = getHappyCliCommand(['hook-forwarder', '--port', String(port), '--token', token]);
    const hookCommand = shellJoin([command, ...args]);

    const settings = {
        hooks: {
            SessionStart: [
                {
                    matcher: '*',
                    hooks: [
                        {
                            type: 'command',
                            command: hookCommand
                        }
                    ]
                }
            ]
        }
    };

    writeFileSync(filepath, JSON.stringify(settings, null, 4));
    logger.debug(`[generateHookSettings] Created hook settings file: ${filepath}`);

    return filepath;
}

/**
 * Clean up the temporary hook settings file.
 */
export function cleanupHookSettingsFile(filepath: string): void {
    try {
        if (existsSync(filepath)) {
            unlinkSync(filepath);
            logger.debug(`[generateHookSettings] Cleaned up hook settings file: ${filepath}`);
        }
    } catch (error) {
        logger.debug(`[generateHookSettings] Failed to cleanup hook settings file: ${error}`);
    }
}
