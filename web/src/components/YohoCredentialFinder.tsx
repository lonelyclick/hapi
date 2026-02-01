import { useState, useEffect } from 'react'
import { useYohoCredentials, useYohoCredentialTypes } from '@/hooks/queries/useYohoCredentials'
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
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    )
}

function FolderIcon(props: { className?: string }) {
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
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </svg>
    )
}

function CopyIcon(props: { className?: string }) {
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
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
    )
}

interface YohoCredentialFinderProps {
    api: import('@/api/client').ApiClient | null
}

export function YohoCredentialFinder({ api }: YohoCredentialFinderProps) {
    const [selectedType, setSelectedType] = useState<string>('')
    const [nameQuery, setNameQuery] = useState<string>('')
    const [debouncedName, setDebouncedName] = useState<string>('')

    // Debounce name input
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedName(nameQuery), 300)
        return () => clearTimeout(timer)
    }, [nameQuery])

    // Fetch available types
    const { types, rootPath } = useYohoCredentialTypes(api)

    // Fetch credentials with filters
    const { files, availableTypes, isLoading, error, refetch } = useYohoCredentials(api, {
        type: selectedType || undefined,
        name: debouncedName || undefined,
        limit: 100,
        enabled: true
    })

    // Use availableTypes from the search response if available, otherwise from types endpoint
    const allTypes = availableTypes.length > 0 ? availableTypes : types

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text)
    }

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-medium">Yoho Credentials</h2>
                    {rootPath && (
                        <p className="text-[11px] text-[var(--app-hint)] mt-0.5">
                            {rootPath}
                        </p>
                    )}
                </div>
            </div>

            {/* Filters */}
            <div className="space-y-2">
                {/* Type Filter */}
                <div className="flex gap-2">
                    <select
                        value={selectedType}
                        onChange={(e) => setSelectedType(e.target.value)}
                        className="flex-1 px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                    >
                        <option value="">All Types</option>
                        {allTypes.map((type) => (
                            <option key={type} value={type}>
                                {type}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={() => {
                            setSelectedType('')
                            setNameQuery('')
                        }}
                        disabled={!selectedType && !nameQuery}
                        className="px-3 py-1.5 text-sm rounded border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors disabled:opacity-50"
                    >
                        Clear
                    </button>
                </div>

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
            </div>

            {/* Results */}
            <div className="min-h-[100px]">
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
                        No credential files found
                    </div>
                ) : (
                    <div className="space-y-1">
                        {files.map((file) => (
                            <CredentialRow
                                key={file.relativePath}
                                file={file}
                                onCopy={copyToClipboard}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Count */}
            {files.length > 0 && (
                <div className="text-xs text-[var(--app-hint)]">
                    Found {files.length} credential file{files.length !== 1 ? 's' : ''}
                </div>
            )}
        </div>
    )
}

function CredentialRow({
    file,
    onCopy
}: {
    file: YohoCredentialFile
    onCopy: (text: string) => void
}) {
    const [copied, setCopied] = useState(false)

    const handleCopy = (text: string) => {
        onCopy(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    return (
        <div className="flex items-center gap-2 px-2 py-2 rounded bg-[var(--app-secondary-bg)] group">
            <FolderIcon className="shrink-0 text-[var(--app-hint)]" />
            <span className="text-xs font-medium text-[var(--app-button)]">
                {file.type}
            </span>
            <span className="text-[var(--app-hint)]">/</span>
            <FileIcon className="shrink-0 text-[var(--app-hint)]" />
            <span className="flex-1 text-sm text-[var(--app-fg)] truncate">
                {file.name}
            </span>
            <button
                onClick={() => handleCopy(file.fullPath)}
                className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--app-bg)] transition-opacity"
                title={copied ? 'Copied!' : 'Copy path'}
            >
                {copied ? (
                    <span className="text-xs text-green-400">Copied!</span>
                ) : (
                    <CopyIcon className="text-[var(--app-hint)]" />
                )}
            </button>
        </div>
    )
}
