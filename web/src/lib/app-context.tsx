import { createContext, useContext, type ReactNode } from 'react'
import type { ApiClient } from '@/api/client'

type AppContextValue = {
    api: ApiClient
    token: string
    userEmail: string | null
    currentOrgId: string | null
    setCurrentOrgId: (id: string | null) => void
}

const AppContext = createContext<AppContextValue | null>(null)

const ORG_STORAGE_KEY = 'yoho-current-org-id'

export function getStoredOrgId(): string | null {
    try {
        return localStorage.getItem(ORG_STORAGE_KEY)
    } catch {
        return null
    }
}

export function setStoredOrgId(id: string | null) {
    try {
        if (id) {
            localStorage.setItem(ORG_STORAGE_KEY, id)
        } else {
            localStorage.removeItem(ORG_STORAGE_KEY)
        }
    } catch {
        // ignore
    }
}

export function AppContextProvider(props: {
    value: AppContextValue
    children: ReactNode
}) {
    return (
        <AppContext.Provider value={props.value}>
            {props.children}
        </AppContext.Provider>
    )
}

export function useAppContext(): AppContextValue {
    const context = useContext(AppContext)
    if (!context) {
        throw new Error('AppContext is not available')
    }
    return context
}
