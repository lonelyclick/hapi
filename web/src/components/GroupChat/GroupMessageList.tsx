import { useCallback, useEffect, useRef } from 'react'
import type { AgentGroupMessage } from '@/types/api'
import { GroupMessageItem } from './GroupMessageItem'
import { Spinner } from '@/components/Spinner'

type GroupMessageListProps = {
    messages: AgentGroupMessage[]
    isLoading?: boolean
    hasMore?: boolean
    onLoadMore?: () => void
}

export function GroupMessageList(props: GroupMessageListProps) {
    const { messages, isLoading = false, hasMore = false, onLoadMore } = props
    const containerRef = useRef<HTMLDivElement>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const prevMessagesLengthRef = useRef(0)

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        if (messages.length > prevMessagesLengthRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
        prevMessagesLengthRef.current = messages.length
    }, [messages.length])

    // Handle scroll for load more
    const handleScroll = useCallback(() => {
        const container = containerRef.current
        if (!container || !hasMore || isLoading || !onLoadMore) return

        // Load more when scrolled near top
        if (container.scrollTop < 100) {
            onLoadMore()
        }
    }, [hasMore, isLoading, onLoadMore])

    // Sort messages by createdAt (oldest first)
    const sortedMessages = [...messages].sort((a, b) => a.createdAt - b.createdAt)

    if (isLoading && messages.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Spinner className="w-6 h-6" />
            </div>
        )
    }

    if (messages.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--app-hint)] px-4">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-50 mb-3"
                >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <p className="text-sm">还没有消息</p>
                <p className="text-xs mt-1">发送第一条消息开始群聊</p>
            </div>
        )
    }

    return (
        <div
            ref={containerRef}
            className="flex-1 overflow-y-auto px-3"
            onScroll={handleScroll}
        >
            <div className="mx-auto w-full max-w-content py-3">
                {/* Load more indicator */}
                {hasMore && (
                    <div className="flex justify-center py-2">
                        {isLoading ? (
                            <Spinner className="w-5 h-5" />
                        ) : (
                            <button
                                type="button"
                                onClick={onLoadMore}
                                className="text-xs text-[var(--app-link)] hover:underline"
                            >
                                加载更多消息
                            </button>
                        )}
                    </div>
                )}

                {/* Messages */}
                {sortedMessages.map((message) => (
                    <GroupMessageItem
                        key={message.id}
                        message={message}
                    />
                ))}

                {/* Scroll anchor */}
                <div ref={bottomRef} />
            </div>
        </div>
    )
}
