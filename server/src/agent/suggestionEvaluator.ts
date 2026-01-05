/**
 * SuggestionEvaluator - 自动判断建议是否被采纳
 */

import type { IStore } from '../store/interface'
import type { StoredAgentSuggestion, SuggestionStatus } from '../store'
import type { SyncEngine } from '../sync/syncEngine'
import type { Evidence } from './types'

interface EvaluationResult {
    status: SuggestionStatus
    posScore: number
    negScore: number
    evidence: Evidence[]
}

// 正向信号模式
const POSITIVE_PATTERNS: Array<{ pattern: RegExp; weight: number; name: Evidence['type'] }> = [
    { pattern: /明确采纳|已完成|done|采用了|implemented|已实现|按建议/i, weight: 0.70, name: 'explicit_accept' },
    { pattern: /TODO.*完成|✓|✅|已修复|fixed/i, weight: 0.30, name: 'todo_done' },
    { pattern: /测试通过|tests? pass|错误消失|error resolved/i, weight: 0.20, name: 'test_pass' },
    { pattern: /已应用|applied|已采用/i, weight: 0.40, name: 'summary_applied' }
]

// 负向信号模式
const NEGATIVE_PATTERNS: Array<{ pattern: RegExp; weight: number; name: Evidence['type'] }> = [
    { pattern: /拒绝|不用|不采纳|rejected|忽略|skip|不需要/i, weight: 0.70, name: 'explicit_reject' },
    { pattern: /回滚|revert|撤销|undo/i, weight: 0.40, name: 'rollback' },
    { pattern: /替代方案|另一种方法|chose.*instead|用了其他/i, weight: 0.50, name: 'alternative' }
]

export class SuggestionEvaluator {
    constructor(
        private store: IStore,
        private syncEngine: SyncEngine
    ) {}

    /**
     * 评估建议状态
     */
    async evaluate(suggestionId: string): Promise<EvaluationResult | null> {
        const suggestion = await this.store.getAgentSuggestion(suggestionId)
        if (!suggestion) {
            return null
        }

        // 如果已经是终态，不再评估
        if (['accepted', 'rejected', 'superseded'].includes(suggestion.status)) {
            return {
                status: suggestion.status,
                posScore: 0,
                negScore: 0,
                evidence: []
            }
        }

        // 收集证据
        const evidence = await this.collectEvidence(suggestion)
        const { posScore, negScore } = this.calculateScores(evidence)

        // 调整阈值（根据建议 confidence）
        const threshold = this.adjustThreshold(suggestion.confidence)

        // 判定
        let status: SuggestionStatus = 'pending'

        if (posScore >= threshold && posScore >= negScore + 0.20) {
            status = 'accepted'
        } else if (negScore >= threshold && negScore >= posScore + 0.20) {
            status = 'rejected'
        } else {
            // 过期判定
            const ageInDays = (Date.now() - suggestion.createdAt) / (1000 * 60 * 60 * 24)
            if (ageInDays >= 7 && posScore < 0.40 && negScore < 0.40) {
                status = 'stale'
            }
        }

        return { status, posScore, negScore, evidence }
    }

    /**
     * 评估并更新状态
     */
    async evaluateAndUpdate(suggestionId: string): Promise<SuggestionStatus | null> {
        const result = await this.evaluate(suggestionId)
        if (!result) {
            return null
        }

        const suggestion = await this.store.getAgentSuggestion(suggestionId)
        if (!suggestion) {
            return null
        }

        // 如果状态变化，更新并记录反馈
        if (result.status !== suggestion.status && result.status !== 'pending') {
            await this.store.updateAgentSuggestionStatus(suggestionId, result.status)
            await this.store.createAgentFeedback({
                suggestionId,
                source: 'auto',
                action: result.status === 'accepted' ? 'accept' : 'reject',
                evidenceJson: {
                    posScore: result.posScore,
                    negScore: result.negScore,
                    evidence: result.evidence
                }
            })
            return result.status
        }

        return suggestion.status
    }

    /**
     * 批量评估 namespace 下所有 pending 建议
     */
    async evaluatePendingSuggestions(namespace: string): Promise<Map<string, SuggestionStatus>> {
        const suggestions = await this.store.getAgentSuggestions(namespace, { status: 'pending' })
        const results = new Map<string, SuggestionStatus>()

        for (const suggestion of suggestions) {
            const newStatus = await this.evaluateAndUpdate(suggestion.id)
            if (newStatus) {
                results.set(suggestion.id, newStatus)
            }
        }

        return results
    }

