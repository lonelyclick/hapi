import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { ApiClient } from '@/api/client'
import { getClientId } from '@/lib/client-identity'
import * as keycloak from '@/services/keycloak'
import type { KeycloakUser } from '@/services/keycloak'

interface AuthContextValue {
    user: KeycloakUser | null
    isAuthenticated: boolean
    isLoading: boolean
    error: string | null
    api: ApiClient | null
    login: () => Promise<void>
    logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface KeycloakAuthProviderProps {
    children: React.ReactNode
    baseUrl: string
}

export function KeycloakAuthProvider({ children, baseUrl }: KeycloakAuthProviderProps) {
    const [user, setUser] = useState<KeycloakUser | null>(() => keycloak.getCurrentUserSync())
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const tokenRef = useRef<string | null>(null)

    // Check authentication status on mount
    useEffect(() => {
        let isCancelled = false

        const checkAuth = async () => {
            setIsLoading(true)
            try {
                const isAuth = await keycloak.isAuthenticated()
                if (isAuth) {
                    const token = await keycloak.ensureValidToken(baseUrl)
                    if (token) {
                        tokenRef.current = token
                        const currentUser = await keycloak.getCurrentUser()
                        setUser(currentUser)
                        setError(null)
                    } else {
                        // Token refresh failed
                        await keycloak.clearTokens()
                        setUser(null)
                    }
                } else {
                    setUser(null)
                }
            } catch (e) {
                console.error('[KeycloakAuth] Auth check failed:', e)
                setError(e instanceof Error ? e.message : 'Authentication check failed')
                await keycloak.clearTokens()
                setUser(null)
            } finally {
                if (!isCancelled) {
                    setIsLoading(false)
                }
            }
        }

        checkAuth()

        return () => {
            isCancelled = true
        }
    }, [baseUrl])

    // Auto-refresh token before expiry
    useEffect(() => {
        if (!user) return

        const checkAndRefresh = async () => {
            if (await keycloak.isTokenExpired()) {
                try {
                    const token = await keycloak.ensureValidToken(baseUrl)
                    if (token) {
                        tokenRef.current = token
                        const currentUser = await keycloak.getCurrentUser()
                        setUser(currentUser)
                    } else {
                        await keycloak.clearTokens()
                        setUser(null)
                    }
                } catch (e) {
                    console.error('[KeycloakAuth] Token refresh failed:', e)
                    await keycloak.clearTokens()
                    setUser(null)
                }
            }
        }

        // Check every minute
        const interval = setInterval(checkAndRefresh, 60 * 1000)

        // Also check on visibility change
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                checkAndRefresh()
            }
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            clearInterval(interval)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [baseUrl, user])

    const login = useCallback(async () => {
        setIsLoading(true)
        setError(null)
        try {
            const redirectUri = `${window.location.origin}/auth/callback`
            const loginUrl = await keycloak.getLoginUrl(baseUrl, redirectUri)
            window.location.href = loginUrl
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to initiate login')
            setIsLoading(false)
        }
    }, [baseUrl])

    const logout = useCallback(async () => {
        setIsLoading(true)
        try {
            const redirectUri = window.location.origin
            const logoutUrl = await keycloak.getLogoutUrl(baseUrl, redirectUri)
            await keycloak.clearTokens()
            setUser(null)
            window.location.href = logoutUrl
        } catch (e) {
            // Even if getting logout URL fails, clear local tokens
            await keycloak.clearTokens()
            setUser(null)
            setIsLoading(false)
        }
    }, [baseUrl])

    const api = useMemo(() => {
        const token = keycloak.getAccessTokenSync()
        if (!token) return null

        return new ApiClient(token, {
            baseUrl,
            getToken: () => keycloak.getAccessTokenSync(),
            getClientId: () => getClientId(),
            onUnauthorized: async (): Promise<string | null> => {
                const newToken = await keycloak.ensureValidToken(baseUrl)
                if (!newToken) {
                    await keycloak.clearTokens()
                    setUser(null)
                    return null
                }
                return newToken
            },
        })
    }, [baseUrl, user]) // Recreate when user changes

    const value: AuthContextValue = {
        user,
        isAuthenticated: !!user && keycloak.isAuthenticatedSync(),
        isLoading,
        error,
        api,
        login,
        logout,
    }

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
    const context = useContext(AuthContext)
    if (!context) {
        throw new Error('useAuth must be used within a KeycloakAuthProvider')
    }
    return context
}

// Re-export for convenience
export { keycloak as keycloakService }
export type { KeycloakUser } from '@/services/keycloak'
