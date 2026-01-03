import { AgentRegistry } from '@/agent/AgentRegistry';
import { NimBackend } from '@/agent/backends/nim';

const MINIMAX_MODEL = 'minimaxai/minimax-m2.1';

export function registerMinimaxAgent(): void {
    AgentRegistry.register('minimax', () => new NimBackend(MINIMAX_MODEL));
}
