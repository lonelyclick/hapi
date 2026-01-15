import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry } from '@/agent/AgentRegistry';
import { OpenCodeBackend, type OpenCodeBackendOptions } from '@/agent/backends/opencode';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

type HapiSettingsFile = {
    opencode?: {
        hostname?: string;
        port?: number;
        defaultModel?: string;
        autoStartServer?: boolean;
        serverStartTimeout?: number;
    };
    opencodeDefaultModel?: string;
};

function readJsonFile(path: string): unknown | null {
    try {
        if (!existsSync(path)) {
            return null;
        }
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch (error) {
        logger.debug(`[OpenCode] Failed to read JSON from ${path}:`, error);
        return null;
    }
}

function loadOpenCodeConfig(): OpenCodeBackendOptions {
    const options: OpenCodeBackendOptions = {};

    // Check environment variables first
    if (process.env.OPENCODE_HOST) {
        options.hostname = process.env.OPENCODE_HOST;
    }
    if (process.env.OPENCODE_PORT) {
        const port = parseInt(process.env.OPENCODE_PORT, 10);
        if (!isNaN(port)) {
            options.port = port;
        }
    }
    if (process.env.OPENCODE_MODEL) {
        options.defaultModel = process.env.OPENCODE_MODEL;
    }
    if (process.env.OPENCODE_AUTO_START === 'false') {
        options.autoStartServer = false;
    }

    // Then check settings file
    const settingsFile = readJsonFile(configuration.settingsFile) as HapiSettingsFile | null;
    if (settingsFile?.opencode) {
        const oc = settingsFile.opencode;
        if (oc.hostname && !options.hostname) {
            options.hostname = oc.hostname;
        }
        if (oc.port && !options.port) {
            options.port = oc.port;
        }
        if (oc.defaultModel && !options.defaultModel) {
            options.defaultModel = oc.defaultModel;
        }
        if (oc.autoStartServer !== undefined && options.autoStartServer === undefined) {
            options.autoStartServer = oc.autoStartServer;
        }
        if (oc.serverStartTimeout) {
            options.serverStartTimeout = oc.serverStartTimeout;
        }
    }

    // Legacy support for opencodeDefaultModel
    if (settingsFile?.opencodeDefaultModel && !options.defaultModel) {
        options.defaultModel = settingsFile.opencodeDefaultModel;
    }

    logger.debug('[OpenCode] Loaded config:', options);
    return options;
}

export function registerOpenCodeAgent(): void {
    const config = loadOpenCodeConfig();

    AgentRegistry.register('opencode', () => new OpenCodeBackend(config));

    logger.debug('[OpenCode] Agent registered');
}
