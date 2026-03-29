import type { AgentMessage } from '@/agent/types';
import { logger } from '@/ui/logger';

/**
 * Factory Droid CLI stream-json 事件解析器
 *
 * 事件类型（来自实际抓取）：
 * - system (subtype: init): 会话初始化，包含 session_id、model、tools
 * - message (role: user): 用户消息（忽略）
 * - message (role: assistant): 助手文本消息
 * - tool_call: 工具调用，包含 id、toolName、parameters
 * - tool_result: 工具执行结果，包含 id、value、isError
 * - completion: 完成事件，包含 finalText、numTurns、durationMs、session_id
 */

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

export class DroidStreamParser {
    private buffer = '';
    private _droidSessionId: string | null = null;
    private _model: string | null = null;

    constructor(private readonly onMessage: (msg: AgentMessage) => void) {}

    get droidSessionId(): string | null {
        return this._droidSessionId;
    }

    get model(): string | null {
        return this._model;
    }

    /**
     * 处理从 stdout 接收的数据块
     */
    handleChunk(chunk: string): void {
        logger.debug('[Droid] Received chunk', { length: chunk.length });

        this.buffer += chunk;
        let newlineIndex = this.buffer.indexOf('\n');

        while (newlineIndex >= 0) {
            const line = this.buffer.slice(0, newlineIndex).trim();
            this.buffer = this.buffer.slice(newlineIndex + 1);

            if (line.length > 0) {
                this.parseLine(line);
            }

            newlineIndex = this.buffer.indexOf('\n');
        }
    }

    /**
     * 处理 stderr 输出
     */
    handleStderr(chunk: string): void {
        const trimmed = chunk.trim();
        if (trimmed) {
            logger.debug('[Droid][stderr]', trimmed.slice(0, 500));
        }
    }

    /**
     * 解析单行 JSON
     */
    private parseLine(line: string): void {
        let event: unknown;
        try {
            event = JSON.parse(line);
        } catch (error) {
            logger.warn('[Droid] Failed to parse JSON line', {
                line: line.slice(0, 200),
                error: error instanceof Error ? error.message : String(error)
            });
            return;
        }

        this.handleEvent(event);
    }

    /**
     * 处理解析后的事件
     */
    private handleEvent(event: unknown): void {
        if (!isObject(event)) {
            logger.debug('[Droid] Received non-object event', { event });
            return;
        }

        const type = asString(event.type);
        logger.debug('[Droid] Parsed event', { type });

        switch (type) {
            case 'system':
                this.handleSystemEvent(event);
                break;

            case 'message':
                this.handleMessageEvent(event);
                break;

            case 'tool_call':
                this.handleToolCallEvent(event);
                break;

            case 'tool_result':
                this.handleToolResultEvent(event);
                break;

            case 'completion':
                this.handleCompletionEvent(event);
                break;

            case 'error':
                this.handleErrorEvent(event);
                break;

            default:
                logger.debug('[Droid] Unknown event type', { type, event });
        }
    }

    /**
     * 处理 system 事件（会话初始化）
     */
    private handleSystemEvent(event: Record<string, unknown>): void {
        const sessionId = asString(event.session_id);
        const model = asString(event.model);

        if (sessionId) {
            this._droidSessionId = sessionId;
        }
        if (model) {
            this._model = model;
        }

        logger.debug('[Droid] System event', {
            subtype: event.subtype,
            sessionId,
            model,
            toolCount: Array.isArray(event.tools) ? event.tools.length : 0
        });
    }

    /**
     * 处理 message 事件
     * role: user → 忽略（我们自己发的）
     * role: assistant → 转为 AgentMessage text
     */
    private handleMessageEvent(event: Record<string, unknown>): void {
        const role = asString(event.role);

        if (role === 'user') {
            // 忽略用户消息回显
            return;
        }

        if (role === 'assistant') {
            const text = asString(event.text);
            if (text) {
                this.onMessage({ type: 'text', text });
            }
            return;
        }

        logger.debug('[Droid] Unknown message role', { role, event });
    }

    /**
     * 处理 tool_call 事件
     * 格式: { id, toolName, parameters, ... }
     */
    private handleToolCallEvent(event: Record<string, unknown>): void {
        const id = asString(event.id) ?? `droid-tool-${Date.now()}`;
        const name = asString(event.toolName) ?? asString(event.toolId) ?? 'tool';
        const input = event.parameters ?? null;

        logger.debug('[Droid] Tool call', { id, name });

        this.onMessage({
            type: 'tool_call',
            id,
            name,
            input,
            status: 'in_progress'
        });
    }

    /**
     * 处理 tool_result 事件
     * 格式: { id, toolId, value, isError, ... }
     */
    private handleToolResultEvent(event: Record<string, unknown>): void {
        const id = asString(event.id) ?? `droid-tool-${Date.now()}`;
        const output = event.value ?? null;
        const isError = event.isError === true;

        logger.debug('[Droid] Tool result', { id, isError, hasOutput: output !== null });

        this.onMessage({
            type: 'tool_result',
            id,
            output,
            status: isError ? 'failed' : 'completed'
        });
    }

    /**
     * 处理 completion 事件（会话完成）
     */
    private handleCompletionEvent(event: Record<string, unknown>): void {
        const sessionId = asString(event.session_id);
        const numTurns = typeof event.numTurns === 'number' ? event.numTurns : undefined;
        const durationMs = typeof event.durationMs === 'number' ? event.durationMs : undefined;

        if (sessionId) {
            this._droidSessionId = sessionId;
        }

        logger.debug('[Droid] Completion', { sessionId, numTurns, durationMs });

        this.onMessage({ type: 'turn_complete', stopReason: 'end_turn' });
    }

    /**
     * 处理 error 事件
     */
    private handleErrorEvent(event: Record<string, unknown>): void {
        const message = asString(event.message) ?? asString(event.error) ?? 'Unknown error';
        logger.warn('[Droid] Error event', { message });
        this.onMessage({ type: 'error', message });
    }

    /**
     * 获取剩余的 buffer（用于调试）
     */
    getRemaining(): string {
        return this.buffer;
    }
}
