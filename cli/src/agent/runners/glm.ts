import { AgentRegistry } from '@/agent/AgentRegistry';
import { NimBackend } from '@/agent/backends/nim';

const GLM_MODEL = 'z-ai/glm4.7';

export function registerGlmAgent(): void {
    AgentRegistry.register('glm', () => new NimBackend(GLM_MODEL));
}
