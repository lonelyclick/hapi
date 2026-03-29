import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry } from '@/agent/AgentRegistry';
import { DroidBackend } from '@/agent/backends/droid';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

type FactoryCredentialFile = {
    apiKey?: unknown;
};

type YohoRemoteSettingsFile = {
    factoryApiKey?: unknown;
};

function readJsonFile(path: string): unknown | null {
    try {
        if (!existsSync(path)) {
            return null;
        }
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch (error) {
        logger.debug(`[Droid] Failed to read JSON from ${path}:`, error);
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
 * 加载 Factory API Key
 * 优先级:
 * 1. FACTORY_API_KEY 环境变量
 * 2. ~/happy/yoho-task-v2/data/credentials/factory/default.json
 * 3. YR settings 文件
 */
function loadFactoryApiKey(): string | null {
    const envKey = process.env.FACTORY_API_KEY;
    if (envKey) {
        logger.debug('[Droid] Using API key from FACTORY_API_KEY env');
        return envKey;
    }

    const credentialPath = join(homedir(), 'happy/yoho-task-v2/data/credentials/factory/default.json');
    const credentialFile = readJsonFile(credentialPath) as FactoryCredentialFile | null;
    const credentialKey = asNonEmptyString(credentialFile?.apiKey);
    if (credentialKey) {
        logger.debug(`[Droid] Loaded API key from ${credentialPath}`);
        return credentialKey;
    }

    const settingsFile = readJsonFile(configuration.settingsFile) as YohoRemoteSettingsFile | null;
    const settingsKey = asNonEmptyString(settingsFile?.factoryApiKey);
    if (settingsKey) {
        logger.debug(`[Droid] Loaded API key from ${configuration.settingsFile}`);
        return settingsKey;
    }

    logger.debug('[Droid] No API key found in any location');
    return null;
}

/**
 * 注册 Factory Droid Agent 到 AgentRegistry
 *
 * @param yolo - 是否启用自动确认模式（映射到 droid exec --auto high）
 */
export function registerDroidAgent(yolo: boolean = false): void {
    const apiKey = loadFactoryApiKey();

    if (!apiKey) {
        logger.warn('[Droid] No Factory API key found. Set FACTORY_API_KEY or add factoryApiKey to settings.');
        AgentRegistry.register('droid', () => {
            throw new Error(
                'Factory API key not configured. ' +
                'Set FACTORY_API_KEY environment variable or add factoryApiKey to YR settings.'
            );
        });
        return;
    }

    logger.debug('[Droid] Registering agent', { yolo });
    AgentRegistry.register('droid', () => new DroidBackend({
        apiKey,
        autoConfirm: yolo
    }));
}
