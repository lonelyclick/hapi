/**
 * Agent 类型定义
 */

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
