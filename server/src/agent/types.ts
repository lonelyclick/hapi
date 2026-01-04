/**
 * Advisor Agent 类型定义
 */

export type SuggestionCategory = 'product' | 'architecture' | 'operation' | 'strategy' | 'collaboration'
export type SuggestionSeverity = 'low' | 'medium' | 'high' | 'critical'
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'stale' | 'superseded'
export type SuggestionScope = 'session' | 'project' | 'team' | 'global'
export type MemoryType = 'insight' | 'pattern' | 'decision' | 'lesson'

// Advisor 输出的 JSON 格式
export interface AdvisorSuggestionOutput {
    type: 'suggestion'
    id?: string
    category: SuggestionCategory
    title: string
    detail: string
    severity: SuggestionSeverity
    confidence: number
    scope: SuggestionScope
    targets?: string[]
    sourceSessionId?: string
    evidence?: string[]
    suggestedActions?: string[]
}

export interface AdvisorActionRequestOutput {
    type: 'action_request'
    intent: 'run' | 'notify' | 'escalate'
    targetSessionId?: string
    steps: string[]
    reason: string
    urgency: 'low' | 'medium' | 'high'
    requiresApproval: boolean
}

export interface AdvisorMemoryOutput {
    type: 'memory'
    memoryType: MemoryType
    content: string
    confidence: number
    expiresInDays?: number
}

export type AdvisorOutput = AdvisorSuggestionOutput | AdvisorActionRequestOutput | AdvisorMemoryOutput

// 会话摘要格式
export interface SessionSummary {
    sessionId: string
    namespace: string
    workDir: string
    user?: string
    project?: string
    recentActivity: string
    todos?: unknown[]
    codeChanges?: string[]
    errors?: string[]
    decisions?: string[]
    messageCount: number
    lastMessageSeq: number
    timestamp: number
}

// 证据类型
export interface Evidence {
    type: 'explicit_accept' | 'explicit_reject' | 'code_change' | 'todo_done' | 'test_pass' | 'rollback' | 'alternative' | 'summary_applied' | 'message'
    source: 'message' | 'summary' | 'code'
    weight: number
    content?: string
    target?: string
}

// 广播事件数据
export interface AdvisorSuggestionEvent {
    type: 'advisor-suggestion'
    suggestionId: string
    title: string
    detail?: string
    category?: SuggestionCategory
    severity: SuggestionSeverity
    confidence: number
    scope: SuggestionScope
    sourceSessionId?: string
}

export interface AdvisorSuggestionStatusEvent {
    type: 'advisor-suggestion-status'
    suggestionId: string
    title: string
    status: SuggestionStatus
}

// 空闲建议事件（会话静默后触发）
export interface AdvisorIdleSuggestionEvent {
    type: 'advisor-idle-suggestion'
    suggestionId: string
    sessionId: string
    title: string
    detail: string
    reason: string  // 触发原因
    category: 'todo_check' | 'error_analysis' | 'code_review' | 'general'
    severity: SuggestionSeverity
    suggestedText?: string  // 建议填入输入框的文本
    createdAt: number
}

export type AdvisorEventData = AdvisorSuggestionEvent | AdvisorSuggestionStatusEvent | AdvisorIdleSuggestionEvent

// 事件消息格式
export interface AdvisorEventMessage {
    role: 'agent'
    content: {
        type: 'event'
        data: AdvisorEventData
    }
    meta: {
        sentFrom: 'advisor'
    }
}

// 正则匹配模式
export const ADVISOR_OUTPUT_PATTERN = /\[\[HAPI_ADVISOR\]\]\s*(\{[\s\S]*?\})/g
