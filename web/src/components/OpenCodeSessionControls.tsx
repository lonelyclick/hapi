import { useState } from 'react'
import type { SessionSummary } from '@/types/api'
import { ApiClient } from '@/api/client'

interface OpenCodeSessionControlsProps {
    session: SessionSummary
    onUpdate: () => void
}

export function OpenCodeSessionControls({ session, onUpdate }: OpenCodeSessionControlsProps) {
    const [isUpdating, setIsUpdating] = useState(false)
    const [showModelSelector, setShowModelSelector] = useState(false)
    
    const api = new ApiClient('') // Token会在useAuth中设置

    // OpenCode 模型选项
    const openCodeModels = [
        { value: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4', provider: 'Anthropic' },
        { value: 'anthropic/claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', provider: 'Anthropic' },
        { value: 'openai/gpt-4o-2024-08-06', label: 'GPT-4o', provider: 'OpenAI' },
        { value: 'openai/gpt-4o-mini-2024-07-18', label: 'GPT-4o Mini', provider: 'OpenAI' },
        { value: 'openai/o1-preview-2024-12-17', label: 'o1 Preview', provider: 'OpenAI' },
        { value: 'openai/o1-mini-2024-12-17', label: 'o1 Mini', provider: 'OpenAI' }
    ]

    const reasoningEfforts = [
        { value: 'low', label: '🟢 低推理强度', description: '快速响应，适合简单任务' },
        { value: 'medium', label: '🟡 中等推理强度', description: '平衡速度和质量' },
        { value: 'high', label: '🟠 高推理强度', description: '深度思考，适合复杂任务' },
        { value: 'xhigh', label: '🔴 极高推理强度', description: '最强推理，适合最难任务' }
    ]

    const currentModel = session.metadata?.runtimeModel || 'anthropic/claude-sonnet-4-20250514'
    const currentEffort = session.metadata?.runtimeModelReasoningEffort

    async function handleModelChange(newModel: string) {
        setIsUpdating(true)
        try {
            await api.setModelMode(session.id, { model: newModel })
            onUpdate()
        } catch (error) {
            console.error('Failed to update OpenCode model:', error)
        } finally {
            setIsUpdating(false)
            setShowModelSelector(false)
        }
    }

    async function handleReasoningEffortChange(newEffort: string) {
        setIsUpdating(true)
        try {
            await api.setModelMode(session.id, { 
                model: currentModel, 
                reasoningEffort: newEffort 
            })
            onUpdate()
        } catch (error) {
            console.error('Failed to update reasoning effort:', error)
        } finally {
            setIsUpdating(false)
        }
    }

    function getModelProvider(model: string): string {
        if (model.startsWith('anthropic/')) return 'Anthropic'
        if (model.startsWith('openai/')) return 'OpenAI'
        return 'Other'
    }

    if (session.metadata?.flavor !== 'opencode') {
        return null
    }

    return (
        <div className="border-t border-[var(--app-divider)] pt-3 mt-3">
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-[var(--app-fg)]">OpenCode 控制</h4>
                <div className="flex items-center gap-2">
                    {session.metadata?.opencodeStatus?.errorCount && session.metadata.opencodeStatus.errorCount > 0 && (
                        <span className="text-xs text-red-500 bg-red-500/10 px-2 py-1 rounded">
                            ⚠️ {session.metadata.opencodeStatus.errorCount} 错误
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => setShowModelSelector(!showModelSelector)}
                        className="text-xs px-2 py-1 bg-[var(--app-subtle-bg)] text-[var(--app-fg)] rounded hover:bg-[var(--app-secondary-bg)] transition-colors"
                        disabled={isUpdating}
                    >
                        {isUpdating ? '更新中...' : '⚙️ 配置'}
                    </button>
                </div>
            </div>

            {showModelSelector && (
                <div className="space-y-4 p-3 bg-[var(--app-subtle-bg)] rounded-lg">
                    {/* 模型选择 */}
                    <div>
                        <label className="block text-xs font-medium text-[var(--app-fg)] mb-2">
                            🤖 模型选择
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {openCodeModels.map((model) => (
                                <button
                                    key={model.value}
                                    type="button"
                                    onClick={() => handleModelChange(model.value)}
                                    disabled={isUpdating || currentModel === model.value}
                                    className={`
                                        text-left p-2 rounded text-xs transition-colors
                                        ${currentModel === model.value
                                            ? 'bg-[var(--app-link)] text-white'
                                            : 'bg-[var(--app-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                                        }
                                        ${isUpdating ? 'opacity-50 cursor-not-allowed' : ''}
                                    `}
                                >
                                    <div className="font-medium">{model.label}</div>
                                    <div className="text-[10px] opacity-75">{model.provider}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 推理努力级别 - 仅对OpenAI模型有效 */}
                    {currentModel.startsWith('openai/') && (
                        <div>
                            <label className="block text-xs font-medium text-[var(--app-fg)] mb-2">
                                🧠 推理努力级别
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {reasoningEfforts.map((effort) => (
                                    <button
                                        key={effort.value}
                                        type="button"
                                        onClick={() => handleReasoningEffortChange(effort.value)}
                                        disabled={isUpdating || currentEffort === effort.value}
                                        className={`
                                            text-left p-2 rounded text-xs transition-colors
                                            ${currentEffort === effort.value
                                                ? 'bg-[var(--app-link)] text-white'
                                                : 'bg-[var(--app-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                                            }
                                            ${isUpdating ? 'opacity-50 cursor-not-allowed' : ''}
                                        `}
                                    >
                                        <div className="font-medium">{effort.label}</div>
                                        <div className="text-[10px] opacity-75">{effort.description}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 当前配置显示 */}
                    <div className="pt-2 border-t border-[var(--app-divider)]">
                        <div className="text-xs text-[var(--app-hint)] space-y-1">
                            <div>当前模型: <span className="font-medium text-[var(--app-fg)]">{getModelProvider(currentModel)} / {currentModel.split('/')[1]}</span></div>
                            {currentEffort && <div>推理强度: <span className="font-medium text-[var(--app-fg)]">{currentEffort}</span></div>}
                            {session.metadata?.opencodeCapabilities && (
                                <div>支持能力: {
                                    Object.entries(session.metadata.opencodeCapabilities)
                                        .filter(([_, enabled]) => enabled)
                                        .map(([capability]) => {
                                            const labels: Record<string, string> = {
                                                fs: '文件系统',
                                                terminal: '终端',
                                                mcp: 'MCP服务器',
                                                tools: `工具 (${session.metadata.opencodeCapabilities.tools?.length || 0})`
                                            }
                                            return labels[capability] || capability
                                        })
                                        .join(', ')
                                }</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}