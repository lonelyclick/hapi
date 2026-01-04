import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
    AgentBackend,
    AgentMessage,
    AgentSessionConfig,
    HistoryMessage,
    PermissionRequest,
    PermissionResponse,
    PromptContent
} from '@/agent/types';
import { logger } from '@/ui/logger';
import { killProcessByChildProcess } from '@/utils/process';
import { CursorStreamParser } from './CursorStreamParser';

type CursorSession = {
    id: string;
    config: AgentSessionConfig;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    abortController: AbortController | null;
    childProcess: ChildProcessWithoutNullStreams | null;
};

export type CursorBackendOptions = {
    apiKey: string;
    autoConfirm?: boolean;
};

export class CursorBackend implements AgentBackend {
    private readonly apiKey: string;
    private readonly autoConfirm: boolean;
    private readonly sessions = new Map<string, CursorSession>();
    private permissionHandler: ((request: PermissionRequest) => void) | null = null;

    constructor(options: CursorBackendOptions) {
        this.apiKey = options.apiKey;
        this.autoConfirm = options.autoConfirm ?? false;
        logger.debug('[Cursor] Backend created', { autoConfirm: this.autoConfirm });
    }

    /**
     * 初始化 Backend，验证 cursor-agent 是否可用
     */
    async initialize(): Promise<void> {
        logger.debug('[Cursor] Initializing backend...');

        // 验证 API key
        if (!this.apiKey) {
            const error = 'Cursor API key not configured. Set CURSOR_API_KEY environment variable.';
            logger.warn('[Cursor]', error);
            throw new Error(error);
        }

        // 验证 cursor-agent 是否在 PATH 中
        try {
            await this.checkCursorAgentExists();
            logger.debug('[Cursor] cursor-agent found in PATH');
        } catch (error) {
            logger.warn('[Cursor] cursor-agent not found', error);
            throw error;
        }

        logger.debug('[Cursor] Backend initialized successfully');
    }

