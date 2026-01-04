import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry } from '@/agent/AgentRegistry';
import { AiderCliBackend } from '@/agent/backends/aider';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

// 默认模型 - 使用 OpenRouter 格式
const DEFAULT_MODEL = 'openrouter/anthropic/claude-sonnet-4';

type HapiSettingsFile = {
    openrouterApiKey?: unknown;
};

function readJsonFile(path: string): unknown | null {
    try {
        if (!existsSync(path)) {
            return null;
        }
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch (error) {
        logger.debug(`[Aider-CLI] Failed to read JSON from ${path}:`, error);
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
 * 加载 OpenRouter API Key
 * 优先级:
 * 1. OPENROUTER_API_KEY 环境变量
 * 2. ~/happy/yoho-task-v2/data/credentials/openrouter/default.json
 * 3. HAPI settings 文件
 */
function loadOpenRouterApiKey(): string | null {
    // 检查环境变量
    const envKey = process.env.OPENROUTER_API_KEY;
    if (envKey) {
        logger.debug('[Aider-CLI] Using API key from OPENROUTER_API_KEY env');
        return envKey;
    }

    // 检查凭证文件
    const credentialPath = join(homedir(), 'happy/yoho-task-v2/data/credentials/openrouter/default.json');
    const credentialFile = readJsonFile(credentialPath) as { apiKey?: unknown } | null;
    const credentialKey = asNonEmptyString(credentialFile?.apiKey);
    if (credentialKey) {
        logger.debug(`[Aider-CLI] Loaded API key from ${credentialPath}`);
        return credentialKey;
    }

    // 检查 HAPI settings 文件
    const settingsFile = readJsonFile(configuration.settingsFile) as HapiSettingsFile | null;
    const settingsKey = asNonEmptyString(settingsFile?.openrouterApiKey);
    if (settingsKey) {
        logger.debug(`[Aider-CLI] Loaded API key from ${configuration.settingsFile}`);
        return settingsKey;
    }

    logger.debug('[Aider-CLI] No OpenRouter API key found');
    return null;
}

/**
 * 获取 Aider 模型配置
 * 优先级:
 * 1. 传入的 model 参数
 * 2. AIDER_MODEL 环境变量
 * 3. 默认模型 (openrouter/anthropic/claude-sonnet-4)
 */
function getAiderModel(model?: string): string {
    if (model) {
        logger.debug('[Aider-CLI] Using provided model', { model });
        return model;
    }

    const envModel = process.env.AIDER_MODEL;
    if (envModel) {
        logger.debug('[Aider-CLI] Using model from AIDER_MODEL env', { model: envModel });
        return envModel;
    }

    logger.debug('[Aider-CLI] Using default model', { model: DEFAULT_MODEL });
    return DEFAULT_MODEL;
}

/**
 * 注册 Aider CLI Agent 到 AgentRegistry
 *
 * 这个是真正的 Aider CLI，使用 OpenRouter 作为默认后端
 *
 * @param model - 可选的模型名称
 * @param yolo - 是否启用自动确认模式
 */
export function registerAiderCliAgent(model?: string, _yolo: boolean = false): void {
    const selectedModel = getAiderModel(model);
    const openrouterApiKey = loadOpenRouterApiKey();

    logger.debug('[Aider-CLI] Registering agent', {
        model: selectedModel,
        hasApiKey: !!openrouterApiKey
    });

    if (!openrouterApiKey) {
        logger.warn('[Aider-CLI] No OpenRouter API key found. Set OPENROUTER_API_KEY or add openrouterApiKey to settings.');
        AgentRegistry.register('aider-cli', () => {
            throw new Error(
                'OpenRouter API key not configured for Aider CLI. ' +
                'Set OPENROUTER_API_KEY environment variable or add openrouterApiKey to HAPI settings.'
            );
        });
        return;
    }

    AgentRegistry.register('aider-cli', () => new AiderCliBackend({
        model: selectedModel,
        openrouterApiKey,
        yesAlways: true,  // 总是启用，否则会卡住
        stream: true,
        autoCommit: false  // 让用户控制 git
    }));
}
