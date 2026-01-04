import { AgentRegistry } from '@/agent/AgentRegistry';
import { GrokBackend } from '@/agent/backends/grok';
import { readModeEnv } from '@/utils/modeEnv';
import type { GrokModelMode } from '@/api/types';

// Available Grok models:
// - grok-3: Standard model (131K context)
// - grok-3-mini: Lightweight model (131K context)
// - grok-4-0709: Reasoning model (256K context)
// - grok-4-fast-reasoning: Fast reasoning (2M context)
// - grok-4-fast-non-reasoning: Fast non-reasoning (2M context)
// - grok-4-1-fast-reasoning: Fast reasoning v4.1 (2M context)
// - grok-4-1-fast-non-reasoning: Fast non-reasoning v4.1 (2M context)
// - grok-code-fast-1: Code-focused fast model (256K context)
const DEFAULT_MODEL = 'grok-code-fast-1';

const GROK_MODEL_IDS = new Set<string>([
    'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning', 'grok-code-fast-1',
    'grok-4-fast-reasoning', 'grok-4-fast-non-reasoning', 'grok-4-0709', 'grok-3-mini', 'grok-3'
]);

function isGrokModel(mode: string | undefined): mode is GrokModelMode {
    return Boolean(mode && GROK_MODEL_IDS.has(mode));
}

export function registerGrokAgent(_yolo: boolean): void {
    // Check for model from environment variable or HAPI_MODEL_MODE
    const envMode = readModeEnv();
    const envGrokModel = process.env.GROK_MODEL;

    let model = DEFAULT_MODEL;
    if (envGrokModel && GROK_MODEL_IDS.has(envGrokModel)) {
        model = envGrokModel;
    } else if (isGrokModel(envMode.modelMode)) {
        model = envMode.modelMode;
    }

    AgentRegistry.register('grok', () => new GrokBackend(model));
}
