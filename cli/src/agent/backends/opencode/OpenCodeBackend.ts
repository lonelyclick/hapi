import { spawn, type ChildProcess } from 'node:child_process';
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

// OpenCode SDK types (simplified versions of what we need)
type OpencodeSession = {
    id: string;
    projectID: string;
    directory: string;
    title: string;
};

type OpencodeEvent =
    | { type: 'message.updated'; properties: { info: unknown } }
    | { type: 'message.part.updated'; properties: { part: unknown; delta?: string } }
    | { type: 'permission.updated'; properties: unknown }
    | { type: 'permission.replied'; properties: { sessionID: string; permissionID: string; response: string } }
    | { type: 'session.status'; properties: { sessionID: string; status: { type: string } } }
    | { type: 'session.idle'; properties: { sessionID: string } }
    | { type: string; properties: unknown };

type OpencodeTextPart = {
    type: 'text';
    text: string;
};

type OpencodeToolPart = {
    type: 'tool';
    tool: string;
    callID: string;
    state: {
        status: 'pending' | 'running' | 'completed' | 'error';
        input?: unknown;
        output?: string;
        title?: string;
        error?: string;
    };
};

type OpencodeReasoningPart = {
    type: 'reasoning';
    text: string;
};

type OpencodePart = OpencodeTextPart | OpencodeToolPart | OpencodeReasoningPart | { type: string };

type OpencodePermission = {
    id: string;
    type: string;
    sessionID: string;
    messageID: string;
    callID?: string;
    title: string;
    metadata: Record<string, unknown>;
};

type PromptState = {
    onUpdate: (msg: AgentMessage) => void;
    resolve: () => void;
    reject: (error: Error) => void;
};

type LocalSession = {
    id: string;
    opencodeSessionId: string | null;
    config: AgentSessionConfig;
    model: string;
    abortController: AbortController | null;
    pendingPermissions: Map<string, OpencodePermission>;
    promptState: PromptState | null;
};

export type OpenCodeBackendOptions = {
    /** OpenCode server hostname (default: 127.0.0.1) */
    hostname?: string;
    /** OpenCode server port (default: 4096) */
    port?: number;
    /** Default model to use (e.g., 'anthropic/claude-sonnet-4') */
    defaultModel?: string;
    /** Timeout for server startup in ms (default: 30000) */
    serverStartTimeout?: number;
    /** Whether to auto-start the OpenCode server (default: true) */
    autoStartServer?: boolean;
};

export class OpenCodeBackend implements AgentBackend {
    private readonly options: Required<OpenCodeBackendOptions>;
    private readonly sessions = new Map<string, LocalSession>();
    private serverProcess: ChildProcess | null = null;
    private serverUrl: string | null = null;
    private serverPassword: string | null = null;
    private permissionHandler: ((request: PermissionRequest) => void) | null = null;
    private eventSource: EventSource | null = null;
    private isConnected = false;

    constructor(options: OpenCodeBackendOptions = {}) {
        this.options = {
            hostname: options.hostname ?? '127.0.0.1',
            port: options.port ?? 4096,
            defaultModel: options.defaultModel ?? 'anthropic/claude-sonnet-4',
            serverStartTimeout: options.serverStartTimeout ?? 30000,
            autoStartServer: options.autoStartServer ?? true,
        };
    }

    private getAuthHeaders(): Record<string, string> {
        if (!this.serverPassword) {
            return {};
        }
        // HTTP Basic Auth: username is 'opencode', password is the generated password
        const credentials = Buffer.from(`opencode:${this.serverPassword}`).toString('base64');
        return { 'Authorization': `Basic ${credentials}` };
    }

    async initialize(): Promise<void> {
        logger.debug(`[OpenCode] Initializing with options:`, this.options);

        if (this.options.autoStartServer) {
            await this.startServer();
        } else {
            // Assume server is already running
            this.serverUrl = `http://${this.options.hostname}:${this.options.port}`;
        }

        // Test connection
        await this.testConnection();
        this.isConnected = true;

        logger.debug(`[OpenCode] Initialized successfully, server URL: ${this.serverUrl}`);
    }

