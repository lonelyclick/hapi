import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry } from '@/agent/AgentRegistry';
import { AcpSdkBackend } from '@/agent/backends/acp';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

type GeminiCredentialFile = {
    apiKey?: unknown;
};

type HapiSettingsFile = {
    geminiApiKey?: unknown;
};

function readJsonFile(path: string): unknown | null {
    try {
        if (!existsSync(path)) {
            return null;
        }
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch (error) {
        logger.debug(`[Gemini] Failed to read JSON from ${path}:`, error);
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

function loadGeminiApiKeyFromFiles(): string | null {
    const credentialPath = join(homedir(), 'happy/yoho-task-v2/data/credentials/gemini/default.json');
    const credentialFile = readJsonFile(credentialPath) as GeminiCredentialFile | null;
    const credentialKey = asNonEmptyString(credentialFile?.apiKey);
    if (credentialKey) {
        logger.debug(`[Gemini] Loaded API key from ${credentialPath}`);
        return credentialKey;
    }

    const settingsFile = readJsonFile(configuration.settingsFile) as HapiSettingsFile | null;
    const settingsKey = asNonEmptyString(settingsFile?.geminiApiKey);
    if (settingsKey) {
        logger.debug(`[Gemini] Loaded API key from ${configuration.settingsFile}`);
        return settingsKey;
    }

    return null;
}

function buildEnv(): Record<string, string> {
    return Object.keys(process.env).reduce((acc, key) => {
        const value = process.env[key];
        if (typeof value === 'string') {
            acc[key] = value;
        }
        return acc;
    }, {} as Record<string, string>);
}

export function registerGeminiAgent(_yolo: boolean): void {
    const fallbackArgs = [
        ['--experimental-acp'],
        ['--acp']
    ];

    const env = buildEnv();
    if (!env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) {
        const apiKey = loadGeminiApiKeyFromFiles();
        if (apiKey) {
            env.GEMINI_API_KEY = apiKey;
        }
    }

    AgentRegistry.register('gemini', () => new AcpSdkBackend({
        command: 'gemini',
        fallbackArgs,
        env,
        initTimeoutMs: 10_000
    }));
}
