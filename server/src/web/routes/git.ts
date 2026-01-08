import { Hono } from 'hono'
import { z } from 'zod'
import { basename } from 'node:path'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'

const fileSearchSchema = z.object({
    query: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional()
})

const filePathSchema = z.object({
    path: z.string().min(1)
})

const imageUploadSchema = z.object({
    filename: z.string().min(1),
    content: z.string().min(1), // Base64 encoded image content
    mimeType: z.string().min(1)
})

const fileUploadSchema = z.object({
    filename: z.string().min(1),
    content: z.string().min(1), // Base64 encoded file content
    mimeType: z.string().min(1)
})

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_FILE_BYTES = 20 * 1024 * 1024

function logUploadInfo(kind: 'image' | 'file', phase: string, data: Record<string, unknown>): void {
    console.log(`[upload-${kind}] ${phase}`, data)
}

function logUploadWarn(kind: 'image' | 'file', phase: string, data: Record<string, unknown>): void {
    console.warn(`[upload-${kind}] ${phase}`, data)
}

function parseBooleanParam(value: string | undefined): boolean | undefined {
    if (value === 'true') return true
    if (value === 'false') return false
    return undefined
}

function estimateBase64Size(content: string): number {
    if (!content) return 0
    let padding = 0
    if (content.endsWith('==')) {
        padding = 2
    } else if (content.endsWith('=')) {
        padding = 1
    }
    return Math.floor((content.length * 3) / 4) - padding
}