    private async startServer(): Promise<void> {
        logger.debug('[OpenCode] Starting OpenCode server...');

        const args = [
            'serve',
            `--hostname=${this.options.hostname}`,
            `--port=${this.options.port}`
        ];

        // Generate a random password for server security
        this.serverPassword = randomUUID();

        this.serverProcess = spawn('opencode', args, {
            env: {
                ...process.env,
                OPENCODE_SERVER_PASSWORD: this.serverPassword,
                OPENCODE_CONFIG_CONTENT: JSON.stringify({
                    model: this.options.defaultModel,
                    permission: {
                        edit: 'ask',
                        bash: 'ask'
                    }
                })
            },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // Wait for server to start
        const url = await new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Timeout waiting for OpenCode server after ${this.options.serverStartTimeout}ms`));
            }, this.options.serverStartTimeout);

            let output = '';

            this.serverProcess?.stdout?.on('data', (chunk) => {
                output += chunk.toString();
                const lines = output.split('\n');
                for (const line of lines) {
                    if (line.includes('opencode server listening')) {
                        const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
                        if (match) {
                            clearTimeout(timeout);
                            resolve(match[1]);
                            return;
                        }
                    }
                }
            });

            this.serverProcess?.stderr?.on('data', (chunk) => {
                output += chunk.toString();
                logger.debug(`[OpenCode] Server stderr: ${chunk.toString()}`);
            });

            this.serverProcess?.on('error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Failed to start OpenCode server: ${error.message}`));
            });

            this.serverProcess?.on('exit', (code) => {
                if (!this.serverUrl) {
                    clearTimeout(timeout);
                    reject(new Error(`OpenCode server exited with code ${code}\nOutput: ${output}`));
                }
            });
        });

        this.serverUrl = url;
        logger.debug(`[OpenCode] Server started at ${url}`);
    }

    private async testConnection(): Promise<void> {
        const response = await fetch(`${this.serverUrl}/project/current`, {
            headers: this.getAuthHeaders()
        });
        if (!response.ok) {
            throw new Error(`Failed to connect to OpenCode server: ${response.status}`);
        }
    }

    async newSession(config: AgentSessionConfig): Promise<string> {
        if (!this.serverUrl) {
            throw new Error('OpenCode server not initialized');
        }

        const localSessionId = randomUUID();
        const model = (config as { model?: string }).model || this.options.defaultModel;

        // Create session in OpenCode
        const response = await fetch(`${this.serverUrl}/session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-opencode-directory': config.cwd
            },
            body: JSON.stringify({
                title: `HAPI Session ${localSessionId.slice(0, 8)}`
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create OpenCode session: ${response.status} ${errorText}`);
        }

        const sessionData = await response.json() as OpencodeSession;

        const session: LocalSession = {
            id: localSessionId,
            opencodeSessionId: sessionData.id,
            config,
            model,
            abortController: null,
            pendingPermissions: new Map(),
            promptState: null
        };

        this.sessions.set(localSessionId, session);
        logger.debug(`[OpenCode] Created session: ${localSessionId} -> OpenCode session: ${sessionData.id}`);

        // Start listening to events for this session
        this.subscribeToEvents(localSessionId, sessionData.id, config.cwd);

        return localSessionId;
    }

    private subscribeToEvents(localSessionId: string, opencodeSessionId: string, directory: string): void {
        // Use SSE to subscribe to events
        const eventUrl = `${this.serverUrl}/event?directory=${encodeURIComponent(directory)}`;

        // We use fetch with streaming instead of EventSource for better compatibility
        this.startEventStream(localSessionId, opencodeSessionId, eventUrl, directory);
    }

    private async startEventStream(
        localSessionId: string,
        opencodeSessionId: string,
        eventUrl: string,
        directory: string
    ): Promise<void> {
        try {
            const response = await fetch(eventUrl, {
                headers: {
                    'Accept': 'text/event-stream',
                    'x-opencode-directory': directory
                }
            });

            if (!response.ok || !response.body) {
                logger.debug(`[OpenCode] Failed to connect to event stream: ${response.status}`);
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            const readEvents = async () => {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6).trim();
                                if (data) {
                                    try {
                                        const event = JSON.parse(data) as OpencodeEvent;
                                        this.handleEvent(localSessionId, opencodeSessionId, event);
                                    } catch {
                                        // Skip invalid JSON
                                    }
                                }
                            }
                        }
                    }
                } catch (error) {
                    logger.debug(`[OpenCode] Event stream error:`, error);
                }
            };

            // Start reading events in the background
            readEvents();
        } catch (error) {
            logger.debug(`[OpenCode] Failed to start event stream:`, error);
        }
    }

    private handleEvent(localSessionId: string, opencodeSessionId: string, event: OpencodeEvent): void {
        const session = this.sessions.get(localSessionId);
        if (!session) return;

        logger.debug(`[OpenCode] Event: ${event.type}`, JSON.stringify(event.properties).slice(0, 200));

        switch (event.type) {
            case 'message.part.updated': {
                const props = event.properties as { part: OpencodePart; delta?: string };
                // Only emit if we're currently prompting
                if (session.promptState) {
                    this.emitPartUpdate(props.part, session.promptState.onUpdate);
                }
                break;
            }
            case 'session.idle': {
                const props = event.properties as { sessionID: string };
                if (props.sessionID === opencodeSessionId && session.promptState) {
                    // Prompt is complete
                    session.promptState.onUpdate({ type: 'turn_complete', stopReason: 'end_turn' });
                    session.promptState.resolve();
                    session.promptState = null;
                }
                break;
            }
            case 'session.error': {
                const props = event.properties as { sessionID: string; error: string };
                if (props.sessionID === opencodeSessionId && session.promptState) {
                    session.promptState.onUpdate({ type: 'error', message: props.error });
                    session.promptState.reject(new Error(props.error));
                    session.promptState = null;
                }
                break;
            }
            case 'permission.updated': {
                const permission = event.properties as OpencodePermission;
                if (permission.sessionID === opencodeSessionId) {
                    session.pendingPermissions.set(permission.id, permission);

                    // Convert to HAPI permission request
                    if (this.permissionHandler) {
                        const request: PermissionRequest = {
                            id: permission.id,
                            sessionId: localSessionId,
                            toolCallId: permission.callID || permission.id,
                            title: permission.title,
                            kind: permission.type,
                            rawInput: permission.metadata,
                            options: [
                                { optionId: 'once', name: 'Allow Once', kind: 'allow_once' },
                                { optionId: 'always', name: 'Allow Always', kind: 'allow_always' },
                                { optionId: 'reject', name: 'Reject', kind: 'reject_once' }
                            ]
                        };
                        this.permissionHandler(request);
                    }
                }
                break;
            }
            case 'permission.replied': {
                const { permissionID } = event.properties as { sessionID: string; permissionID: string };
                session.pendingPermissions.delete(permissionID);
                break;
            }
        }
    }

    async prompt(
        sessionId: string,
        content: PromptContent[],
        onUpdate: (msg: AgentMessage) => void
    ): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session || !session.opencodeSessionId) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        session.abortController = new AbortController();

        const textContent = content.map(c => c.text).join('\n');

        // Create a promise that will be resolved when session.idle event is received
        const promptPromise = new Promise<void>((resolve, reject) => {
            session.promptState = { onUpdate, resolve, reject };
        });

        try {
            // Send prompt to OpenCode - this returns an empty response
            // The actual response comes via SSE events
            const response = await fetch(`${this.serverUrl}/session/${session.opencodeSessionId}/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-opencode-directory': session.config.cwd
                },
                body: JSON.stringify({
                    parts: [
                        {
                            type: 'text',
                            text: textContent
                        }
                    ]
                }),
                signal: session.abortController.signal
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenCode prompt failed: ${response.status} ${errorText}`);
            }

            logger.debug('[OpenCode] Prompt sent, waiting for SSE events...');

            // Wait for the prompt to complete via SSE events
            await promptPromise;

        } catch (error) {
            // Clear prompt state on error
            session.promptState = null;

            if (error instanceof Error && error.name === 'AbortError') {
                onUpdate({ type: 'turn_complete', stopReason: 'cancelled' });
                return;
            }
            const message = error instanceof Error ? error.message : 'Unknown error';
            onUpdate({ type: 'error', message });
            throw error;
        } finally {
            session.abortController = null;
        }
    }

    private emitPartUpdate(part: OpencodePart, onUpdate: (msg: AgentMessage) => void): void {
        switch (part.type) {
            case 'text': {
                const textPart = part as OpencodeTextPart;
                onUpdate({ type: 'text', text: textPart.text });
                break;
            }
            case 'reasoning': {
                const reasoningPart = part as OpencodeReasoningPart;
                onUpdate({ type: 'reasoning', text: reasoningPart.text });
                break;
            }
            case 'tool': {
                const toolPart = part as OpencodeToolPart;
                const statusMap: Record<string, 'pending' | 'in_progress' | 'completed' | 'failed'> = {
                    'pending': 'pending',
                    'running': 'in_progress',
                    'completed': 'completed',
                    'error': 'failed'
                };
                onUpdate({
                    type: 'tool_call',
                    id: toolPart.callID,
                    name: toolPart.tool,
                    input: toolPart.state.input,
                    status: statusMap[toolPart.state.status] || 'pending'
                });

                if (toolPart.state.status === 'completed' && toolPart.state.output) {
                    onUpdate({
                        type: 'tool_result',
                        id: toolPart.callID,
                        output: toolPart.state.output,
                        status: 'completed'
                    });
                } else if (toolPart.state.status === 'error') {
                    onUpdate({
                        type: 'tool_result',
                        id: toolPart.callID,
                        output: toolPart.state.error || 'Tool execution failed',
                        status: 'failed'
                    });
                }
                break;
            }
        }
    }

    async cancelPrompt(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        if (session.abortController) {
            session.abortController.abort();
        }

        // Resolve the prompt promise if pending
        if (session.promptState) {
            session.promptState.onUpdate({ type: 'turn_complete', stopReason: 'cancelled' });
            session.promptState.resolve();
            session.promptState = null;
        }

        // Also abort in OpenCode
        if (session.opencodeSessionId) {
            try {
                await fetch(`${this.serverUrl}/session/${session.opencodeSessionId}/abort`, {
                    method: 'POST',
                    headers: {
                        'x-opencode-directory': session.config.cwd
                    }
                });
            } catch (error) {
                logger.debug(`[OpenCode] Failed to abort session:`, error);
            }
        }

        logger.debug(`[OpenCode] Cancelled prompt for session: ${sessionId}`);
    }

    async respondToPermission(
        sessionId: string,
        request: PermissionRequest,
        response: PermissionResponse
    ): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session || !session.opencodeSessionId) {
            logger.debug(`[OpenCode] Cannot respond to permission: session not found: ${sessionId}`);
            return;
        }

        let opencodeResponse: 'once' | 'always' | 'reject';
        if (response.outcome === 'cancelled') {
            opencodeResponse = 'reject';
        } else {
            const optionId = response.optionId;
            if (optionId === 'always') {
                opencodeResponse = 'always';
            } else if (optionId === 'reject') {
                opencodeResponse = 'reject';
            } else {
                opencodeResponse = 'once';
            }
        }

        try {
            await fetch(`${this.serverUrl}/session/${session.opencodeSessionId}/permissions/${request.id}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-opencode-directory': session.config.cwd
                },
                body: JSON.stringify({
                    response: opencodeResponse
                })
            });

            session.pendingPermissions.delete(request.id);
            logger.debug(`[OpenCode] Responded to permission ${request.id} with ${opencodeResponse}`);
        } catch (error) {
            logger.debug(`[OpenCode] Failed to respond to permission:`, error);
        }
    }

    onPermissionRequest(handler: (request: PermissionRequest) => void): void {
        this.permissionHandler = handler;
    }

    async disconnect(): Promise<void> {
        // Abort all active sessions
        for (const session of this.sessions.values()) {
            if (session.abortController) {
                session.abortController.abort();
            }
        }
        this.sessions.clear();

        // Stop event source
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }

        // Stop server if we started it
        if (this.serverProcess) {
            this.serverProcess.kill();
            this.serverProcess = null;
        }

        this.isConnected = false;
        this.serverUrl = null;
        logger.debug('[OpenCode] Disconnected');
    }

    restoreHistory(sessionId: string, messages: HistoryMessage[]): void {
        // OpenCode manages its own history, so we don't need to restore
        // But we can log for debugging
        logger.debug(`[OpenCode] History restore requested for session ${sessionId}: ${messages.length} messages (skipped - OpenCode manages history)`);
    }

    setModel(sessionId: string, model: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.model = model;
            logger.debug(`[OpenCode] Changed model to ${model} for session: ${sessionId}`);
        }
    }

    getModel(sessionId: string): string | null {
        const session = this.sessions.get(sessionId);
        return session?.model ?? null;
    }

    getDefaultModel(): string {
        return this.options.defaultModel;
    }
}
