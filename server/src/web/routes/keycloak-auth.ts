/**
 * Keycloak authentication routes for hapi-server
 * Provides OAuth2/OIDC endpoints for SSO login
 */

import { Hono } from 'hono'
import { z } from 'zod'
import {
    getKeycloakLoginUrl,
    getKeycloakLogoutUrl,
    exchangeCodeForToken,
    refreshKeycloakToken,
    verifyKeycloakToken,
    extractUserFromToken,
} from '../keycloak'
import type { WebAppEnv } from '../middleware/auth'

const callbackSchema = z.object({
    code: z.string(),
    redirectUri: z.string(),
    state: z.string().optional(),
})

const refreshSchema = z.object({
    refreshToken: z.string(),
})

const loginUrlSchema = z.object({
    redirectUri: z.string(),
    state: z.string().optional(),
})

const logoutSchema = z.object({
    redirectUri: z.string(),
})

export function createKeycloakAuthRoutes(): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    /**
     * POST /auth/keycloak
     * Get Keycloak login URL for OAuth2 authorization code flow
     */
    app.post('/auth/keycloak', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = loginUrlSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', details: parsed.error.issues }, 400)
        }

        const loginUrl = getKeycloakLoginUrl(parsed.data.redirectUri, parsed.data.state)
        return c.json({ loginUrl })
    })

    /**
     * POST /auth/keycloak/callback
     * Exchange authorization code for tokens
     */
    app.post('/auth/keycloak/callback', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = callbackSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', details: parsed.error.issues }, 400)
        }

        try {
            const tokens = await exchangeCodeForToken(parsed.data.code, parsed.data.redirectUri)

            // Verify and extract user info from access token
            const payload = await verifyKeycloakToken(tokens.access_token)
            const user = extractUserFromToken(payload)

            return c.json({
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresIn: tokens.expires_in,
                user,
            })
        } catch (error) {
            console.error('[Keycloak] Token exchange failed:', error)
            return c.json({
                error: 'Token exchange failed',
                details: error instanceof Error ? error.message : 'Unknown error'
            }, 401)
        }
    })

    /**
     * GET /auth/keycloak/me
     * Get current user info from token
     * Requires Authorization header with Bearer token
     */
    app.get('/auth/keycloak/me', async (c) => {
        const authHeader = c.req.header('Authorization')
        if (!authHeader?.startsWith('Bearer ')) {
            return c.json({ error: 'Missing or invalid Authorization header' }, 401)
        }

        const token = authHeader.slice(7)

        try {
            const payload = await verifyKeycloakToken(token)
            const user = extractUserFromToken(payload)

            return c.json({
                user,
                expiresAt: payload.exp * 1000, // Convert to milliseconds
            })
        } catch (error) {
            console.error('[Keycloak] Token verification failed:', error)
            return c.json({
                error: 'Invalid token',
                details: error instanceof Error ? error.message : 'Unknown error'
            }, 401)
        }
    })

    /**
     * POST /auth/keycloak/refresh
     * Refresh access token using refresh token
     */
    app.post('/auth/keycloak/refresh', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = refreshSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', details: parsed.error.issues }, 400)
        }

        try {
            const tokens = await refreshKeycloakToken(parsed.data.refreshToken)

            // Verify and extract user info from new access token
            const payload = await verifyKeycloakToken(tokens.access_token)
            const user = extractUserFromToken(payload)

            return c.json({
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresIn: tokens.expires_in,
                user,
            })
        } catch (error) {
            console.error('[Keycloak] Token refresh failed:', error)
            return c.json({
                error: 'Token refresh failed',
                details: error instanceof Error ? error.message : 'Unknown error'
            }, 401)
        }
    })

    /**
     * POST /auth/keycloak/logout
     * Get Keycloak logout URL
     */
    app.post('/auth/keycloak/logout', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = logoutSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', details: parsed.error.issues }, 400)
        }

        const logoutUrl = getKeycloakLogoutUrl(parsed.data.redirectUri)
        return c.json({ logoutUrl })
    })

    return app
}
