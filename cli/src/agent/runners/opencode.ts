import { AgentRegistry } from '@/agent/AgentRegistry';
import { OpenCodeBackend, type OpenCodeBackendOptions } from '@/agent/backends/opencode';
import { logger } from '@/ui/logger';

function loadOpenCodeConfig(): OpenCodeBackendOptions {
    const options: OpenCodeBackendOptions = {};

    // Check environment variables
    if (process.env.OPENCODE_MODEL) {
        options.defaultModel = process.env.OPENCODE_MODEL;
    }
    if (process.env.OPENCODE_VARIANT) {
        options.variant = process.env.OPENCODE_VARIANT;
    }

    logger.debug('[OpenCode] Loaded config:', options);
    return options;
}

export function registerOpenCodeAgent(): void {
    const config = loadOpenCodeConfig();

    AgentRegistry.register('opencode', () => new OpenCodeBackend(config));

    logger.debug('[OpenCode] Agent registered (ACP mode)');
}
