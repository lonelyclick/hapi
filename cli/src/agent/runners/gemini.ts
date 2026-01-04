import { AgentRegistry } from '@/agent/AgentRegistry';
import { AcpSdkBackend } from '@/agent/backends/acp';

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
        ['--acp'],
        ['--experimental-acp']
    ];

    AgentRegistry.register('gemini', () => new AcpSdkBackend({
        command: 'gemini',
        fallbackArgs,
        env: buildEnv(),
        initTimeoutMs: 10_000
    }));
}
