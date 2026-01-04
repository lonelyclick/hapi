import { AgentRegistry } from '@/agent/AgentRegistry';
import { AiderCliBackend } from '@/agent/backends/aider';
import { logger } from '@/ui/logger';

// 默认模型
const DEFAULT_MODEL = 'claude-sonnet-4';

/**
 * 获取 Aider 模型配置
 * 优先级:
 * 1. 传入的 model 参数
 * 2. AIDER_MODEL 环境变量
 * 3. 默认模型 (claude-sonnet-4)
 */
function getAiderModel(model?: string): string {
    if (model) {
        logger.debug('[Aider-CLI] Using provided model', { model });
        return model;
    }

    const envModel = process.env.AIDER_MODEL;
    if (envModel) {
        logger.debug('[Aider-CLI] Using model from AIDER_MODEL env', { model: envModel });
        return envModel;
    }

    logger.debug('[Aider-CLI] Using default model', { model: DEFAULT_MODEL });
    return DEFAULT_MODEL;
}

/**
 * 注册 Aider CLI Agent 到 AgentRegistry
 *
 * 这个是真正的 Aider CLI，与 aider.ts (OpenRouter 版本) 不同
 *
 * @param model - 可选的模型名称
 * @param yolo - 是否启用自动确认模式
 */
export function registerAiderCliAgent(model?: string, yolo: boolean = false): void {
    const selectedModel = getAiderModel(model);

    logger.debug('[Aider-CLI] Registering agent', {
        model: selectedModel,
        yolo
    });

    AgentRegistry.register('aider-cli', () => new AiderCliBackend({
        model: selectedModel,
        yesAlways: true,  // 总是启用，否则会卡住
        stream: true,
        autoCommit: false  // 让用户控制 git
    }));
}
