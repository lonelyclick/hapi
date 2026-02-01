import { useState, useEffect, useMemo } from 'react'
import { useYohoCredentials, useYohoCredentialTypes } from '@/hooks/queries/useYohoCredentials'
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

function FolderIcon(props: { className?: string }) {
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
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </svg>
    )
}

interface YohoCredentialPickerProps {
    api: ApiClient | null
    onSelect: (fullPath: string) => void
    onClose: () => void
}

export function YohoCredentialPicker({ api, onSelect, onClose }: YohoCredentialPickerProps) {
    const [selectedType, setSelectedType] = useState<string>('')
    const [nameQuery, setNameQuery] = useState<string>('')
    const [debouncedName, setDebouncedName] = useState<string>('')

    // Debounce name input
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedName(nameQuery), 300)
        return () => clearTimeout(timer)
    }, [nameQuery])

    // Fetch available types
    const { types } = useYohoCredentialTypes(api)

    // Fetch credentials with filters
    const { files, availableTypes, isLoading, error } = useYohoCredentials(api, {
        type: selectedType || undefined,
        name: debouncedName || undefined,
        limit: 100,
        enabled: true
    })

    // Use availableTypes from the search response if available, otherwise from types endpoint
    const allTypes = availableTypes.length > 0 ? availableTypes : types

    const hasFilters = selectedType || nameQuery

    const handleSelect = (file: YohoCredentialFile) => {
        onSelect(file.fullPath)
        onClose()
    }

    const handleClear = () => {
        setSelectedType('')
        setNameQuery('')
    }

    return (
        <div className="relative w-full min-w-[280px] max-w-[360px]">
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

            {/* Filters */}
            <div className="px-3 pb-2 space-y-2">
                {/* Type Filter */}
                <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                >
                    <option value="">All Types</option>
                    {allTypes.map((type) => (
                        <option key={type} value={type}>
                            {type}
                        </option>
                    ))}
                </select>

                {/* Name Search */}
                <div className="relative">
                    <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--app-hint)] pointer-events-none" />
                    <input
                        type="text"
                        value={nameQuery}
                        onChange={(e) => setNameQuery(e.target.value)}
                        placeholder="Search by name..."
                        className="w-full pl-8 pr-3 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                    />
                </div>

                {/* Clear button */}
                {hasFilters && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="text-xs text-[var(--app-link)] hover:underline"
                    >
                        Clear filters
                    </button>
                )}
            </div>

            {/* Results */}
            <div className="min-h-[120px] max-h-[240px] overflow-y-auto">
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
                        No credentials found
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
                                <FolderIcon className="shrink-0 text-[var(--app-hint)]" />
                                <span className="text-xs font-medium text-[var(--app-button)]">
                                    {file.type}
                                </span>
                                <span className="text-[var(--app-hint)]">/</span>
                                <FileIcon className="shrink-0 text-[var(--app-hint)]" />
                                <span className="flex-1 text-sm text-[var(--app-fg)] truncate">
                                    {file.name}
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