    /**
     * 检查 cursor-agent 是否存在
     */
    private async checkCursorAgentExists(): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn('cursor-agent', ['--version'], {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('error', (error) => {
                const message = error.message;
                const isNotFound = message.includes('ENOENT') || message.includes('not found');
                reject(new Error(
                    isNotFound
                        ? 'cursor-agent not found. Install Cursor CLI from https://cursor.sh'
                        : `Failed to run cursor-agent: ${message}`
                ));
            });

            child.on('exit', (code) => {
                if (code === 0) {
                    logger.debug('[Cursor] cursor-agent version:', stdout.trim());
                    resolve();
                } else {
                    reject(new Error(`cursor-agent exited with code ${code}: ${stderr}`));
                }
            });
        });
    }

    /**
     * 创建新会话
     */
    async newSession(config: AgentSessionConfig): Promise<string> {
        const sessionId = randomUUID();

        const session: CursorSession = {
            id: sessionId,
            config,
            messages: [],
            abortController: null,
            childProcess: null
        };

        this.sessions.set(sessionId, session);
        logger.debug('[Cursor] Created session', { sessionId, cwd: config.cwd });

        return sessionId;
    }

    /**
     * 发送 prompt 并处理响应
     */
    async prompt(
        sessionId: string,
        content: PromptContent[],
        onUpdate: (msg: AgentMessage) => void
    ): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            const error = `Session not found: ${sessionId}`;
            logger.warn('[Cursor]', error);
            throw new Error(error);
        }

        const userMessage = content.map(c => c.text).join('\n');
        session.messages.push({ role: 'user', content: userMessage });

        logger.debug('[Cursor] Starting prompt', {
            sessionId,
            messageLength: userMessage.length,
            cwd: session.config.cwd
        });

        // 构建命令参数
        const args = this.buildArgs(userMessage);
        logger.debug('[Cursor] Spawning cursor-agent', { argsCount: args.length });

        session.abortController = new AbortController();

        const parser = new CursorStreamParser(onUpdate);
        let assistantContent = '';

        try {
            assistantContent = await this.runCursorProcess(session, args, parser, onUpdate);

            // 保存助手响应
            if (assistantContent) {
                session.messages.push({ role: 'assistant', content: assistantContent });
            }

            logger.debug('[Cursor] Prompt completed', {
                sessionId,
                responseLength: assistantContent.length
            });
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                logger.debug('[Cursor] Prompt cancelled', { sessionId });
                onUpdate({ type: 'turn_complete', stopReason: 'cancelled' });
                return;
            }

            logger.warn('[Cursor] Prompt failed', {
                sessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        } finally {
            session.childProcess = null;
            session.abortController = null;
        }
    }

    /**
     * 构建 cursor-agent 命令行参数
     */
    private buildArgs(message: string): string[] {
        const args: string[] = [
            '-p',                           // print mode (非交互)
            '--output-format', 'stream-json', // 结构化 JSON 输出
            '--stream-partial-output'       // 增量输出
        ];

        // 自动确认文件修改
        if (this.autoConfirm) {
            args.push('--force');
        }

        // 添加消息
        args.push(message);

        return args;
    }

    /**
     * 运行 cursor-agent 进程
     */
    private async runCursorProcess(
        session: CursorSession,
        args: string[],
        parser: CursorStreamParser,
        onUpdate: (msg: AgentMessage) => void
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const env = {
                ...process.env,
                CURSOR_API_KEY: this.apiKey
            };

            const child = spawn('cursor-agent', args, {
                cwd: session.config.cwd,
                env,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            session.childProcess = child;

            let textContent = '';
            let lastStderr = '';

            // 处理 stdout
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk: string) => {
                parser.handleChunk(chunk);

                // 收集文本用于历史记录
                // 通过监听 text 消息来累积
            });

            // 包装 onUpdate 以收集文本
            const originalOnUpdate = parser['onMessage'];
            parser['onMessage'] = (msg: AgentMessage) => {
                if (msg.type === 'text') {
                    textContent += msg.text;
                }
                onUpdate(msg);
            };

            // 处理 stderr
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk: string) => {
                lastStderr = chunk;
                parser.handleStderr(chunk);
            });

            // 处理进程退出
            child.on('exit', (code, signal) => {
                logger.debug('[Cursor] Process exited', { code, signal });

                if (code === 0 || signal === 'SIGTERM') {
                    // 检查是否有未处理的 buffer
                    const remaining = parser.getRemaining();
                    if (remaining) {
                        logger.debug('[Cursor] Remaining buffer after exit', {
                            length: remaining.length
                        });
                    }

                    // 检查是否有未完成的工具调用
                    const pendingTools = parser.getPendingToolCalls();
                    if (pendingTools > 0) {
                        logger.warn('[Cursor] Pending tool calls at exit', { count: pendingTools });
                    }

                    resolve(textContent);
                } else {
                    const errorMsg = `cursor-agent exited with code ${code}`;
                    logger.warn('[Cursor] Unexpected exit', {
                        code,
                        signal,
                        stderr: lastStderr.slice(0, 500)
                    });
                    onUpdate({ type: 'error', message: errorMsg });
                    reject(new Error(`${errorMsg}${lastStderr ? `: ${lastStderr}` : ''}`));
                }
            });

            // 处理进程错误
            child.on('error', (error) => {
                logger.warn('[Cursor] Process error', {
                    error: error.message,
                    stack: error.stack
                });

                const message = error.message;
                const isNotFound = message.includes('ENOENT') || message.includes('not found');

                if (isNotFound) {
                    reject(new Error(
                        'cursor-agent not found. Install Cursor CLI from https://cursor.sh'
                    ));
                } else {
                    reject(error);
                }
            });

            // 处理取消
            session.abortController?.signal.addEventListener('abort', () => {
                logger.debug('[Cursor] Abort signal received, killing process');
                child.kill('SIGTERM');

                // 强制 kill 超时
                setTimeout(() => {
                    if (!child.killed) {
                        logger.debug('[Cursor] Force killing process');
                        child.kill('SIGKILL');
                    }
                }, 2000);
            });

            // 关闭 stdin（cursor-agent 不需要输入）
            child.stdin.end();
        });
    }

    /**
     * 取消正在进行的 prompt
     */
    async cancelPrompt(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            logger.debug('[Cursor] Cannot cancel: session not found', { sessionId });
            return;
        }

        logger.debug('[Cursor] Cancelling prompt', { sessionId });

        if (session.abortController) {
            session.abortController.abort();
        }

        if (session.childProcess && !session.childProcess.killed) {
            await killProcessByChildProcess(session.childProcess);
        }
    }

    /**
     * 响应权限请求
     * Cursor CLI 在 --force 模式下不需要权限确认
     */
    async respondToPermission(
        _sessionId: string,
        _request: PermissionRequest,
        _response: PermissionResponse
    ): Promise<void> {
        // Cursor CLI 使用 --force 自动确认，不需要权限处理
        logger.debug('[Cursor] respondToPermission called (no-op for Cursor CLI)');
    }

    /**
     * 注册权限请求处理器
     */
    onPermissionRequest(handler: (request: PermissionRequest) => void): void {
        this.permissionHandler = handler;
        logger.debug('[Cursor] Permission handler registered');
    }

    /**
     * 断开连接，清理所有会话
     */
    async disconnect(): Promise<void> {
        logger.debug('[Cursor] Disconnecting, cleaning up sessions', {
            sessionCount: this.sessions.size
        });

        for (const session of this.sessions.values()) {
            if (session.abortController) {
                session.abortController.abort();
            }
            if (session.childProcess && !session.childProcess.killed) {
                await killProcessByChildProcess(session.childProcess);
            }
        }

        this.sessions.clear();
        logger.debug('[Cursor] Disconnected');
    }

    /**
     * 恢复历史消息
     */
    restoreHistory(sessionId: string, messages: HistoryMessage[]): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            logger.debug('[Cursor] Cannot restore history: session not found', { sessionId });
            return;
        }

        for (const msg of messages) {
            session.messages.push({
                role: msg.role,
                content: msg.content
            });
        }

        logger.debug('[Cursor] Restored history', {
            sessionId,
            count: messages.length
        });
    }
}
