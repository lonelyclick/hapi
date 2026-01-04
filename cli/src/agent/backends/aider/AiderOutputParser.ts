import type { AgentMessage } from '@/agent/types';
import { logger } from '@/ui/logger';

/**
 * Aider CLI 输出解析器
 *
 * Aider 没有结构化的 JSON 输出，只有终端文本。
 * 这个解析器使用启发式方法检测:
 * - 文件头: ─────── file.ts ───────
 * - Diff 块: <<<<<<< SEARCH / ======= / >>>>>>> REPLACE
 * - 思考指示: Thinking...
 * - 错误: Error: ...
 *
 * 主要策略是文本直传，工具检测作为尽力而为。
 */

// ANSI 转义码正则表达式
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;

export class AiderOutputParser {
    private textBuffer = '';
    private lastError: string | null = null;
    private inDiffBlock = false;
    private currentFile: string | null = null;
    private diffContent = '';
    private toolCallCounter = 0;
    private searchContent = '';
    private replaceContent = '';
    private inSearchSection = false;
    private inReplaceSection = false;

    // 检测模式
    private readonly patterns = {
        // 文件头: ─────── filename ───────
        fileHeader: /^[─━]+\s*(.+?)\s*[─━]+$/,
        // Diff 开始
        searchStart: /^<<<<<<+\s*SEARCH\s*$/i,
        // Diff 分隔
        divider: /^=+$/,
        // Diff 结束
        replaceEnd: /^>>>>>>+\s*REPLACE\s*$/i,
        // 思考指示
        thinking: /^(Thinking|Processing|Analyzing|Searching|Reading)\s*\.{0,3}$/i,
        // 错误
        error: /^Error:\s*(.+)$/i,
        // Commit 消息
        commit: /^Commit\s+[a-f0-9]+:/i,
        // 添加到聊天
        addedToChat: /^Added\s+(.+?)\s+to the chat/i,
        // 应用编辑
        appliedEdit: /^Applied\s+edit\s+to\s+(.+)/i,
        // 创建文件
        createdFile: /^Created\s+new\s+file\s+(.+)/i
    };

    constructor(private readonly onMessage: (msg: AgentMessage) => void) {}

