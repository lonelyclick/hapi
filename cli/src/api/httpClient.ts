/**
 * Minimal HTTP client using node:http/https.
 *
 * Bun's native fetch() throws FailedToOpenSocket when run from macOS launchd,
 * while node:http (Bun's Node.js compat layer) works reliably in all contexts.
 */
import http from 'node:http'
import https from 'node:https'

export class HttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly statusText: string,
        public readonly data: unknown
    ) {
        super(`HTTP ${status}: ${statusText}`)
        this.name = 'HttpError'
    }

    get response() {
        return { status: this.status, statusText: this.statusText, data: this.data }
    }
}

type RequestOptions = {
    headers?: Record<string, string>
    timeout?: number
    params?: Record<string, unknown>
}

function buildUrl(base: string, params?: Record<string, unknown>): string {
    if (!params || Object.keys(params).length === 0) return base
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            searchParams.set(key, String(value))
        }
    }
    const separator = base.includes('?') ? '&' : '?'
    return `${base}${separator}${searchParams.toString()}`
}

async function request<T>(method: string, url: string, body: unknown | undefined, opts: RequestOptions): Promise<{ data: T }> {
    const fullUrl = buildUrl(url, opts.params)
    const parsed = new URL(fullUrl)
    const isHttps = parsed.protocol === 'https:'
    const transport = isHttps ? https : http

    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined

    return new Promise<{ data: T }>((resolve, reject) => {
        const req = transport.request(
            {
                hostname: parsed.hostname,
                port: parsed.port || (isHttps ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method,
                headers: {
                    ...opts.headers,
                    ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {}),
                },
                timeout: opts.timeout,
            },
            (res) => {
                const chunks: Buffer[] = []
                res.on('data', (chunk: Buffer) => chunks.push(chunk))
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8')
                    let data: T
                    try {
                        data = JSON.parse(text) as T
                    } catch {
                        data = text as unknown as T
                    }

                    const status = res.statusCode ?? 0
                    if (status >= 400) {
                        reject(new HttpError(status, res.statusMessage ?? '', data))
                        return
                    }

                    resolve({ data })
                })
            }
        )

        req.on('error', reject)
        req.on('timeout', () => {
            req.destroy()
            reject(new Error(`Request timeout: ${method} ${url}`))
        })

        if (bodyStr) {
            req.write(bodyStr)
        }
        req.end()
    })
}

export const httpClient = {
    get: <T = unknown>(url: string, opts: RequestOptions = {}) =>
        request<T>('GET', url, undefined, opts),

    post: <T = unknown>(url: string, body?: unknown, opts: RequestOptions = {}) =>
        request<T>('POST', url, body, opts),

    put: <T = unknown>(url: string, body?: unknown, opts: RequestOptions = {}) =>
        request<T>('PUT', url, body, opts),

    patch: <T = unknown>(url: string, body?: unknown, opts: RequestOptions = {}) =>
        request<T>('PATCH', url, body, opts),

    delete: <T = unknown>(url: string, opts: RequestOptions = {}) =>
        request<T>('DELETE', url, undefined, opts),
}
