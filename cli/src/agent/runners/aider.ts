import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry } from '@/agent/AgentRegistry';
import { OpenRouterBackend } from '@/agent/backends/openrouter';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

// Default model for Aider - Claude Sonnet is a good coding model
const DEFAULT_AIDER_MODEL = 'anthropic/claude-sonnet-4';

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
        logger.debug(`[Aider] Failed to read JSON from ${path}:`, error);
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

function loadOpenRouterApiKey(): string | null {
    // First check environment variable
    const envKey = process.env.OPENROUTER_API_KEY;
    if (envKey) {
        logger.debug('[Aider] Using API key from OPENROUTER_API_KEY env');
        return envKey;
    }

    // Check credential file
    const credentialPath = join(homedir(), 'happy/yoho-task-v2/data/credentials/openrouter/default.json');
    const credentialFile = readJsonFile(credentialPath) as { apiKey?: unknown } | null;
    const credentialKey = asNonEmptyString(credentialFile?.apiKey);
    if (credentialKey) {
        logger.debug(`[Aider] Loaded API key from ${credentialPath}`);
        return credentialKey;
    }

    // Check HAPI settings file
    const settingsFile = readJsonFile(configuration.settingsFile) as HapiSettingsFile | null;
    const settingsKey = asNonEmptyString(settingsFile?.openrouterApiKey);
    if (settingsKey) {
        logger.debug(`[Aider] Loaded API key from ${configuration.settingsFile}`);
        return settingsKey;
    }

    return null;
}

export function registerAiderAgent(model?: string): void {
    const apiKey = loadOpenRouterApiKey();
    const selectedModel = model || DEFAULT_AIDER_MODEL;

    if (!apiKey) {
        logger.warn('[Aider] No OpenRouter API key found. Set OPENROUTER_API_KEY or add openrouterApiKey to settings.');
        // Still register but will fail when used
        AgentRegistry.register('aider', () => {
            throw new Error('OpenRouter API key not configured. Set OPENROUTER_API_KEY environment variable or add openrouterApiKey to HAPI settings.');
        });
        return;
    }

    logger.debug(`[Aider] Registering with model: ${selectedModel}`);
    AgentRegistry.register('aider', () => new OpenRouterBackend(selectedModel, apiKey));
}
