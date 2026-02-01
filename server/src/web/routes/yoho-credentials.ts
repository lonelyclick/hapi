import { Hono } from 'hono'
import { z } from 'zod'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, readdirSync, statSync } from 'node:fs'
import type { WebAppEnv } from '../middleware/auth'

const searchCredentialsSchema = z.object({
    name: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional()
})

type CredentialFile = {
    type: string
    name: string
    fullPath: string
    relativePath: string
    displayName: string
}

type CredentialsResponse = {
    success: boolean
    files?: CredentialFile[]
    availableTypes?: string[]
    error?: string
}

const CREDENTIALS_ROOT = join(homedir(), 'happy', 'yoho-task-v2', 'data', 'credentials')

function credentialsDirectoryExists(): boolean {
    return existsSync(CREDENTIALS_ROOT)
}

function getAvailableTypes(): string[] {
    if (!credentialsDirectoryExists()) return []
    try {
        return readdirSync(CREDENTIALS_ROOT)
            .filter(entry => {
                const fullPath = join(CREDENTIALS_ROOT, entry)
                return statSync(fullPath).isDirectory()
            })
            .sort()
    } catch {
        return []
    }
}

function listCredentials(filters: { name?: string; limit?: number }): CredentialFile[] {
    if (!credentialsDirectoryExists()) return []

    const limit = filters.limit ?? 100
    const results: CredentialFile[] = []
    const allTypes = getAvailableTypes()

    for (const type of allTypes) {
        const typeDir = join(CREDENTIALS_ROOT, type)
        try {
            const files = readdirSync(typeDir)
            for (const file of files) {
                if (!file.endsWith('.json')) continue
                const name = file.replace(/\.json$/, '')
                // Search by type/name or just name
                const displayName = `${type}.${name}`
                if (filters.name && !displayName.toLowerCase().includes(filters.name.toLowerCase())) {
                    continue
                }
                const fullPath = join(typeDir, file)
                const relativePath = join(type, file)
                results.push({ type, name, fullPath, relativePath, displayName })
                if (results.length >= limit) {
                    return results
                }
            }
        } catch {
            continue
        }
    }
    return results
}

export function createYohoCredentialsRoutes(): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/yoho-credentials', async (c) => {
        const parsed = searchCredentialsSchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ success: false, error: 'Invalid query parameters' }, 400)
        }

        if (!credentialsDirectoryExists()) {
            return c.json({
                success: true,
                files: [],
                availableTypes: [],
                error: 'Credentials directory not found'
            })
        }

        const files = listCredentials({
            name: parsed.data.name,
            limit: parsed.data.limit
        })

        return c.json({
            success: true,
            files,
            availableTypes: getAvailableTypes()
        })
    })

    app.get('/yoho-credentials/types', async (c) => {
        return c.json({
            success: true,
            types: getAvailableTypes(),
            rootPath: CREDENTIALS_ROOT
        })
    })

    return app
}
