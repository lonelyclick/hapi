/**
 * Join Review AI 按钮组件
 *
 * 这是一个试验性功能，用于多 Session 协作 Review 模式
 */

import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'

// 支持的 Review 模型选项
const REVIEW_MODELS = [
    { value: 'claude', label: 'Claude', variants: ['opus', 'sonnet', 'haiku'] },
    { value: 'codex', label: 'Codex', variants: ['gpt-5.2-codex', 'gpt-5.1-codex-max'] },
    { value: 'gemini', label: 'Gemini', variants: [] },
    { value: 'grok', label: 'Grok', variants: [] }
] as const

function UsersIcon(props: { className?: string }) {
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
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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
    onReviewCreated?: (reviewSessionId: string) => void
}) {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const [showMenu, setShowMenu] = useState(false)
    const [selectedModel, setSelectedModel] = useState<string | null>(null)
    const menuRef = useRef<HTMLDivElement>(null)

    // 点击外部关闭菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMenu(false)
                setSelectedModel(null)
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
        mutationFn: async (data: { model: string; variant?: string }) => {
            return await api.createReviewSession({
                mainSessionId: props.sessionId,
                reviewModel: data.model,
                reviewModelVariant: data.variant
            })
        },
        onSuccess: (result) => {
            setShowMenu(false)
            setSelectedModel(null)
            setSelectedVariant(null)
            queryClient.invalidateQueries({ queryKey: ['review-sessions', props.sessionId] })
            props.onReviewCreated?.(result.reviewSessionId)
        }
    })

    const handleModelSelect = (model: string) => {
        const modelConfig = REVIEW_MODELS.find(m => m.value === model)
        if (modelConfig && modelConfig.variants.length > 0) {
            setSelectedModel(model)
        } else {
            // 没有变体，直接创建
            createReviewMutation.mutate({ model })
        }
    }

    const handleVariantSelect = (variant: string) => {
        if (selectedModel) {
            createReviewMutation.mutate({ model: selectedModel, variant })
        }
    }

    const currentModelConfig = selectedModel
        ? REVIEW_MODELS.find(m => m.value === selectedModel)
        : null

    return (
        <div className="relative" ref={menuRef}>
            <button
                type="button"
                onClick={() => setShowMenu(!showMenu)}
                disabled={createReviewMutation.isPending}
                className="flex h-7 items-center gap-1 rounded-md bg-purple-500/10 px-2 text-purple-600 transition-colors hover:bg-purple-500/20 disabled:opacity-50"
                title="Join Review AI"
            >
                <UsersIcon />
                <span className="text-xs font-medium">Review</span>
                <ChevronDownIcon />
            </button>

            {showMenu && (
                <div className="absolute right-0 top-full z-30 mt-1 min-w-[180px] rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] py-1 shadow-lg">
                    {!selectedModel ? (
                        <>
                            <div className="px-3 py-1.5 text-[10px] font-medium text-[var(--app-hint)] uppercase tracking-wider">
                                选择 Review AI
                            </div>
                            {REVIEW_MODELS.map((model) => (
                                <button
                                    key={model.value}
                                    type="button"
                                    onClick={() => handleModelSelect(model.value)}
                                    disabled={createReviewMutation.isPending}
                                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                                >
                                    <span>{model.label}</span>
                                    {model.variants.length > 0 && (
                                        <ChevronDownIcon className="rotate-[-90deg]" />
                                    )}
                                </button>
                            ))}
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={() => setSelectedModel(null)}
                                className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-[10px] font-medium text-[var(--app-hint)] uppercase tracking-wider hover:bg-[var(--app-subtle-bg)]"
                            >
                                <ChevronDownIcon className="rotate-90" />
                                <span>{currentModelConfig?.label} - 选择变体</span>
                            </button>
                            {currentModelConfig?.variants.map((variant) => (
                                <button
                                    key={variant}
                                    type="button"
                                    onClick={() => handleVariantSelect(variant)}
                                    disabled={createReviewMutation.isPending}
                                    className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                                >
                                    {variant}
                                </button>
                            ))}
                        </>
                    )}
                    {createReviewMutation.isPending && (
                        <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
                            正在创建 Review Session...
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
