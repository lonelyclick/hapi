import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { AiderOutputParser } from './AiderOutputParser';

type AiderSession = {
    id: string;
    config: AgentSessionConfig;
    historyMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
    abortController: AbortController | null;
    childProcess: ChildProcessWithoutNullStreams | null;
    tempMessageFile: string | null;
};

export type AiderCliBackendOptions = {
    model?: string;
    openrouterApiKey?: string;
    yesAlways?: boolean;
    stream?: boolean;
    autoCommit?: boolean;
};

// 默认模型 - 使用 OpenRouter 格式
const DEFAULT_MODEL = 'openrouter/anthropic/claude-sonnet-4';

// 临时文件目录
const TEMP_DIR = join(tmpdir(), 'hapi-aider');

export class AiderCliBackend implements AgentBackend {
    private readonly model: string;
    private readonly openrouterApiKey: string | undefined;
    private readonly yesAlways: boolean;
    private readonly streamOutput: boolean;
    private readonly autoCommit: boolean;
    private readonly sessions = new Map<string, AiderSession>();
    private permissionHandler: ((request: PermissionRequest) => void) | null = null;

    constructor(options: AiderCliBackendOptions = {}) {
        this.model = options.model ?? DEFAULT_MODEL;
        this.openrouterApiKey = options.openrouterApiKey;
        this.yesAlways = options.yesAlways ?? true;
        this.streamOutput = options.stream ?? true;
        this.autoCommit = options.autoCommit ?? false;

        logger.debug('[Aider] Backend created', {
            model: this.model,
            hasApiKey: !!this.openrouterApiKey,
            yesAlways: this.yesAlways,
            stream: this.streamOutput,
            autoCommit: this.autoCommit
        });
    }

    /**
     * 初始化 Backend，验证 aider 是否可用
     */
    async initialize(): Promise<void> {
        logger.debug('[Aider] Initializing backend...');

        // 验证 aider 是否在 PATH 中
        try {
            await this.checkAiderExists();
            logger.debug('[Aider] aider found in PATH');
        } catch (error) {
            logger.warn('[Aider] aider not found', error);
            throw error;
        }

        // 确保临时目录存在
        try {
            if (!existsSync(TEMP_DIR)) {
                mkdirSync(TEMP_DIR, { recursive: true });
                logger.debug('[Aider] Created temp directory', { path: TEMP_DIR });
            }
        } catch (error) {
            logger.warn('[Aider] Failed to create temp directory', { path: TEMP_DIR, error });
            // 不是致命错误，继续
        }

        logger.debug('[Aider] Backend initialized successfully');
    }

