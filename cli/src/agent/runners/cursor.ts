import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry } from '@/agent/AgentRegistry';
import { CursorBackend } from '@/agent/backends/cursor';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

type CursorCredentialFile = {
    apiKey?: unknown;
};

type HapiSettingsFile = {
    cursorApiKey?: unknown;
};

function readJsonFile(path: string): unknown | null {
    try {
        if (!existsSync(path)) {
            return null;
        }
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch (error) {
        logger.debug(`[Cursor] Failed to read JSON from ${path}:`, error);
        return null;
    }
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

/**
 * 加载 Cursor API Key
 * 优先级:
 * 1. CURSOR_API_KEY 环境变量
 * 2. ~/happy/yoho-task-v2/data/credentials/cursor/default.json
 * 3. HAPI settings 文件
 */
function loadCursorApiKey(): string | null {
    // 检查环境变量
    const envKey = process.env.CURSOR_API_KEY;
    if (envKey) {
        logger.debug('[Cursor] Using API key from CURSOR_API_KEY env');
        return envKey;
    }

    // 检查凭证文件
    const credentialPath = join(homedir(), 'happy/yoho-task-v2/data/credentials/cursor/default.json');
    const credentialFile = readJsonFile(credentialPath) as CursorCredentialFile | null;
    const credentialKey = asNonEmptyString(credentialFile?.apiKey);
    if (credentialKey) {
        logger.debug(`[Cursor] Loaded API key from ${credentialPath}`);
        return credentialKey;
    }

    // 检查 HAPI settings 文件
    const settingsFile = readJsonFile(configuration.settingsFile) as HapiSettingsFile | null;
    const settingsKey = asNonEmptyString(settingsFile?.cursorApiKey);
    if (settingsKey) {
        logger.debug(`[Cursor] Loaded API key from ${configuration.settingsFile}`);
        return settingsKey;
    }

    logger.debug('[Cursor] No API key found in any location');
    return null;
}

/**
 * 注册 Cursor Agent 到 AgentRegistry
 *
 * @param yolo - 是否启用自动确认模式（跳过文件修改确认）
 */
export function registerCursorAgent(yolo: boolean = false): void {
    const apiKey = loadCursorApiKey();

    if (!apiKey) {
        logger.warn('[Cursor] No Cursor API key found. Set CURSOR_API_KEY or add cursorApiKey to settings.');
        // 仍然注册，但使用时会失败
        AgentRegistry.register('cursor', () => {
            throw new Error(
                'Cursor API key not configured. ' +
                'Set CURSOR_API_KEY environment variable or add cursorApiKey to HAPI settings.'
            );
        });
        return;
    }

    logger.debug('[Cursor] Registering agent', { yolo });
    AgentRegistry.register('cursor', () => new CursorBackend({
        apiKey,
        autoConfirm: yolo
    }));
}
