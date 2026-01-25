/**
 * Keycloak authentication hook for hapi web client
 * Replaces the legacy useAuth + useAuthSource hooks with SSO-based authentication
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiClient } from '@/api/client'
import {
    getAccessToken,
    getCurrentUser,
    isAuthenticated,
    isTokenExpired,
    clearTokens,
    ensureValidToken,
    getExpiresAt,
    refreshToken,
    type KeycloakUser,
} from '@/services/keycloak'

export interface UseKeycloakAuthResult {
    /** Keycloak access token for API calls */
    token: string | null
    /** Current authenticated user */
    user: KeycloakUser | null
    /** Pre-configured API client with token */
    api: ApiClient | null
    /** Whether authentication is being verified */
    isLoading: boolean
    /** Whether user is authenticated */
    isAuthenticated: boolean
    /** Error message if auth failed */
    error: string | null
    /** Logout and redirect to Keycloak logout */
    logout: () => void
}

export function useKeycloakAuth(baseUrl: string): UseKeycloakAuthResult {
    const [token, setToken] = useState<string | null>(() => getAccessToken())
    const [user, setUser] = useState<KeycloakUser | null>(() => getCurrentUser())
    const [isLoading, setIsLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)
    const tokenRef = useRef<string | null>(token)
    const refreshPromiseRef = useRef<Promise<string | null> | null>(null)

    tokenRef.current = token

    // Initial authentication check
    useEffect(() => {
        const checkAuth = () => {
            if (isAuthenticated()) {
                setToken(getAccessToken())
                setUser(getCurrentUser())
                setError(null)
            } else {
                setToken(null)
                setUser(null)
            }
            setIsLoading(false)
        }

        checkAuth()
    }, [])

    // Refresh token handler
    const refreshAuth = useCallback(async (): Promise<string | null> => {
        // Deduplicate concurrent refresh calls
        if (refreshPromiseRef.current) {
            return refreshPromiseRef.current
        }

        const run = async (): Promise<string | null> => {
            try {
                const result = await refreshToken(baseUrl)
                if (result) {
                    tokenRef.current = result.accessToken
                    setToken(result.accessToken)
                    setUser(result.user)
                    setError(null)
                    return result.accessToken
                }
                // Refresh failed - user needs to login again
                setToken(null)
                setUser(null)
                return null
            } catch (e) {
                console.error('[Keycloak] Token refresh failed:', e)
                setToken(null)
                setUser(null)
                return null
            }
        }

        const promise = run()
        refreshPromiseRef.current = promise

        try {
            return await promise
        } finally {
            if (refreshPromiseRef.current === promise) {
                refreshPromiseRef.current = null
            }
        }
    }, [baseUrl])

    // Auto-refresh token before expiry
    useEffect(() => {
        if (!token) return

        const expiresAt = getExpiresAt()
        if (!expiresAt) return

        let isCancelled = false
        let timeout: ReturnType<typeof setTimeout> | null = null

        const scheduleRefresh = () => {
            const now = Date.now()
            const timeUntilExpiry = expiresAt - now
            // Refresh 60 seconds before expiry
            const refreshIn = Math.max(0, timeUntilExpiry - 60_000)

            timeout = setTimeout(async () => {
                if (isCancelled) return
                await refreshAuth()
                // Schedule next refresh if still valid
                if (!isCancelled && tokenRef.current) {
                    scheduleRefresh()
                }
            }, refreshIn)
        }

        scheduleRefresh()

        return () => {
            isCancelled = true
            if (timeout) clearTimeout(timeout)
        }
    }, [token, refreshAuth])

    // Refresh on visibility change (tab becomes visible)
    useEffect(() => {
        if (!token) return

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                // Check if token is expired or close to expiry
                if (isTokenExpired()) {
                    void refreshAuth()
                } else {
                    const expiresAt = getExpiresAt()
                    if (expiresAt && Date.now() >= expiresAt - 5 * 60 * 1000) {
                        void refreshAuth()
                    }
                }
            }
        }

        window.addEventListener('focus', handleVisibilityChange)
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            window.removeEventListener('focus', handleVisibilityChange)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [token, refreshAuth])

    // Create API client with auto-refresh capability
    const api = useMemo(() => {
        if (!token) return null

        return new ApiClient(token, {
            baseUrl,
            getToken: () => tokenRef.current,
            onUnauthorized: async () => {
                const newToken = await refreshAuth()
                return newToken
            },
        })
    }, [token, baseUrl, refreshAuth])

    // Logout handler
    const logout = useCallback(() => {
        clearTokens()
        setToken(null)
        setUser(null)
        setError(null)
        // Navigate to login page - the App component will handle the redirect
    }, [])

    return {
        token,
        user,
        api,
        isLoading,
        isAuthenticated: Boolean(token && user),
        error,
        logout,
    }
}
