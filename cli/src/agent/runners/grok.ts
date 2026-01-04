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

export function registerGrokAgent(yolo: boolean): void {
    const args: string[] = [];
    if (yolo) args.push('--yolo');

    AgentRegistry.register('grok', () => new AcpSdkBackend({
        command: 'grok',
        args,
        env: buildEnv()
    }));
}
