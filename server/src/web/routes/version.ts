import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import type { EmbeddedWebAsset } from '../embeddedAssets'
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

function extractVersionFromAssets(embeddedAssetMap: Map<string, EmbeddedWebAsset> | null): string | null {
    if (embeddedAssetMap) {
        // Find index-*.js from embedded assets
        for (const [path] of embeddedAssetMap) {
            const match = path.match(/\/assets\/index-([^.]+)\.js$/)
            if (match) {
                return match[1]
            }
        }
    }
    return null
}

function extractVersionFromDist(): string | null {
    const candidates = [
        join(process.cwd(), '..', 'web', 'dist', 'assets'),
        join(import.meta.dir, '..', '..', '..', '..', 'web', 'dist', 'assets'),
        join(process.cwd(), 'web', 'dist', 'assets')
    ]

    for (const assetsDir of candidates) {
        if (existsSync(assetsDir)) {
            try {
                const files = readdirSync(assetsDir)
                for (const file of files) {
                    const match = file.match(/^index-([^.]+)\.js$/)
                    if (match) {
                        return match[1]
                    }
                }
            } catch {
                // ignore
            }
        }
    }
    return null
}

export function createVersionRoutes(embeddedAssetMap: Map<string, EmbeddedWebAsset> | null) {
    const app = new Hono<WebAppEnv>()

    // Cache the version at startup
    const version = extractVersionFromAssets(embeddedAssetMap) ?? extractVersionFromDist() ?? 'unknown'

    app.get('/version', (c) => {
        return c.json({
            version,
            timestamp: Date.now()
        })
    })

    return app
}
