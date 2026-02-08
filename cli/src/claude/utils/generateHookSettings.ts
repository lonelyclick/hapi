/**
 * Generate temporary settings file with Claude hooks and optional litellm/claude settings.
 *
 * Creates a per-process settings file passed via --settings to Claude Code.
 * This avoids overwriting the shared settings.json and eliminates race conditions
 * when multiple sessions run with different settings concurrently.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync, mkdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { getHappyCliCommand } from '@/utils/spawnHappyCLI';

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
 * Generate a temporary settings file with SessionStart hook configuration
 * and optional litellm/claude settings merged in.
 */
export function generateHookSettingsFile(port: number, token: string, claudeSettingsType?: 'litellm' | 'claude'): string {
    const hooksDir = join(configuration.happyHomeDir, 'tmp', 'hooks');
    mkdirSync(hooksDir, { recursive: true });

    const filename = `session-hook-${process.pid}.json`;
    const filepath = join(hooksDir, filename);

    const { command, args } = getHappyCliCommand(['hook-forwarder', '--port', String(port), '--token', token]);
    const hookCommand = shellJoin([command, ...args]);

    // Start with hooks config
    const settings: Record<string, unknown> = {
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

    // Merge settings from litellm/claude source file if specified
    if (claudeSettingsType) {
        const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
        const sourceFileName = claudeSettingsType === 'litellm' ? 'settings.litellm.json' : 'settings.claude.json';
        const sourcePath = join(claudeConfigDir, sourceFileName);

        if (existsSync(sourcePath)) {
            try {
                const sourceSettings = JSON.parse(readFileSync(sourcePath, 'utf-8'));
                // Merge source settings into hook settings (source settings take precedence, but hooks are preserved)
                for (const [key, value] of Object.entries(sourceSettings)) {
                    if (key !== 'hooks') {
                        settings[key] = value;
                    }
                }
                logger.info(`[generateHookSettings] Merged ${sourceFileName} into hook settings`);
            } catch (err) {
                logger.warn(`[generateHookSettings] Failed to read ${sourcePath}: ${err}`);
            }
        } else {
            logger.debug(`[generateHookSettings] No source settings file: ${sourcePath}`);
        }
    }

    writeFileSync(filepath, JSON.stringify(settings, null, 4));
    logger.debug(`[generateHookSettings] Created hook settings file: ${filepath}`);

    return filepath;
}

/**
 * Update the fastMode setting in an existing hook settings file.
 * When fastMode is true, adds "fastMode": true to the settings.
 * When fastMode is false, removes the "fastMode" key from the settings.
 */
export function updateHookSettingsFastMode(filepath: string, fastMode: boolean): void {
    try {
        if (!existsSync(filepath)) {
            logger.warn(`[generateHookSettings] Settings file not found for fastMode update: ${filepath}`);
            return;
        }
        const settings = JSON.parse(readFileSync(filepath, 'utf-8'));
        if (fastMode) {
            settings.fastMode = true;
        } else {
            delete settings.fastMode;
        }
        writeFileSync(filepath, JSON.stringify(settings, null, 4));
        logger.debug(`[generateHookSettings] Updated fastMode=${fastMode} in ${filepath}`);
    } catch (error) {
        logger.warn(`[generateHookSettings] Failed to update fastMode in settings file: ${error}`);
    }
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
