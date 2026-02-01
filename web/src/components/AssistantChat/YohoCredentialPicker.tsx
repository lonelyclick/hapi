import { useState, useEffect } from 'react'
import { useYohoCredentials } from '@/hooks/queries/useYohoCredentials'
import type { ApiClient } from '@/api/client'
import type { YohoCredentialFile } from '@/types/api'

function SearchIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
        </svg>
    )
}

function FileIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    )
}

interface YohoCredentialPickerProps {
    api: ApiClient | null
    onSelect: (fullPath: string) => void
    onClose: () => void
}

export function YohoCredentialPicker({ api, onSelect, onClose }: YohoCredentialPickerProps) {
    const [nameQuery, setNameQuery] = useState<string>('')
    const [debouncedName, setDebouncedName] = useState<string>('')

    // Debounce name input
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedName(nameQuery), 200)
        return () => clearTimeout(timer)
    }, [nameQuery])

    // Fetch credentials with search
    const { files, isLoading, error } = useYohoCredentials(api, {
        name: debouncedName || undefined,
        limit: 100,
        enabled: true
    })

    const handleSelect = (file: YohoCredentialFile) => {
        onSelect(file.fullPath)
        onClose()
    }

    return (
        <div className="relative w-full min-w-[280px] max-w-[400px]">
            {/* Header */}
            <div className="flex items-center justify-between px-3 pb-2">
                <h3 className="text-sm font-semibold text-[var(--app-fg)]">
                    Yoho Credentials
                </h3>
                <button
                    type="button"
                    onClick={onClose}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    aria-label="Close"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            {/* Search */}
            <div className="px-3 pb-2">
                <div className="relative">
                    <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--app-hint)] pointer-events-none" />
                    <input
                        type="text"
                        value={nameQuery}
                        onChange={(e) => setNameQuery(e.target.value)}
                        placeholder="Search (e.g., antom.prod, cloudflare)..."
                        autoFocus
                        className="w-full pl-8 pr-3 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                    />
                </div>
            </div>

            {/* Results */}
            <div className="min-h-[120px] max-h-[280px] overflow-y-auto">
                {isLoading ? (
                    <div className="flex items-center justify-center py-8 text-[var(--app-hint)]">
                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-[var(--app-hint)] border-t-[var(--app-button)]" />
                    </div>
                ) : error ? (
                    <div className="px-3 py-4 text-sm text-red-400 text-center">
                        {error}
                    </div>
                ) : files.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-[var(--app-hint)] text-center">
                        {nameQuery ? 'No credentials found' : 'Type to search credentials'}
                    </div>
                ) : (
                    <div className="py-1">
                        {files.map((file) => (
                            <button
                                key={file.relativePath}
                                type="button"
                                onClick={() => handleSelect(file)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--app-secondary-bg)] transition-colors"
                            >
                                <FileIcon className="shrink-0 text-[var(--app-hint)]" />
                                <span className="flex-1 text-sm text-[var(--app-fg)] truncate font-mono">
                                    {file.displayName}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Count */}
            {files.length > 0 && (
                <div className="px-3 py-2 text-xs text-[var(--app-hint)] border-t border-[var(--app-divider)]">
                    {files.length} credential{files.length !== 1 ? 's' : ''} found
                </div>
            )}
        </div>
    )
}