async function runRpc<T>(fn: () => Promise<T>): Promise<T | { success: false; error: string }> {
    try {
        return await fn()
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
}

export function createGitRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions/:id/git-status', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const result = await runRpc(() => engine.getGitStatus(sessionResult.sessionId, sessionPath))
        return c.json(result)
    })

    app.get('/sessions/:id/git-diff-numstat', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const staged = parseBooleanParam(c.req.query('staged'))
        const result = await runRpc(() => engine.getGitDiffNumstat(sessionResult.sessionId, { cwd: sessionPath, staged }))
        return c.json(result)
    })

    app.get('/sessions/:id/git-diff-file', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = filePathSchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid file path' }, 400)
        }

        const staged = parseBooleanParam(c.req.query('staged'))
        const result = await runRpc(() => engine.getGitDiffFile(sessionResult.sessionId, {
            cwd: sessionPath,
            filePath: parsed.data.path,
            staged
        }))
        return c.json(result)
    })

    app.get('/sessions/:id/file', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = filePathSchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid file path' }, 400)
        }

        const raw = parseBooleanParam(c.req.query('raw'))
        const download = parseBooleanParam(c.req.query('download'))

        const result = await runRpc(() => engine.readSessionFile(sessionResult.sessionId, parsed.data.path))

        // If raw mode is requested and we have content, return the raw binary data
        if (raw && result.success && result.content) {
            const buffer = Buffer.from(result.content, 'base64')

            // Determine content type from file extension
            const ext = parsed.data.path.split('.').pop()?.toLowerCase() ?? ''
            const imageMimeTypes: Record<string, string> = {
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'gif': 'image/gif',
                'webp': 'image/webp',
                'svg': 'image/svg+xml',
                'bmp': 'image/bmp',
                'ico': 'image/x-icon',
                'heic': 'image/heic',
                'heif': 'image/heif'
            }
            const fileMimeTypes: Record<string, string> = {
                'pdf': 'application/pdf',
                'txt': 'text/plain',
                'md': 'text/markdown',
                'json': 'application/json',
                'csv': 'text/csv',
                'zip': 'application/zip',
                'gz': 'application/gzip',
                'tar': 'application/x-tar'
            }
            const contentType = imageMimeTypes[ext] ?? fileMimeTypes[ext] ?? 'application/octet-stream'
            const isImage = Boolean(imageMimeTypes[ext])
            const fileName = basename(parsed.data.path) || 'download'
            const safeFileName = fileName.replace(/"/g, '')

            const headers: Record<string, string> = {
                'Content-Type': contentType,
                'Content-Length': buffer.length.toString(),
                'Cache-Control': 'public, max-age=31536000, immutable'
            }

            if (download || !isImage) {
                headers['Content-Disposition'] = `attachment; filename="${safeFileName}"`
            }

            return new Response(buffer, {
                status: 200,
                headers
            })
        }

        return c.json(result)
    })

    app.get('/sessions/:id/files', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = fileSearchSchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const query = parsed.data.query?.trim() ?? ''
        const limit = parsed.data.limit ?? 200
        const args = ['--files']

        const result = await runRpc(() => engine.runRipgrep(sessionResult.sessionId, args, sessionPath))
        if (!result.success) {
            return c.json({ success: false, error: result.error ?? 'Failed to list files' })
        }

        const stdout = result.stdout ?? ''
        const queryLower = query.toLowerCase()
        const filePaths = stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .filter((line) => !query || line.toLowerCase().includes(queryLower))

        // Extract unique directories from file paths
        const dirSet = new Set<string>()
        for (const fp of filePaths) {
            const parts = fp.split('/')
            // Add all parent directories
            for (let i = 1; i < parts.length; i++) {
                dirSet.add(parts.slice(0, i).join('/'))
            }
        }

        // Filter directories by query if provided
        const matchingDirs = Array.from(dirSet)
            .filter((dir) => !query || dir.toLowerCase().includes(queryLower))
            .map((fullPath) => {
                const parts = fullPath.split('/')
                const fileName = parts[parts.length - 1] || fullPath
                const filePath = parts.slice(0, -1).join('/')
                return {
                    fileName,
                    filePath,
                    fullPath,
                    fileType: 'folder' as const
                }
            })

        // Map files
        const matchingFiles = filePaths.slice(0, limit).map((fullPath) => {
            const parts = fullPath.split('/')
            const fileName = parts[parts.length - 1] || fullPath
            const filePath = parts.slice(0, -1).join('/')
            return {
                fileName,
                filePath,
                fullPath,
                fileType: 'file' as const
            }
        })

        // Combine: folders first, then files, limited to total limit
        const combined = [...matchingDirs, ...matchingFiles].slice(0, limit)

        return c.json({ success: true, files: combined })
    })

    // Upload image endpoint
    app.post('/sessions/:id/upload-image', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionId = sessionResult.sessionId
        const namespace = c.get('namespace')
        const clientId = c.get('clientId')
        const userId = c.get('userId')
        const contentLength = c.req.header('content-length')

        let body: unknown
        try {
            body = await c.req.json()
        } catch {
            logUploadWarn('image', 'invalid-json', { sessionId, namespace, clientId, userId, contentLength })
            return c.json({ success: false, error: 'Invalid JSON body' }, 400)
        }

        const parsed = imageUploadSchema.safeParse(body)
        if (!parsed.success) {
            logUploadWarn('image', 'invalid-body', {
                sessionId,
                namespace,
                clientId,
                userId,
                error: parsed.error.message
            })
            return c.json({ success: false, error: 'Invalid request: ' + parsed.error.message }, 400)
        }

        const { filename, content, mimeType } = parsed.data
        const sizeBytes = estimateBase64Size(content)
        logUploadInfo('image', 'request', {
            sessionId,
            namespace,
            clientId,
            userId,
            filename: basename(filename),
            mimeType,
            sizeBytes,
            contentLength
        })
        if (sizeBytes > MAX_IMAGE_BYTES) {
            logUploadWarn('image', 'too-large', {
                sessionId,
                filename: basename(filename),
                sizeBytes,
                maxBytes: MAX_IMAGE_BYTES
            })
            return c.json({ success: false, error: 'Image too large (max 10MB)' }, 413)
        }

        const result = await runRpc(() => engine.uploadImage(
            sessionId,
            filename,
            content,
            mimeType
        ))
        const uploadResult = result as { success?: boolean; path?: string; error?: string }
        if (uploadResult && typeof uploadResult.success === 'boolean') {
            if (uploadResult.success) {
                logUploadInfo('image', 'saved', { sessionId, path: uploadResult.path, sizeBytes })
            } else {
                logUploadWarn('image', 'failed', { sessionId, error: uploadResult.error })
            }
        } else {
            logUploadWarn('image', 'unexpected-result', { sessionId })
        }
        return c.json(result)
    })

    // Upload file endpoint
    app.post('/sessions/:id/upload-file', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionId = sessionResult.sessionId
        const namespace = c.get('namespace')
        const clientId = c.get('clientId')
        const userId = c.get('userId')
        const contentLength = c.req.header('content-length')

        let body: unknown
        try {
            body = await c.req.json()
        } catch {
            logUploadWarn('file', 'invalid-json', { sessionId, namespace, clientId, userId, contentLength })
            return c.json({ success: false, error: 'Invalid JSON body' }, 400)
        }

        const parsed = fileUploadSchema.safeParse(body)
        if (!parsed.success) {
            logUploadWarn('file', 'invalid-body', {
                sessionId,
                namespace,
                clientId,
                userId,
                error: parsed.error.message
            })
            return c.json({ success: false, error: 'Invalid request: ' + parsed.error.message }, 400)
        }

        const { filename, content, mimeType } = parsed.data
        const sizeBytes = estimateBase64Size(content)
        logUploadInfo('file', 'request', {
            sessionId,
            namespace,
            clientId,
            userId,
            filename: basename(filename),
            mimeType,
            sizeBytes,
            contentLength
        })
        if (sizeBytes > MAX_FILE_BYTES) {
            logUploadWarn('file', 'too-large', {
                sessionId,
                filename: basename(filename),
                sizeBytes,
                maxBytes: MAX_FILE_BYTES
            })
            return c.json({ success: false, error: 'File too large (max 20MB)' }, 413)
        }

        const result = await runRpc(() => engine.uploadFile(
            sessionId,
            filename,
            content,
            mimeType
        ))
        const uploadResult = result as { success?: boolean; path?: string; error?: string }
        if (uploadResult && typeof uploadResult.success === 'boolean') {
            if (uploadResult.success) {
                logUploadInfo('file', 'saved', { sessionId, path: uploadResult.path, sizeBytes })
            } else {
                logUploadWarn('file', 'failed', { sessionId, error: uploadResult.error })
            }
        } else {
            logUploadWarn('file', 'unexpected-result', { sessionId })
        }
        return c.json(result)
    })

    return app
}
