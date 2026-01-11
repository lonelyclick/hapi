import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useHappyChatContextSafe } from '@/components/AssistantChat/context'

interface ImageViewerProps {
    src: string
    alt?: string
    className?: string
}

export function ImageViewer({ src, alt = 'Image', className = '' }: ImageViewerProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [hasError, setHasError] = useState(false)
    const [blobUrl, setBlobUrl] = useState<string | null>(null)
    const context = useHappyChatContextSafe()
    const abortControllerRef = useRef<AbortController | null>(null)

    const handleOpen = useCallback(() => {
        setIsOpen(true)
    }, [])

    const handleClose = useCallback(() => {
        setIsOpen(false)
    }, [])

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            handleClose()
        }
    }, [handleClose])

    const api = context?.api ?? null

    // 使用带认证的 fetch 请求加载图片
    useEffect(() => {
        console.log('[ImageViewer] useEffect triggered', { src, hasApi: !!api, hasContext: !!context })

        if (!src || !api) {
            console.log('[ImageViewer] Missing src or api, waiting...', { src, hasApi: !!api })
            // 如果没有 api，等待而不是立即报错
            if (!api) {
                return
            }
            setHasError(true)
            setIsLoading(false)
            return
        }

        // 重置状态
        setIsLoading(true)
        setHasError(false)

        // 清理旧的 blob URL
        setBlobUrl(prevUrl => {
            if (prevUrl) {
                URL.revokeObjectURL(prevUrl)
            }
            return null
        })

        const abortController = new AbortController()

        let retryCount = 0
        const MAX_RETRIES = 2
        const RETRY_DELAY = 1000

        const fetchImage = async () => {
            console.log('[ImageViewer] fetchImage called, aborted?', abortController.signal.aborted)
            try {
                const token = api.getCurrentToken()
                console.log('[ImageViewer] Fetching image', { src, hasToken: !!token })
                const response = await fetch(src, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    signal: abortController.signal
                })

                console.log('[ImageViewer] Response received', { status: response.status, ok: response.ok, aborted: abortController.signal.aborted })

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`)
                }

                const blob = await response.blob()
                if (abortController.signal.aborted) return

                const url = URL.createObjectURL(blob)
                console.log('[ImageViewer] Created blob URL', { url })
                setBlobUrl(url)
                setIsLoading(false)
            } catch (error) {
                console.log('[ImageViewer] Fetch error', { error, retryCount })
                if (abortController.signal.aborted) return

                if (retryCount < MAX_RETRIES) {
                    retryCount++
                    setTimeout(fetchImage, RETRY_DELAY)
                } else {
                    setHasError(true)
                    setIsLoading(false)
                }
            }
        }

        fetchImage()

        return () => {
            console.log('[ImageViewer] Cleanup, aborting fetch')
            abortController.abort()
        }
    }, [src, api])

    useEffect(() => {
        if (!isOpen) return

        document.addEventListener('keydown', handleKeyDown)
        document.body.style.overflow = 'hidden'
        return () => {
            document.removeEventListener('keydown', handleKeyDown)
            document.body.style.overflow = ''
        }
    }, [isOpen, handleKeyDown])

    // 清理 blob URL
    useEffect(() => {
        return () => {
            if (blobUrl) {
                URL.revokeObjectURL(blobUrl)
            }
        }
    }, [blobUrl])

    if (hasError) {
        return (
            <div className={`inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs ${className}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                </svg>
                <span>Failed to load image</span>
            </div>
        )
    }

    return (
        <>
            <button
                type="button"
                onClick={handleOpen}
                className={`group relative inline-block cursor-pointer rounded-lg overflow-hidden border border-[var(--app-divider)] hover:border-[var(--app-link)] transition-colors ${className}`}
            >
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[var(--app-secondary-bg)] min-w-16 min-h-16">
                        <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    </div>
                )}
                {blobUrl && (
                    <img
                        src={blobUrl}
                        alt={alt}
                        className="max-h-48 max-w-full object-contain"
                    />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-lg">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            <line x1="11" y1="8" x2="11" y2="14" />
                            <line x1="8" y1="11" x2="14" y2="11" />
                        </svg>
                    </div>
                </div>
            </button>

            {isOpen && blobUrl && createPortal(
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
                    onClick={handleClose}
                >
                    <button
                        type="button"
                        onClick={handleClose}
                        className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                        aria-label="Close"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                    <img
                        src={blobUrl}
                        alt={alt}
                        onClick={(e) => e.stopPropagation()}
                        className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
                    />
                </div>,
                document.body
            )}
        </>
    )
}

// Parse text for [Image: path] patterns and return structured content
const ATTACHMENT_PATTERN = /\[(Image|File):\s*([^\]]+)\]/g

export function parseImagesFromText(text: string): Array<{ type: 'text' | 'image'; content: string }> {
    const imagePattern = /\[Image:\s*([^\]]+)\]/g
    const parts: Array<{ type: 'text' | 'image'; content: string }> = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = imagePattern.exec(text)) !== null) {
        // Add text before the image
        if (match.index > lastIndex) {
            const textContent = text.slice(lastIndex, match.index).trim()
            if (textContent) {
                parts.push({ type: 'text', content: textContent })
            }
        }
        // Add the image
        parts.push({ type: 'image', content: match[1].trim() })
        lastIndex = match.index + match[0].length
    }

    // Add remaining text
    if (lastIndex < text.length) {
        const textContent = text.slice(lastIndex).trim()
        if (textContent) {
            parts.push({ type: 'text', content: textContent })
        }
    }

    // If no images found, return the original text
    if (parts.length === 0 && text.trim()) {
        parts.push({ type: 'text', content: text })
    }

    return parts
}

// Check if text contains any image references
export function hasImageReferences(text: string): boolean {
    return /\[Image:\s*[^\]]+\]/.test(text)
}

export function parseAttachmentsFromText(text: string): { textParts: string[]; images: string[]; files: string[] } {
    const regex = new RegExp(ATTACHMENT_PATTERN.source, 'g')
    const textParts: string[] = []
    const images: string[] = []
    const files: string[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            const textContent = text.slice(lastIndex, match.index).trim()
            if (textContent) {
                textParts.push(textContent)
            }
        }
        const refType = match[1]?.toLowerCase()
        const refValue = match[2]?.trim()
        if (refType === 'image' && refValue) {
            images.push(refValue)
        } else if (refType === 'file' && refValue) {
            files.push(refValue)
        }
        lastIndex = match.index + match[0].length
    }

    if (lastIndex < text.length) {
        const textContent = text.slice(lastIndex).trim()
        if (textContent) {
            textParts.push(textContent)
        }
    }

    if (textParts.length === 0 && images.length === 0 && files.length === 0 && text.trim()) {
        textParts.push(text)
    }

    return { textParts, images, files }
}

export function hasAttachmentReferences(text: string): boolean {
    return new RegExp(ATTACHMENT_PATTERN.source).test(text)
}
