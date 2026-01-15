/**
 * Review AI 按钮组件
 *
 * 显示在 Session Header 上，用于：
 * 1. 如果没有 Review Session，显示创建按钮
 * 2. 如果有 Review Session，显示图标 + 待审数量，点击打开/关闭面板
 */

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'

// 支持的 Review 模型选项（直接选择，不需要子级变体）
const REVIEW_MODELS = [
    { value: 'claude', label: 'Claude' },
    { value: 'codex', label: 'Codex' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'grok', label: 'Grok' }
] as const

function ReviewIcon(props: { className?: string }) {
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
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M8 10h.01" />
            <path d="M12 10h.01" />
            <path d="M16 10h.01" />
        </svg>
    )
}

function ChevronDownIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="6 9 12 15 18 9" />
        </svg>
    )
}

export function JoinReviewButton(props: {
    sessionId: string
    /** 是否已打开 Review 面板 */
    isReviewPanelOpen?: boolean
    /** 点击已有 Review 时触发 */
    onToggleReviewPanel?: () => void
    /** 创建新 Review 后触发 */
    onReviewCreated?: (reviewSessionId: string) => void
}) {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const [showMenu, setShowMenu] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    // 查询当前 Session 的活跃 Review Session
    const { data: activeReviewSession } = useQuery({
        queryKey: ['review-sessions', 'active', props.sessionId],
        queryFn: async () => {
            try {
                return await api.getActiveReviewSession(props.sessionId)
            } catch {
                return null
            }
        },
        staleTime: 0
    })

    // 查询待审轮次数量（如果有 Review Session）
    const { data: pendingRoundsData } = useQuery({
        queryKey: ['review-pending-rounds', activeReviewSession?.id],
        queryFn: async () => {
            if (!activeReviewSession?.id) throw new Error('No review ID')
            return await api.getReviewPendingRounds(activeReviewSession.id)
        },
        enabled: Boolean(activeReviewSession?.id),
        staleTime: 30000
    })

    // 点击外部关闭菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMenu(false)
            }
        }
        if (showMenu) {
            document.addEventListener('mousedown', handleClickOutside)
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [showMenu])

    const createReviewMutation = useMutation({
        mutationFn: async (model: string) => {
            return await api.createReviewSession({
                mainSessionId: props.sessionId,
                reviewModel: model
            })
        },
        onSuccess: (result) => {
            setShowMenu(false)
            queryClient.invalidateQueries({ queryKey: ['review-sessions', props.sessionId] })
            queryClient.invalidateQueries({ queryKey: ['review-sessions', 'active', props.sessionId] })
            props.onReviewCreated?.(result.reviewSessionId)
        }
    })

    const handleModelSelect = (model: string) => {
        createReviewMutation.mutate(model)
    }

    // 计算待审数量
    const unreviewedCount = pendingRoundsData?.unreviewedRounds ?? 0
    const hasPending = pendingRoundsData?.hasPendingRounds ?? false

    // 如果已有 Review Session，显示图标 + 数量按钮
    if (activeReviewSession?.reviewSessionId) {
        // 只有当有待审轮次或正在同步时才显示数量
        const showCount = unreviewedCount > 0 || hasPending
        return (
            <button
                type="button"
                onClick={props.onToggleReviewPanel}
                className={`flex h-7 items-center gap-1 rounded-md px-2 transition-colors ${
                    props.isReviewPanelOpen
                        ? 'bg-purple-500/20 text-purple-600'
                        : 'bg-purple-500/10 text-purple-600 hover:bg-purple-500/20'
                }`}
                title={props.isReviewPanelOpen ? '关闭 Review 面板' : '打开 Review 面板'}
            >
                <ReviewIcon />
                {showCount && (
                    <span className={`text-xs font-medium ${hasPending ? 'text-amber-500' : ''}`}>
                        {hasPending ? '...' : unreviewedCount}
                    </span>
                )}
            </button>
        )
    }

    // 没有 Review Session，显示创建按钮
    return (
        <div className="relative" ref={menuRef}>
            <button
                type="button"
                onClick={() => setShowMenu(!showMenu)}
                disabled={createReviewMutation.isPending}
                className="flex h-7 items-center gap-1 rounded-md bg-purple-500/10 px-2 text-purple-600 transition-colors hover:bg-purple-500/20 disabled:opacity-50"
                title="创建 Review AI"
            >
                <ReviewIcon />
                <ChevronDownIcon />
            </button>

            {showMenu && (
                <div className="absolute right-0 top-full z-30 mt-1 min-w-[140px] rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] py-1 shadow-lg">
                    <div className="px-3 py-1.5 text-[10px] font-medium text-[var(--app-hint)] uppercase tracking-wider">
                        选择 Review AI
                    </div>
                    {REVIEW_MODELS.map((model) => (
                        <button
                            key={model.value}
                            type="button"
                            onClick={() => handleModelSelect(model.value)}
                            disabled={createReviewMutation.isPending}
                            className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                        >
                            {model.label}
                        </button>
                    ))}
                    {createReviewMutation.isPending && (
                        <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
                            正在创建...
                        </div>
                    )}
                    {createReviewMutation.isError && (
                        <div className="px-3 py-2 text-xs text-red-500">
                            创建失败: {(createReviewMutation.error as Error)?.message || '未知错误'}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