    /**
     * 处理 stdout 数据块
     */
    handleChunk(chunk: string): void {
        logger.debug('[Aider] Received stdout chunk', { length: chunk.length });

        // 剥离 ANSI 转义码
        const clean = this.stripAnsi(chunk);

        const lines = clean.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // 最后一行可能是不完整的，保留
            if (i === lines.length - 1 && !chunk.endsWith('\n')) {
                this.textBuffer += line;
            } else {
                const fullLine = this.textBuffer + line;
                this.textBuffer = '';
                this.processLine(fullLine);
            }
        }
    }

    /**
     * 处理 stderr 数据块
     */
    handleStderr(chunk: string): void {
        const clean = this.stripAnsi(chunk).trim();
        if (!clean) return;

        logger.debug('[Aider] stderr content', { preview: clean.slice(0, 200) });

        // 检查是否是错误
        const errorMatch = clean.match(this.patterns.error);
        if (errorMatch) {
            this.lastError = errorMatch[1];
            logger.warn('[Aider] Detected error in stderr', { error: this.lastError });
        }
    }

    /**
     * 处理单行
     */
    private processLine(line: string): void {
        const trimmed = line.trim();

        // 检查文件头
        const fileMatch = trimmed.match(this.patterns.fileHeader);
        if (fileMatch) {
            this.finalizeDiffBlock();
            this.currentFile = fileMatch[1].trim();
            logger.debug('[Aider] Detected file header', { filename: this.currentFile });
            this.emitToolCall('file_read', { path: this.currentFile });
            return;
        }

        // 检查 diff 块开始
        if (this.patterns.searchStart.test(trimmed)) {
            logger.debug('[Aider] Detected diff block start (SEARCH)');
            this.inDiffBlock = true;
            this.inSearchSection = true;
            this.inReplaceSection = false;
            this.searchContent = '';
            this.replaceContent = '';
            return;
        }

        // 在 diff 块中
        if (this.inDiffBlock) {
            // 检查分隔符
            if (this.patterns.divider.test(trimmed)) {
                logger.debug('[Aider] Detected diff divider');
                this.inSearchSection = false;
                this.inReplaceSection = true;
                return;
            }

            // 检查 diff 块结束
            if (this.patterns.replaceEnd.test(trimmed)) {
                logger.debug('[Aider] Detected diff block end (REPLACE)');
                this.finalizeDiffBlock();
                return;
            }

            // 收集 diff 内容
            if (this.inSearchSection) {
                this.searchContent += line + '\n';
            } else if (this.inReplaceSection) {
                this.replaceContent += line + '\n';
            }
            return;
        }

        // 检查思考指示
        if (this.patterns.thinking.test(trimmed)) {
            logger.debug('[Aider] Detected thinking indicator', { line: trimmed });
            this.onMessage({ type: 'reasoning', text: trimmed + '\n' });
            return;
        }

        // 检查错误
        const errorMatch = trimmed.match(this.patterns.error);
        if (errorMatch) {
            this.lastError = errorMatch[1];
            logger.warn('[Aider] Detected error in output', { error: this.lastError });
            this.onMessage({ type: 'error', message: this.lastError });
            return;
        }

        // 检查文件操作
        const addedMatch = trimmed.match(this.patterns.addedToChat);
        if (addedMatch) {
            logger.debug('[Aider] File added to chat', { file: addedMatch[1] });
            this.emitToolCall('file_add', { path: addedMatch[1] });
            this.emitToolResult('file_add', { path: addedMatch[1], status: 'added' });
        }

        const appliedMatch = trimmed.match(this.patterns.appliedEdit);
        if (appliedMatch) {
            logger.debug('[Aider] Edit applied', { file: appliedMatch[1] });
            this.emitToolCall('file_edit', { path: appliedMatch[1] });
            this.emitToolResult('file_edit', { path: appliedMatch[1], status: 'applied' });
        }

        const createdMatch = trimmed.match(this.patterns.createdFile);
        if (createdMatch) {
            logger.debug('[Aider] File created', { file: createdMatch[1] });
            this.emitToolCall('file_create', { path: createdMatch[1] });
            this.emitToolResult('file_create', { path: createdMatch[1], status: 'created' });
        }

        // 普通文本输出
        if (trimmed) {
            this.onMessage({ type: 'text', text: line + '\n' });
        }
    }

    /**
     * 完成 diff 块处理
     */
    private finalizeDiffBlock(): void {
        if (this.inDiffBlock && this.currentFile) {
            const diff = {
                file: this.currentFile,
                search: this.searchContent.trim(),
                replace: this.replaceContent.trim()
            };

            logger.debug('[Aider] Finalized diff block', {
                file: this.currentFile,
                searchLength: this.searchContent.length,
                replaceLength: this.replaceContent.length
            });

            this.emitToolResult('file_edit', diff);
        }

        this.inDiffBlock = false;
        this.inSearchSection = false;
        this.inReplaceSection = false;
        this.searchContent = '';
        this.replaceContent = '';
    }

    /**
     * 发送工具调用消息
     */
    private emitToolCall(operation: string, input: unknown): void {
        const id = `aider-tool-${++this.toolCallCounter}`;
        logger.debug('[Aider] Emitting tool_call', { id, operation });

        this.onMessage({
            type: 'tool_call',
            id,
            name: operation,
            input,
            status: 'in_progress'
        });
    }

    /**
     * 发送工具结果消息
     */
    private emitToolResult(operation: string, output: unknown): void {
        const id = `aider-tool-${this.toolCallCounter}`;
        logger.debug('[Aider] Emitting tool_result', { id, operation });

        this.onMessage({
            type: 'tool_result',
            id,
            output,
            status: 'completed'
        });
    }

    /**
     * 获取累积的文本
     */
    getAccumulatedText(): string {
        // 处理剩余的 buffer
        if (this.textBuffer) {
            this.processLine(this.textBuffer);
            this.textBuffer = '';
        }
        return '';  // 文本已经通过 onMessage 发送
    }

    /**
     * 获取最后的错误
     */
    getLastError(): string | null {
        return this.lastError;
    }

    /**
     * 剥离 ANSI 转义码
     */
    private stripAnsi(text: string): string {
        return text.replace(ANSI_REGEX, '');
    }

    /**
     * 完成解析（清理状态）
     */
    finalize(): void {
        // 处理任何剩余的 diff 块
        this.finalizeDiffBlock();

        // 处理剩余的 buffer
        if (this.textBuffer) {
            this.processLine(this.textBuffer);
            this.textBuffer = '';
        }

        logger.debug('[Aider] Parser finalized');
    }
}
