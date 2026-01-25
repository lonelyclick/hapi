/**
 * Keycloak authentication service for hapi web client
 * Handles OAuth2/OIDC login flow with token storage and refresh
 */

export interface KeycloakUser {
    email: string
    name: string | null
    sub: string
}

export interface KeycloakAuthResponse {
    accessToken: string
    refreshToken: string
    expiresIn: number
    user: KeycloakUser
}

// Token storage keys
const TOKEN_KEY = 'keycloak_access_token'
const REFRESH_TOKEN_KEY = 'keycloak_refresh_token'
const USER_KEY = 'keycloak_user'
const EXPIRES_AT_KEY = 'keycloak_expires_at'

/**
 * Get Keycloak login URL from backend
 */
export async function getLoginUrl(baseUrl: string, redirectUri: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/auth/keycloak`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ redirectUri }),
    })

    if (!response.ok) {
        throw new Error('Failed to get login URL')
    }

    const data = await response.json()
    return data.loginUrl
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForToken(
    baseUrl: string,
    code: string,
    redirectUri: string
): Promise<KeycloakAuthResponse> {
    const response = await fetch(`${baseUrl}/api/auth/keycloak/callback`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, redirectUri }),
    })

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Token exchange failed' }))
        throw new Error(error.error || error.details || 'Token exchange failed')
    }

    return response.json()
}

/**
 * Refresh access token using refresh token
 */
export async function refreshToken(baseUrl: string): Promise<KeycloakAuthResponse | null> {
    const refreshTokenValue = localStorage.getItem(REFRESH_TOKEN_KEY)
    if (!refreshTokenValue) {
        return null
    }

    try {
        const response = await fetch(`${baseUrl}/api/auth/keycloak/refresh`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ refreshToken: refreshTokenValue }),
        })

        if (!response.ok) {
            // Token refresh failed, clear tokens
            clearTokens()
            return null
        }

        const data: KeycloakAuthResponse = await response.json()
        saveTokens(data)
        return data
    } catch (error) {
        console.error('[Keycloak] Token refresh failed:', error)
        clearTokens()
        return null
    }
}

/**
 * Get logout URL from backend
 */
export async function getLogoutUrl(baseUrl: string, redirectUri: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/auth/keycloak/logout`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ redirectUri }),
    })

    if (!response.ok) {
        throw new Error('Failed to get logout URL')
    }

    const data = await response.json()
    return data.logoutUrl
}

/**
 * Save tokens to localStorage
 */
export function saveTokens(data: KeycloakAuthResponse): void {
    localStorage.setItem(TOKEN_KEY, data.accessToken)
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))

    // Calculate expiration time (subtract 60 seconds for buffer)
    const expiresAt = Date.now() + (data.expiresIn - 60) * 1000
    localStorage.setItem(EXPIRES_AT_KEY, String(expiresAt))
}

/**
 * Clear all tokens from localStorage
 */
export function clearTokens(): void {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(EXPIRES_AT_KEY)
}

/**
 * Get access token from storage
 */
export function getAccessToken(): string | null {
    return localStorage.getItem(TOKEN_KEY)
}

/**
 * Get current user from storage
 */
export function getCurrentUser(): KeycloakUser | null {
    const userStr = localStorage.getItem(USER_KEY)
    if (!userStr) return null
    try {
        return JSON.parse(userStr)
    } catch {
        return null
    }
}

/**
 * Check if token is expired
 */
export function isTokenExpired(): boolean {
    const expiresAt = localStorage.getItem(EXPIRES_AT_KEY)
    if (!expiresAt) return true
    return Date.now() >= Number(expiresAt)
}

/**
 * Check if user is authenticated (has valid token)
 */
export function isAuthenticated(): boolean {
    const token = getAccessToken()
    if (!token) return false
    return !isTokenExpired()
}

/**
 * Ensure we have a valid token, refresh if needed
 */
export async function ensureValidToken(baseUrl: string): Promise<string | null> {
    const token = getAccessToken()
    if (!token) return null

    // If token is expired or will expire within 5 minutes, refresh it
    const expiresAt = localStorage.getItem(EXPIRES_AT_KEY)
    if (expiresAt && Date.now() >= Number(expiresAt) - 5 * 60 * 1000) {
        const result = await refreshToken(baseUrl)
        if (result) {
            return result.accessToken
        }
        return null
    }

    return token
}

/**
 * Get expiration time in milliseconds
 */
export function getExpiresAt(): number | null {
    const expiresAt = localStorage.getItem(EXPIRES_AT_KEY)
    if (!expiresAt) return null
    return Number(expiresAt)
}
