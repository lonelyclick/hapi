import type { AgentMessage } from '@/agent/types';
import { logger } from '@/ui/logger';

/**
 * Cursor CLI stream-json 事件类型
 *
 * 基于 https://cursor.com/docs/cli/headless 文档
 * 事件类型:
 * - system: 系统信息（模型等）
 * - assistant: 助手消息（增量文本）
 * - tool_call: 工具调用（started/completed）
 * - result: 完成结果
 */

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

export class CursorStreamParser {
    private buffer = '';
    private readonly toolCalls = new Map<string, { name: string; input: unknown }>();
    private toolCallCounter = 0;

    constructor(private readonly onMessage: (msg: AgentMessage) => void) {}

    /**
     * 处理从 stdout 接收的数据块
     */
    handleChunk(chunk: string): void {
        logger.debug('[Cursor] Received chunk', { length: chunk.length });

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
            logger.debug('[Cursor][stderr]', trimmed.slice(0, 500));
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
            logger.warn('[Cursor] Failed to parse JSON line', {
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
            logger.debug('[Cursor] Received non-object event', { event });
            return;
        }

        const type = asString(event.type);
        logger.debug('[Cursor] Parsed event', { type });

        switch (type) {
            case 'system':
                this.handleSystemEvent(event);
                break;

            case 'assistant':
                this.handleAssistantEvent(event);
                break;

            case 'tool_call':
                this.handleToolCallEvent(event);
                break;

            case 'result':
                this.handleResultEvent(event);
                break;

            case 'error':
                this.handleErrorEvent(event);
                break;

            default:
                logger.debug('[Cursor] Unknown event type', { type, event });
        }
    }

    /**
     * 处理 system 事件
     */
    private handleSystemEvent(event: Record<string, unknown>): void {
        const model = asString(event.model);
        logger.debug('[Cursor] System event', { model, timestamp: event.timestamp });
    }

    /**
     * 处理 assistant 事件（增量文本）
     */
    private handleAssistantEvent(event: Record<string, unknown>): void {
        const content = event.content;
        if (!Array.isArray(content)) {
            logger.debug('[Cursor] Assistant event without content array', { event });
            return;
        }

        for (const block of content) {
            if (isObject(block) && block.type === 'text') {
                const text = asString(block.text);
                if (text) {
                    this.onMessage({ type: 'text', text });
                }
            }
        }
    }

    /**
     * 处理 tool_call 事件
     */
    private handleToolCallEvent(event: Record<string, unknown>): void {
        const subtype = asString(event.subtype);
        const toolId = asString(event.id) ?? `cursor-tool-${++this.toolCallCounter}`;
        const toolName = asString(event.name) ?? 'tool';

        logger.debug('[Cursor] Tool call event', { subtype, toolId, toolName });

        if (subtype === 'started') {
            const input = event.input ?? null;
            this.toolCalls.set(toolId, { name: toolName, input });

            this.onMessage({
                type: 'tool_call',
                id: toolId,
                name: toolName,
                input,
                status: 'in_progress'
            });
        } else if (subtype === 'completed') {
            const cached = this.toolCalls.get(toolId);
            const output = event.output ?? null;

            this.onMessage({
                type: 'tool_result',
                id: toolId,
                output,
                status: 'completed'
            });

            this.toolCalls.delete(toolId);
            logger.debug('[Cursor] Tool call completed', { toolId, hasOutput: output !== null });
        } else if (subtype === 'failed') {
            const error = event.error ?? event.output ?? 'Tool call failed';

            this.onMessage({
                type: 'tool_result',
                id: toolId,
                output: error,
                status: 'failed'
            });

            this.toolCalls.delete(toolId);
            logger.debug('[Cursor] Tool call failed', { toolId, error });
        } else {
            logger.debug('[Cursor] Unknown tool_call subtype', { subtype, event });
        }
    }

    /**
     * 处理 result 事件
     */
    private handleResultEvent(event: Record<string, unknown>): void {
        const stopReason = asString(event.stop_reason) ?? 'end_turn';
        const durationMs = typeof event.duration_ms === 'number' ? event.duration_ms : undefined;

        logger.debug('[Cursor] Result event', { stopReason, durationMs });

        // 确保所有未完成的工具调用都标记为失败
        for (const [toolId, { name }] of this.toolCalls) {
            logger.warn('[Cursor] Tool call not completed before result', { toolId, name });
            this.onMessage({
                type: 'tool_result',
                id: toolId,
                output: 'Tool call interrupted',
                status: 'failed'
            });
        }
        this.toolCalls.clear();

        this.onMessage({ type: 'turn_complete', stopReason });
    }

    /**
     * 处理 error 事件
     */
    private handleErrorEvent(event: Record<string, unknown>): void {
        const message = asString(event.message) ?? asString(event.error) ?? 'Unknown error';
        logger.warn('[Cursor] Error event', { message });
        this.onMessage({ type: 'error', message });
    }

    /**
     * 获取剩余的 buffer（用于调试）
     */
    getRemaining(): string {
        return this.buffer;
    }

    /**
     * 获取未完成的工具调用数量
     */
    getPendingToolCalls(): number {
        return this.toolCalls.size;
    }
}
