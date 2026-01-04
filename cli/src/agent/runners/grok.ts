import { AgentRegistry } from '@/agent/AgentRegistry';
import { GrokBackend } from '@/agent/backends/grok';

// Available Grok models:
// - grok-3: Standard model (131K context)
// - grok-3-mini: Lightweight model (131K context)
// - grok-4-0709: Reasoning model (256K context)
// - grok-4-fast-reasoning: Fast reasoning (2M context)
// - grok-4-fast-non-reasoning: Fast non-reasoning (2M context)
// - grok-code-fast-1: Code-focused fast model (256K context)
const DEFAULT_MODEL = process.env.GROK_MODEL || 'grok-3';

export function registerGrokAgent(_yolo: boolean): void {
    AgentRegistry.register('grok', () => new GrokBackend(DEFAULT_MODEL));
}