    private async collectEvidence(suggestion: StoredAgentSuggestion): Promise<Evidence[]> {
        const evidence: Evidence[] = []

        // 1. 检查相关会话的后续消息
        if (suggestion.sourceSessionId) {
            const messages = this.getRecentMessages(suggestion.sourceSessionId, suggestion.createdAt)
            for (const msgContent of messages) {
                evidence.push(...this.extractSignals(msgContent, 'message'))
            }
        }

        // 2. 检查 targets 相关的代码变更
        if (suggestion.targets) {
            try {
                const targets = JSON.parse(suggestion.targets) as string[]
                for (const target of targets) {
                    // 检查后续消息中是否提到了 target 相关的变更
                    if (suggestion.sourceSessionId) {
                        const messages = this.getRecentMessages(suggestion.sourceSessionId, suggestion.createdAt)
                        for (const msgContent of messages) {
                            if (this.mentionsTarget(msgContent, target)) {
                                evidence.push({
                                    type: 'code_change',
                                    source: 'message',
                                    weight: 0.60,
                                    target
                                })
                            }
                        }
                    }
                }
            } catch {
                // 忽略 JSON 解析错误
            }
        }

        // 3. 检查摘要中的信息
        const sessionStates = await this.store.getAgentSessionStatesByNamespace(suggestion.namespace)
        for (const state of sessionStates) {
            if (state.summary && state.updatedAt > suggestion.createdAt) {
                evidence.push(...this.extractSignals(state.summary, 'summary'))
            }
        }

        return evidence
    }

    private getRecentMessages(sessionId: string, afterTimestamp: number): string[] {
        const messages = this.syncEngine.getSessionMessages(sessionId)
        const contents: string[] = []

        for (const msg of messages) {
            if (msg.createdAt <= afterTimestamp) {
                continue
            }
            const content = msg.content as Record<string, unknown> | null
            if (!content) {
                continue
            }

            // 提取消息文本
            if (content.role === 'user' || content.role === 'assistant') {
                const msgContent = content.content as Record<string, unknown> | string | null
                if (typeof msgContent === 'string') {
                    contents.push(msgContent)
                } else if (msgContent && typeof msgContent === 'object') {
                    if (typeof msgContent.text === 'string') {
                        contents.push(msgContent.text)
                    }
                }
            }
        }

        return contents
    }

    private extractSignals(text: string, source: 'message' | 'summary'): Evidence[] {
        const evidence: Evidence[] = []

        // 检查正向信号
        for (const { pattern, weight, name } of POSITIVE_PATTERNS) {
            if (pattern.test(text)) {
                evidence.push({
                    type: name,
                    source,
                    weight,
                    content: text.slice(0, 200)
                })
            }
        }

        // 检查负向信号
        for (const { pattern, weight, name } of NEGATIVE_PATTERNS) {
            if (pattern.test(text)) {
                evidence.push({
                    type: name,
                    source,
                    weight,
                    content: text.slice(0, 200)
                })
            }
        }

        return evidence
    }

    private mentionsTarget(text: string, target: string): boolean {
        // 简单的目标匹配：文件路径或关键词
        const normalizedTarget = target.toLowerCase()
        const normalizedText = text.toLowerCase()

        // 完整匹配
        if (normalizedText.includes(normalizedTarget)) {
            return true
        }

        // 文件名匹配
        const fileName = target.split('/').pop()
        if (fileName && normalizedText.includes(fileName.toLowerCase())) {
            return true
        }

        return false
    }

    private calculateScores(evidence: Evidence[]): { posScore: number; negScore: number } {
        if (evidence.length === 0) {
            return { posScore: 0, negScore: 0 }
        }

        let posScore = 0
        let negScore = 0

        const positiveTypes: Set<Evidence['type']> = new Set([
            'explicit_accept', 'code_change', 'todo_done', 'test_pass', 'summary_applied'
        ])

        for (const e of evidence) {
            if (positiveTypes.has(e.type)) {
                posScore = Math.max(posScore, e.weight)  // 取最高分，避免重复累加
            } else {
                negScore = Math.max(negScore, e.weight)
            }
        }

        return { posScore, negScore }
    }

    private adjustThreshold(confidence: number): number {
        // confidence 越高，阈值越低（更容易判定）
        // confidence 范围 0.5-1.0 映射到阈值 0.80-0.60
        const clampedConfidence = Math.max(0.5, Math.min(1.0, confidence))
        return 0.80 - (clampedConfidence - 0.5) * 0.4
    }
}
