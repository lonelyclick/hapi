import { request } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { logger } from '@/ui/logger';

type LangfuseConfig = {
    endpoint: string;
    authHeader: string;
};

type OtelKeyValue = {
    key: string;
    value: {
        stringValue: string;
    };
};

type OtelSpan = {
    traceId: string;
    spanId: string;
    name: string;
    kind: number;
    startTimeUnixNano: string;
    endTimeUnixNano: string;
    attributes: OtelKeyValue[];
};

type OtelScopeSpans = {
    scope: {
        name: string;
    };
    spans: OtelSpan[];
};

type OtelResourceSpans = {
    resource: {
        attributes: OtelKeyValue[];
    };
    scopeSpans: OtelScopeSpans[];
};

type OtelExportRequest = {
    resourceSpans: OtelResourceSpans[];
};

type SessionHookPayload = Record<string, unknown> & {
    session_id?: string;
    sessionId?: string;
    transcript_path?: string;
    cwd?: string;
    hook_event_name?: string;
    source?: string;
    hapi_source?: string;
};

const MAX_RESPONSE_BODY_BYTES = 4096;
const MAX_LOG_DETAIL_LENGTH = 4000;

function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength)}...[truncated]`;
}

function stringifyDetail(detail: Record<string, unknown>): string {
    try {
        return truncateText(JSON.stringify(detail), MAX_LOG_DETAIL_LENGTH);
    } catch {
        return truncateText(String(detail), MAX_LOG_DETAIL_LENGTH);
    }
}

function normalizeError(error: unknown): Record<string, unknown> | null {
    if (!error) {
        return null;
    }

    if (error instanceof Error) {
        const detail: Record<string, unknown> = {
            name: error.name,
            message: error.message
        };
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code) {
            detail.code = nodeError.code;
        }
        if (nodeError.errno !== undefined) {
            detail.errno = nodeError.errno;
        }
        if (nodeError.syscall) {
            detail.syscall = nodeError.syscall;
        }
        const nodeErrorWithDetails = nodeError as NodeJS.ErrnoException & {
            address?: string
            port?: number
        };
        if (nodeErrorWithDetails.address) {
            detail.address = nodeErrorWithDetails.address;
        }
        if (nodeErrorWithDetails.port !== undefined) {
            detail.port = nodeErrorWithDetails.port;
        }
        if (error.cause) {
            detail.cause = normalizeError(error.cause) ?? String(error.cause);
        }
        if (error.stack) {
            detail.stack = truncateText(error.stack, MAX_LOG_DETAIL_LENGTH);
        }
        return detail;
    }

    return { error: String(error) };
}

function logErrorDetail(message: string, detail: Record<string, unknown>): void {
    const serialized = stringifyDetail(detail);
    process.stderr.write(`[hook-forwarder] ${message}: ${serialized}\n`);
    logger.debug(`[hook-forwarder] ${message}`, detail);
}

function logError(message: string, error?: unknown): void {
    const detail = error instanceof Error ? error.message : (error ? String(error) : '');
    const suffix = detail ? `: ${detail}` : '';
    process.stderr.write(`[hook-forwarder] ${message}${suffix}\n`);
    const errorDetail = normalizeError(error);
    if (errorDetail) {
        logErrorDetail(`${message} detail`, errorDetail);
    }
}

function logDebug(message: string, detail?: unknown): void {
    if (detail === undefined) {
        logger.debug(`[hook-forwarder] ${message}`);
        return;
    }
    if (detail instanceof Error) {
        logger.debug(`[hook-forwarder] ${message}`, normalizeError(detail) ?? { error: String(detail) });
        return;
    }
    logger.debug(`[hook-forwarder] ${message}`, detail);
}

function coerceString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function resolveLangfuseConfig(): LangfuseConfig | null {
    const publicKey = (process.env.HAPI_LANGFUSE_PUBLIC_KEY || process.env.LANGFUSE_PUBLIC_KEY || '').trim();
    const secretKey = (process.env.HAPI_LANGFUSE_SECRET_KEY || process.env.LANGFUSE_SECRET_KEY || '').trim();
    if (!publicKey || !secretKey) {
        return null;
    }

    const endpointOverride = (process.env.HAPI_LANGFUSE_OTEL_ENDPOINT || process.env.LANGFUSE_OTEL_ENDPOINT || '').trim();
    const baseUrl = (
        process.env.HAPI_LANGFUSE_BASE_URL ||
        process.env.LANGFUSE_BASE_URL ||
        process.env.HAPI_LANGFUSE_HOST ||
        process.env.LANGFUSE_HOST ||
        'https://cloud.langfuse.com'
    ).trim();
    const endpoint = endpointOverride || new URL('/api/public/otel/v1/traces', baseUrl).toString();
    const authHeader = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;

    return { endpoint, authHeader };
}

function buildTraceId(seed: string | null): string {
    if (seed) {
        return createHash('sha256').update(seed).digest('hex').slice(0, 32);
    }
    return randomBytes(16).toString('hex');
}

function buildSpanId(): string {
    return randomBytes(8).toString('hex');
}

function nanoTimeNow(): string {
    return (BigInt(Date.now()) * 1_000_000n).toString();
}

function addAttribute(attributes: OtelKeyValue[], key: string, value: unknown): void {
    if (value === undefined || value === null) {
        return;
    }
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    attributes.push({
        key,
        value: { stringValue }
    });
}

function extractSessionId(payload: SessionHookPayload | null): string | null {
    if (!payload) {
        return null;
    }
    return coerceString(payload.session_id) || coerceString(payload.sessionId);
}

function buildLangfuseOtelPayload(payload: SessionHookPayload, sessionSource: string | null): OtelExportRequest {
    const sessionId = extractSessionId(payload);
    const hookEventName = coerceString(payload.hook_event_name) || 'session_start';
    const traceName = 'claude.session';
    const spanName = `claude.${hookEventName}`;
    const resolvedSource = coerceString(payload.source) || sessionSource;
    const resolvedHapiSource = coerceString(payload.hapi_source) || sessionSource;

    const attributes: OtelKeyValue[] = [];
    addAttribute(attributes, 'langfuse.session.id', sessionId);
    addAttribute(attributes, 'langfuse.trace.name', traceName);
    addAttribute(attributes, 'langfuse.trace.metadata.hook_event_name', hookEventName);
    addAttribute(attributes, 'langfuse.trace.metadata.source', resolvedSource);
    addAttribute(attributes, 'langfuse.trace.metadata.hapi_source', resolvedHapiSource);
    addAttribute(attributes, 'langfuse.trace.metadata.cwd', coerceString(payload.cwd));
    addAttribute(attributes, 'langfuse.trace.metadata.transcript_path', coerceString(payload.transcript_path));

    const resourceAttributes: OtelKeyValue[] = [];
    addAttribute(resourceAttributes, 'service.name', 'hapi-cli');

    const traceId = buildTraceId(sessionId);
    const spanId = buildSpanId();
    const startTime = nanoTimeNow();
    const endTime = nanoTimeNow();

    return {
        resourceSpans: [{
            resource: { attributes: resourceAttributes },
            scopeSpans: [{
                scope: { name: 'hapi.hook-forwarder' },
                spans: [{
                    traceId,
                    spanId,
                    name: spanName,
                    kind: 1,
                    startTimeUnixNano: startTime,
                    endTimeUnixNano: endTime,
                    attributes
                }]
            }]
        }]
    };
}

async function sendLangfuseTrace(payload: SessionHookPayload, sessionSource: string | null): Promise<void> {
    const config = resolveLangfuseConfig();
    if (!config) {
        logDebug('Langfuse OTLP not configured');
        return;
    }

    const sessionId = extractSessionId(payload);
    if (!sessionId) {
        logDebug('Langfuse OTLP skipped: missing session id');
        return;
    }

    const otelPayload = buildLangfuseOtelPayload(payload, sessionSource);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        logDebug('Sending Langfuse OTLP trace', { endpoint: config.endpoint });
        const response = await fetch(config.endpoint, {
            method: 'POST',
            headers: {
                'Authorization': config.authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(otelPayload),
            signal: controller.signal
        });
        if (!response.ok) {
            const responseText = await response.text();
            const bodyPreview = truncateText(responseText, MAX_LOG_DETAIL_LENGTH);
            const bodyTruncated = responseText.length > MAX_LOG_DETAIL_LENGTH;
            const statusSuffix = response.statusText ? ` ${response.statusText}` : '';
            logError(`Langfuse OTLP responded with status ${response.status}${statusSuffix}`);
            logErrorDetail('Langfuse OTLP error response', {
                status: response.status,
                statusText: response.statusText,
                body: bodyPreview,
                bodyTruncated
            });
            return;
        }
        logDebug('Langfuse OTLP response', { status: response.status });
    } catch (error) {
        logError('Langfuse OTLP request failed', error);
        logErrorDetail('Langfuse OTLP request context', {
            endpoint: config.endpoint,
            timeoutMs: 5000
        });
    } finally {
        clearTimeout(timeout);
    }
}

function parsePort(value: string | undefined): number | null {
    if (!value) {
        return null;
    }

    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return null;
    }

    return port;
}

function parseArgs(args: string[]): { port: number | null; token: string | null } {
    let port: number | null = null;
    let token: string | null = null;

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (!arg) {
            continue;
        }

        if (arg === '--port' || arg === '-p') {
            port = parsePort(args[i + 1]);
            i += 1;
            continue;
        }

        if (arg.startsWith('--port=')) {
            port = parsePort(arg.slice('--port='.length));
            continue;
        }

        if (arg === '--token' || arg === '-t') {
            token = args[i + 1] ?? null;
            i += 1;
            continue;
        }

        if (arg.startsWith('--token=')) {
            token = arg.slice('--token='.length);
            continue;
        }

        if (!port) {
            port = parsePort(arg);
            continue;
        }

        if (!token) {
            token = arg;
        }
    }

    return { port, token };
}

export async function runSessionHookForwarder(args: string[]): Promise<void> {
    logDebug('Starting hook forwarder', { argsCount: args.length });
    const { port, token } = parseArgs(args);
    logDebug('Parsed hook forwarder args', { port, tokenPresent: Boolean(token) });
    if (!port) {
        logError('Invalid or missing port argument');
        logDebug('Missing or invalid port');
        process.exitCode = 1;
        return;
    }

    if (!token) {
        logError('Missing hook token');
        logDebug('Missing hook token');
        process.exitCode = 1;
        return;
    }

    try {
        const chunks: Buffer[] = [];
        process.stdin.resume();
        for await (const chunk of process.stdin) {
            if (typeof chunk === 'string') {
                chunks.push(Buffer.from(chunk));
            } else {
                chunks.push(chunk as Buffer);
            }
        }

        const rawBody = Buffer.concat(chunks);
        logDebug('Collected hook payload', { bytes: rawBody.length });

        let payload: SessionHookPayload | null = null;
        try {
            const parsed = JSON.parse(rawBody.toString('utf-8'));
            if (parsed && typeof parsed === 'object') {
                payload = parsed as SessionHookPayload;
            } else {
                logDebug('Hook payload JSON is not an object');
            }
        } catch (error) {
            logDebug('Failed to parse hook payload as JSON', {
                error: normalizeError(error) ?? String(error),
                payloadBytes: rawBody.length
            });
        }

        const sessionSource = process.env.HAPI_SESSION_SOURCE?.trim() || null;
        if (payload && sessionSource) {
            logDebug('Injecting session source into hook payload', { sessionSource });
            const hadSource = 'source' in payload;
            if (!hadSource) {
                payload.source = sessionSource;
            }
            payload.hapi_source = sessionSource;
            logDebug('Session source injected into hook payload', {
                addedSource: !hadSource,
                addedHapiSource: true
            });
        }

        const body = payload ? Buffer.from(JSON.stringify(payload)) : rawBody;

        let hadError = false;
        await new Promise<void>((resolve) => {
            logDebug('Forwarding hook payload to hook server', { port });
            const req = request({
                host: '127.0.0.1',
                port,
                method: 'POST',
                path: '/hook/session-start',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': body.length,
                    'x-hapi-hook-token': token
                }
            }, (res) => {
                const statusCode = res.statusCode ?? 0;
                const statusMessage = res.statusMessage ?? '';
                const responseChunks: Buffer[] = [];
                let responseBytes = 0;
                let responseTruncated = false;
                let resolved = false;

                const finish = (): void => {
                    if (resolved) {
                        return;
                    }
                    resolved = true;
                    resolve();
                };

                const getResponseBody = (): string => Buffer.concat(responseChunks).toString('utf-8');

                res.on('data', (chunk) => {
                    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
                    if (responseBytes < MAX_RESPONSE_BODY_BYTES) {
                        const remaining = MAX_RESPONSE_BODY_BYTES - responseBytes;
                        if (buffer.length > remaining) {
                            responseChunks.push(buffer.subarray(0, remaining));
                            responseBytes += remaining;
                            responseTruncated = true;
                        } else {
                            responseChunks.push(buffer);
                            responseBytes += buffer.length;
                        }
                    } else {
                        responseTruncated = true;
                    }
                });

                res.on('error', (error) => {
                    hadError = true;
                    logError('Error reading hook server response', error);
                    logErrorDetail('Hook server response context', {
                        statusCode,
                        statusMessage,
                        body: getResponseBody(),
                        bodyTruncated: responseTruncated
                    });
                    finish();
                });

                res.on('end', () => {
                    const responseBody = getResponseBody();
                    logDebug('Hook server responded', {
                        statusCode,
                        statusMessage,
                        responseBytes,
                        responseTruncated
                    });
                    if (statusCode >= 400) {
                        hadError = true;
                        const statusSuffix = statusMessage ? ` ${statusMessage}` : '';
                        logError(`Hook server responded with status ${statusCode}${statusSuffix}`);
                        logErrorDetail('Hook server error response', {
                            statusCode,
                            statusMessage,
                            body: responseBody,
                            bodyTruncated: responseTruncated
                        });
                    }
                    finish();
                });
            });

            req.on('error', (error) => {
                hadError = true;
                logError('Failed to send hook request', error);
                logErrorDetail('Hook request context', { port });
                resolve();
            });
            req.end(body);
        });
        if (hadError) {
            logDebug('Hook forwarder finished with errors');
            process.exitCode = 1;
            return;
        }
        logDebug('Hook forwarder finished successfully');

        if (payload) {
            await sendLangfuseTrace(payload, sessionSource);
        } else {
            logDebug('Langfuse OTLP skipped: payload missing');
        }
    } catch (error) {
        logError('Failed to forward session hook', error);
        logDebug('Failed to forward session hook', error);
        process.exitCode = 1;
    }
}
