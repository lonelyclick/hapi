import React, { useRef, useState, useEffect, useMemo } from 'react'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { ImageViewer, parseAttachmentsFromText, hasAttachmentReferences } from '@/components/ImageViewer'
import { FileIcon } from '@/components/FileIcon'
import { useHappyChatContextSafe } from '@/components/AssistantChat/context'

// 特效单词列表 - 可以轻松扩展
const RAINBOW_WORDS = [
    'ultrathink',
    'fuck',
    'step by step',
    'ELI5',
    'lgtm',
    'impl it',
    'pls fix',
    'stop changing',
    '用中文',
    '我说了',
    '别又',
    '为什么又',
    '根本不',
    '还是报错',
    '大哥',
    '求你',
    '就改这里',
    '弱智',
]

// 转义正则特殊字符
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 动态构建正则表达式
function buildPattern(words: string[]): RegExp {
    const pattern = words.map(escapeRegExp).join('|')
    return new RegExp(`(${pattern})`, 'gi')
}

// 快速检查是否包含任何特效单词
function hasAnySpecialWord(text: string, words: string[]): boolean {
    const lowerText = text.toLowerCase()
    return words.some(word => lowerText.includes(word.toLowerCase()))
}

const RAINBOW_PATTERN = buildPattern(RAINBOW_WORDS)

// Each letter gets a different delay for wave effect
function RainbowWord({ word, baseKey }: { word: string; baseKey: number }) {
    const totalLetters = word.length
    const cycleDuration = 2 // seconds for sparkle to travel across all letters

    return (
        <span>
            {word.split('').map((letter, i) => {
                // Each letter has a different delay to create wave effect
                const colorDelay = (i / totalLetters) * 2 // stagger rainbow colors
                const sparkleDelay = (i / totalLetters) * cycleDuration // sparkle wave

                return (
                    <span
                        key={`${baseKey}-${i}`}
                        className="rainbow-letter"
                        style={{
                            animationDelay: `${-colorDelay}s, ${-sparkleDelay}s`,
                        }}
                    >
                        {letter === ' ' ? '\u00A0' : letter}
                    </span>
                )
            })}
        </span>
    )
}

// Process text string to wrap special words with RainbowWord
function processTextForRainbow(text: string): React.ReactNode {
    RAINBOW_PATTERN.lastIndex = 0
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = RAINBOW_PATTERN.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index))
        }
        parts.push(<RainbowWord key={match.index} word={match[1]} baseKey={match.index} />)
        lastIndex = match.index + match[0].length
    }

    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex))
    }

    return <>{parts}</>
}

// Process React children to apply rainbow to text nodes
function processChildrenForRainbow(children: React.ReactNode): React.ReactNode {
    return React.Children.map(children, (child) => {
        if (typeof child === 'string') {
            return processTextForRainbow(child)
        }
        return child
    })
}

// Build image URL from relative path
function buildImageUrl(path: string, sessionId: string): string {
    // The image is stored in .hapi/uploads/ directory on the CLI side
    // We need to fetch it through the session file read API
    const encodedPath = encodeURIComponent(path)
    return `/api/sessions/${encodeURIComponent(sessionId)}/file?path=${encodedPath}&raw=true`
}

function buildFileUrl(path: string, sessionId: string): string {
    const encodedPath = encodeURIComponent(path)
    return `/api/sessions/${encodeURIComponent(sessionId)}/file?path=${encodedPath}&raw=true&download=true`
}

function getDisplayNameFromPath(path: string): string {
    const name = path.split('/').pop() ?? path
    return name
        .replace(/-\d{13}(?=\.[^./]+$)/, '')
        .replace(/-\d{13}$/, '')
}

// Component to render images from message
function MessageImages({ images, sessionId }: { images: string[]; sessionId: string }) {
    if (images.length === 0) return null

    return (
        <div className="flex flex-wrap gap-2 mt-2">
            {images.map((imagePath, index) => (
                <ImageViewer
                    key={`${imagePath}-${index}`}
                    src={buildImageUrl(imagePath, sessionId)}
                    alt={`Uploaded image ${index + 1}`}
                />
            ))}
        </div>
    )
}

function MessageFiles({ files, sessionId }: { files: string[]; sessionId: string }) {
    if (files.length === 0) return null

    return (
        <div className="flex flex-col gap-2 mt-2">
            {files.map((filePath, index) => {
                const displayName = getDisplayNameFromPath(filePath)
                return (
                    <a
                        key={`${filePath}-${index}`}
                        href={buildFileUrl(filePath, sessionId)}
                        download
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-2 py-1 text-xs text-[var(--app-fg)] hover:border-[var(--app-link)]"
                        title={filePath}
                    >
                        <FileIcon fileName={displayName} size={16} />
                        <span className="truncate">{displayName}</span>
                        <span className="ml-auto text-[10px] text-[var(--app-hint)]">下载</span>
                    </a>
                )
            })}
        </div>
    )
}

export function LazyRainbowText(props: { text: string }) {
    const text = props.text
    const ref = useRef<HTMLDivElement>(null)
    const [hasBeenVisible, setHasBeenVisible] = useState(false)

    // Get context for building image URLs (safe version that won't throw)
    const context = useHappyChatContextSafe()
    const sessionId = context?.sessionId ?? ''

    useEffect(() => {
        const el = ref.current
        if (!el) return

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setHasBeenVisible(true)
                }
            },
            { rootMargin: '100px' }
        )

        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    // Quick check: if no special words, just render markdown
    const hasSpecialWord = hasAnySpecialWord(text, RAINBOW_WORDS)

    // Check for attachment references
    const containsAttachments = hasAttachmentReferences(text)

    const rainbowComponents = useMemo(() => ({
        p: ({ children }: { children?: React.ReactNode }) => (
            <p>{processChildrenForRainbow(children)}</p>
        ),
    }), [])

    // If text contains attachments, parse and render them separately
    if (containsAttachments && sessionId) {
        const { textParts, images, files } = parseAttachmentsFromText(text)
        const textContent = textParts.join('\n\n')

        return (
            <div ref={ref}>
                {textContent && (
                    <MarkdownRenderer
                        content={textContent}
                        components={hasSpecialWord && hasBeenVisible ? rainbowComponents : undefined}
                    />
                )}
                <MessageImages images={images} sessionId={sessionId} />
                <MessageFiles files={files} sessionId={sessionId} />
            </div>
        )
    }

    return (
        <div ref={ref}>
            <MarkdownRenderer
                content={text}
                components={hasSpecialWord && hasBeenVisible ? rainbowComponents : undefined}
            />
        </div>
    )
}
