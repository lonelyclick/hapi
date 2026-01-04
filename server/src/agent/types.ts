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

// 操作步骤类型
export interface AdvisorActionStep {
    type: 'command' | 'edit' | 'create' | 'delete' | 'message'
    command?: string
    filePath?: string
    oldContent?: string
    newContent?: string
    content?: string
    message?: string
    description: string
}

// 操作类型
export type AdvisorActionType =
    | 'format_code' | 'fix_lint' | 'add_comments' | 'run_tests'
    | 'fix_type_errors' | 'update_deps' | 'refactor' | 'optimize'
    | 'edit_config' | 'create_file' | 'delete_file'
    | 'git_commit' | 'git_push' | 'deploy' | 'custom'

export interface AdvisorActionRequestOutput {
    type: 'action_request'
    id?: string
    actionType: AdvisorActionType
    targetSessionId?: string
    targetProject?: string
    steps: AdvisorActionStep[]
    reason: string
    expectedOutcome?: string
    riskLevel?: 'low' | 'medium' | 'high'
    reversible?: boolean
    dependsOn?: string[]
    sourceSessionId?: string
    confidence?: number
}

export interface AdvisorMemoryOutput {
    type: 'memory'
    memoryType: MemoryType
    content: string
    confidence: number
    expiresInDays?: number
}

// Advisor 请求创建新会话
export interface AdvisorSpawnSessionOutput {
    type: 'spawn_session'
    id?: string
    taskDescription: string           // 任务描述，作为新会话的初始消息
    workingDir?: string               // 工作目录（可选，默认使用 advisorWorkingDir）
    agent?: 'claude' | 'codex' | 'gemini' | 'glm' | 'minimax' | 'grok'  // Agent 类型
    yolo?: boolean                    // 是否自动执行命令
    sessionType?: 'simple' | 'worktree'  // 会话类型
    reason: string                    // 为什么需要创建这个会话
    expectedOutcome?: string          // 预期结果
    parentSessionId?: string          // 父会话 ID（用于追踪）
}

// Advisor 向子会话发送消息
export interface AdvisorSendToSessionOutput {
    type: 'send_to_session'
    sessionId: string                 // 目标子会话 ID
    message: string                   // 要发送的消息内容
    reason?: string                   // 为什么发送这条消息
}

export type AdvisorOutput = AdvisorSuggestionOutput | AdvisorActionRequestOutput | AdvisorMemoryOutput | AdvisorSpawnSessionOutput | AdvisorSendToSessionOutput

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

// 正则匹配模式 - 匹配 [[HAPI_ADVISOR]] 标记位置
export const ADVISOR_OUTPUT_MARKER = /\[\[HAPI_ADVISOR\]\]/g

// 从位置开始提取完整 JSON 对象
export function extractJsonFromPosition(text: string, startPos: number): string | null {
    // 跳过空白和 markdown 代码块标记
    let pos = startPos
    while (pos < text.length) {
        const char = text[pos]
        // 跳过空白
        if (/\s/.test(char)) {
            pos++
            continue
        }
        // 跳过 markdown 代码块开始标记 ```json 或 ```
        if (text.slice(pos, pos + 3) === '```') {
            pos += 3
            // 跳过可能的语言标识符（如 json）
            while (pos < text.length && text[pos] !== '\n' && text[pos] !== '{') {
                pos++
            }
            // 跳过换行
            if (text[pos] === '\n') {
                pos++
            }
            continue
        }
        break
    }

    if (text[pos] !== '{') {
        return null
    }

    // 手动匹配括号，处理嵌套
    let depth = 0
    let inString = false
    let escape = false
    const start = pos

    for (; pos < text.length; pos++) {
        const char = text[pos]

        if (escape) {
            escape = false
            continue
        }

        if (char === '\\' && inString) {
            escape = true
            continue
        }

        if (char === '"' && !escape) {
            inString = !inString
            continue
        }

        if (!inString) {
            if (char === '{') {
                depth++
            } else if (char === '}') {
                depth--
                if (depth === 0) {
                    return text.slice(start, pos + 1)
                }
            }
        }
    }

    return null
}
