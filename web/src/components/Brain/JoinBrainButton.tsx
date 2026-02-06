/**
 * Brain AI 按钮组件
 *
 * 显示在 Session Header 上，用于：
 * 1. 如果没有 Brain Session，显示创建按钮
 * 2. 如果有 Brain Session，显示图标 + 待审数量，点击打开/关闭面板
 */

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'

// 支持的 Brain 模型选项（直接选择，不需要子级变体）
const BRAIN_MODELS = [
    { value: 'claude', label: 'Claude' },
    { value: 'codex', label: 'Codex' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'grok', label: 'Grok' }
] as const

function BrainIcon(props: { className?: string }) {
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

export function JoinBrainButton(props: {
    sessionId: string
    /** 是否已打开 Brain 面板 */
    isBrainPanelOpen?: boolean
    /** 点击已有 Brain 时触发 */
    onToggleBrainPanel?: () => void
    /** 创建新 Brain 后触发 */
    onBrainCreated?: (brainSessionId: string) => void
}) {
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const [showMenu, setShowMenu] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    // 查询当前 Session 的活跃 Brain Session
    const { data: activeBrainSession } = useQuery({
        queryKey: ['brain-sessions', 'active', props.sessionId],
        queryFn: async () => {
            try {
                return await api.getActiveBrainSession(props.sessionId)
            } catch {
                return null
            }
        },
        staleTime: 0
    })

    // 查询待审轮次数量（如果有 Brain Session）
    const { data: pendingRoundsData } = useQuery({
        queryKey: ['brain-pending-rounds', activeBrainSession?.id],
        queryFn: async () => {
            if (!activeBrainSession?.id) throw new Error('No brain ID')
            return await api.getBrainPendingRounds(activeBrainSession.id)
        },
        enabled: Boolean(activeBrainSession?.id),
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

    const createBrainMutation = useMutation({
        mutationFn: async (model: string) => {
            return await api.createBrainSession({
                mainSessionId: props.sessionId,
                brainModel: model
            })
        },
        onSuccess: (result) => {
            setShowMenu(false)
            queryClient.invalidateQueries({ queryKey: ['brain-sessions', props.sessionId] })
            queryClient.invalidateQueries({ queryKey: ['brain-sessions', 'active', props.sessionId] })
            props.onBrainCreated?.(result.brainSessionId)
        }
    })

    const handleModelSelect = (model: string) => {
        createBrainMutation.mutate(model)
    }

    // 计算待审数量
    const unreviewedCount = pendingRoundsData?.unreviewedRounds ?? 0
    const hasPending = pendingRoundsData?.hasPendingRounds ?? false

    // 如果已有 Brain Session，显示图标 + 数量按钮
    if (activeBrainSession?.brainSessionId) {
        // 只有当有待审轮次或正在同步时才显示数量
        const showCount = unreviewedCount > 0 || hasPending
        return (
            <button
                type="button"
                onClick={props.onToggleBrainPanel}
                className={`flex h-7 items-center gap-1 rounded-md px-2 transition-colors ${
                    props.isBrainPanelOpen
                        ? 'bg-purple-500/20 text-purple-600'
                        : 'bg-purple-500/10 text-purple-600 hover:bg-purple-500/20'
                }`}
                title={props.isBrainPanelOpen ? '关闭 Brain 面板' : '打开 Brain 面板'}
            >
                <BrainIcon />
                {showCount && (
                    <span className={`text-xs font-medium ${hasPending ? 'text-amber-500' : ''}`}>
                        {hasPending ? '...' : unreviewedCount}
                    </span>
                )}
            </button>
        )
    }

    // 没有 Brain Session，显示创建按钮
    return (
        <div className="relative" ref={menuRef}>
            <button
                type="button"
                onClick={() => setShowMenu(!showMenu)}
                disabled={createBrainMutation.isPending}
                className="flex h-7 items-center gap-1 rounded-md bg-purple-500/10 px-2 text-purple-600 transition-colors hover:bg-purple-500/20 disabled:opacity-50"
                title="创建 Brain AI"
            >
                <BrainIcon />
                <ChevronDownIcon />
            </button>

            {showMenu && (
                <div className="absolute right-0 top-full z-30 mt-1 min-w-[140px] rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] py-1 shadow-lg">
                    <div className="px-3 py-1.5 text-[10px] font-medium text-[var(--app-hint)] uppercase tracking-wider">
                        选择 Brain AI
                    </div>
                    {BRAIN_MODELS.map((model) => (
                        <button
                            key={model.value}
                            type="button"
                            onClick={() => handleModelSelect(model.value)}
                            disabled={createBrainMutation.isPending}
                            className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                        >
                            {model.label}
                        </button>
                    ))}
                    {createBrainMutation.isPending && (
                        <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
                            正在创建...
                        </div>
                    )}
                    {createBrainMutation.isError && (
                        <div className="px-3 py-2 text-xs text-red-500">
                            创建失败: {(createBrainMutation.error as Error)?.message || '未知错误'}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