    /**
     * 检查 aider 是否存在
     */
    private async checkAiderExists(): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn('aider', ['--version'], {
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
                        ? 'aider not found. Install with: pip install aider-chat'
                        : `Failed to run aider: ${message}`
                ));
            });

            child.on('exit', (code) => {
                if (code === 0) {
                    logger.debug('[Aider] aider version:', stdout.trim());
                    resolve();
                } else {
                    // aider --version 可能返回非零，检查是否有版本输出
                    if (stdout.includes('aider') || stderr.includes('aider')) {
                        logger.debug('[Aider] aider detected (non-zero exit)', { stdout, stderr });
                        resolve();
                    } else {
                        reject(new Error(`aider exited with code ${code}: ${stderr}`));
                    }
                }
            });
        });
    }

    /**
     * 创建新会话
     */
    async newSession(config: AgentSessionConfig): Promise<string> {
        const sessionId = randomUUID();

        const session: AiderSession = {
            id: sessionId,
            config,
            historyMessages: [],
            abortController: null,
            childProcess: null,
            tempMessageFile: null
        };

        this.sessions.set(sessionId, session);
        logger.debug('[Aider] Created session', { sessionId, cwd: config.cwd });

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
            logger.warn('[Aider]', error);
            throw new Error(error);
        }

        const userMessage = content.map(c => c.text).join('\n');
        session.historyMessages.push({ role: 'user', content: userMessage });

        logger.debug('[Aider] Starting prompt', {
            sessionId,
            messageLength: userMessage.length,
            cwd: session.config.cwd
        });

        // 构建命令参数
        const args = this.buildArgs(session, userMessage);
        logger.debug('[Aider] Spawning aider', { argsCount: args.length });

        session.abortController = new AbortController();

        const parser = new AiderOutputParser(onUpdate);
        let assistantContent = '';

        try {
            assistantContent = await this.runAiderProcess(session, args, parser, onUpdate);

            // 完成解析
            parser.finalize();

            // 保存助手响应
            if (assistantContent) {
                session.historyMessages.push({ role: 'assistant', content: assistantContent });
            }

            onUpdate({ type: 'turn_complete', stopReason: 'end_turn' });

            logger.debug('[Aider] Prompt completed', {
                sessionId,
                responseLength: assistantContent.length
            });
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                logger.debug('[Aider] Prompt cancelled', { sessionId });
                onUpdate({ type: 'turn_complete', stopReason: 'cancelled' });
                return;
            }

            logger.warn('[Aider] Prompt failed', {
                sessionId,
                error: error instanceof Error ? error.message : String(error)
            });

            // 发送错误消息
            const errorMessage = error instanceof Error ? error.message : String(error);
            onUpdate({ type: 'error', message: errorMessage });
            onUpdate({ type: 'turn_complete', stopReason: 'error' });
        } finally {
            this.cleanupSession(session);
        }
    }

    /**
     * 构建 aider 命令行参数
     */
    private buildArgs(session: AiderSession, message: string): string[] {
        const args: string[] = [];

        // 消息模式 - 短消息用 -m，长消息用 --message-file
        if (message.length < 2000) {
            args.push('--message', message);
        } else {
            const tempFile = this.createTempMessageFile(message);
            session.tempMessageFile = tempFile;
            args.push('--message-file', tempFile);
            logger.debug('[Aider] Using temp message file', {
                path: tempFile,
                messageLength: message.length
            });
        }

        // 自动确认
        if (this.yesAlways) {
            args.push('--yes-always');
        }

        // 流式输出
        if (this.streamOutput) {
            args.push('--stream');
        } else {
            args.push('--no-stream');
        }

        // 模型
        if (this.model) {
            args.push('--model', this.model);
        }

        // OpenRouter API Key
        if (this.openrouterApiKey) {
            args.push('--api-key', `openrouter=${this.openrouterApiKey}`);
            logger.debug('[Aider] Added OpenRouter API key to args');
        }

        // Git 控制
        if (this.autoCommit) {
            args.push('--auto-commits');
        } else {
            args.push('--no-auto-commits');
        }

        // 禁用美化输出（减少 ANSI 码）
        args.push('--no-pretty');

        // 禁用交互式提示
        args.push('--no-suggest-shell-commands');

        return args;
    }

    /**
     * 创建临时消息文件
     */
    private createTempMessageFile(message: string): string {
        const filename = `msg-${Date.now()}-${randomUUID().slice(0, 8)}.txt`;
        const filepath = join(TEMP_DIR, filename);

        try {
            writeFileSync(filepath, message, 'utf8');
            logger.debug('[Aider] Created temp message file', { path: filepath });
            return filepath;
        } catch (error) {
            logger.warn('[Aider] Failed to create temp message file', { error });
            throw new Error(`Failed to create temp message file: ${error}`);
        }
    }

    /**
     * 运行 aider 进程
     */
    private async runAiderProcess(
        session: AiderSession,
        args: string[],
        parser: AiderOutputParser,
        _onUpdate: (msg: AgentMessage) => void
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const env = {
                ...process.env,
                // 强制非交互模式
                CI: '1',
                TERM: 'dumb',
                // 禁用颜色
                NO_COLOR: '1',
                FORCE_COLOR: '0'
            };

            logger.debug('[Aider] Spawning process', {
                cwd: session.config.cwd,
                argsPreview: args.slice(0, 5).join(' ')
            });

            const child = spawn('aider', args, {
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
                textContent += chunk;
                parser.handleChunk(chunk);
            });

            // 处理 stderr
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk: string) => {
                lastStderr = chunk;
                parser.handleStderr(chunk);
            });

            // 处理进程退出
            child.on('exit', (code, signal) => {
                logger.debug('[Aider] Process exited', { code, signal });

                if (code === 0 || signal === 'SIGTERM') {
                    resolve(textContent);
                } else {
                    const lastError = parser.getLastError();
                    const errorMsg = `aider exited with code ${code}`;

                    logger.warn('[Aider] Unexpected exit', {
                        code,
                        signal,
                        lastError,
                        stderrPreview: lastStderr.slice(0, 500)
                    });

                    reject(new Error(
                        `${errorMsg}${lastError ? `: ${lastError}` : (lastStderr ? `: ${lastStderr}` : '')}`
                    ));
                }
            });

            // 处理进程错误
            child.on('error', (error) => {
                logger.warn('[Aider] Process error', {
                    error: error.message,
                    stack: error.stack
                });

                const message = error.message;
                const isNotFound = message.includes('ENOENT') || message.includes('not found');

                if (isNotFound) {
                    reject(new Error(
                        'aider not found. Install with: pip install aider-chat'
                    ));
                } else {
                    reject(error);
                }
            });

            // 处理取消
            session.abortController?.signal.addEventListener('abort', () => {
                logger.debug('[Aider] Abort signal received, killing process');
                child.kill('SIGTERM');

                // 强制 kill 超时
                setTimeout(() => {
                    if (!child.killed) {
                        logger.debug('[Aider] Force killing process');
                        child.kill('SIGKILL');
                    }
                }, 2000);
            });

            // 关闭 stdin
            child.stdin.end();
        });
    }

    /**
     * 清理会话资源
     */
    private cleanupSession(session: AiderSession): void {
        // 删除临时消息文件
        if (session.tempMessageFile) {
            try {
                unlinkSync(session.tempMessageFile);
                logger.debug('[Aider] Deleted temp message file', { path: session.tempMessageFile });
            } catch (error) {
                logger.debug('[Aider] Failed to delete temp message file', {
                    path: session.tempMessageFile,
                    error
                });
                // 忽略清理错误
            }
            session.tempMessageFile = null;
        }

        session.childProcess = null;
        session.abortController = null;
    }

    /**
     * 取消正在进行的 prompt
     */
    async cancelPrompt(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            logger.debug('[Aider] Cannot cancel: session not found', { sessionId });
            return;
        }

        logger.debug('[Aider] Cancelling prompt', { sessionId });

        if (session.abortController) {
            session.abortController.abort();
        }

        if (session.childProcess && !session.childProcess.killed) {
            session.childProcess.kill('SIGTERM');

            // 强制 kill 超时
            setTimeout(async () => {
                if (session.childProcess && !session.childProcess.killed) {
                    await killProcessByChildProcess(session.childProcess, true);
                }
            }, 2000);
        }
    }

    /**
     * 响应权限请求
     * Aider CLI 使用 --yes-always，不需要权限确认
     */
    async respondToPermission(
        _sessionId: string,
        _request: PermissionRequest,
        _response: PermissionResponse
    ): Promise<void> {
        logger.debug('[Aider] respondToPermission called (no-op for Aider CLI)');
    }

    /**
     * 注册权限请求处理器
     */
    onPermissionRequest(handler: (request: PermissionRequest) => void): void {
        this.permissionHandler = handler;
        logger.debug('[Aider] Permission handler registered');
    }

    /**
     * 断开连接，清理所有会话
     */
    async disconnect(): Promise<void> {
        logger.debug('[Aider] Disconnecting, cleaning up sessions', {
            sessionCount: this.sessions.size
        });

        for (const session of this.sessions.values()) {
            if (session.abortController) {
                session.abortController.abort();
            }
            if (session.childProcess && !session.childProcess.killed) {
                await killProcessByChildProcess(session.childProcess);
            }
            this.cleanupSession(session);
        }

        this.sessions.clear();
        logger.debug('[Aider] Disconnected');
    }

    /**
     * 恢复历史消息
     */
    restoreHistory(sessionId: string, messages: HistoryMessage[]): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            logger.debug('[Aider] Cannot restore history: session not found', { sessionId });
            return;
        }

        for (const msg of messages) {
            session.historyMessages.push({
                role: msg.role,
                content: msg.content
            });
        }

        logger.debug('[Aider] Restored history', {
            sessionId,
            count: messages.length
        });
    }
}
