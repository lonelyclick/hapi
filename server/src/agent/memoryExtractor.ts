/**
 * MemoryExtractor - 从会话中提取和保存重要记忆
 *
 * 在会话结束时自动分析会话内容，提取有价值的记忆并保存到 AI Profile。
 * 记忆类型：context（项目上下文）、preference（用户偏好）、knowledge（技术知识）、experience（解决问题的经验）
 */

import type { Store, AIProfileMemoryType, StoredAIProfileMemory } from '../store'
import type { SessionSummary } from './types'

/**
 * 提取的记忆条目
 */
export interface ExtractedMemory {
    type: AIProfileMemoryType
    content: string
    importance: number  // 0-1，越高越重要
    expiresInDays?: number
    metadata?: {
        source: 'session_summary'
        sessionId: string
        extractedAt: number
        keywords?: string[]
    }
}

/**
 * 记忆提取配置
 */
export interface MemoryExtractorConfig {
    maxMemoriesPerSession: number  // 每次会话最多提取的记忆数量
    minImportance: number          // 最低重要性阈值
    deduplicationThreshold: number // 去重相似度阈值 (0-1)
}

const DEFAULT_CONFIG: MemoryExtractorConfig = {
    maxMemoriesPerSession: 10,
    minImportance: 0.3,
    deduplicationThreshold: 0.7
}

/**
 * 记忆模式匹配规则
 */
interface MemoryPattern {
    pattern: RegExp
    type: AIProfileMemoryType
    importance: number
    expiresInDays: number
    description?: string
}

/**
 * 预定义的记忆提取模式
 */
const MEMORY_PATTERNS: MemoryPattern[] = [
    // Context - 项目上下文
    { pattern: /项目[：:]\s*["']?(\S+)["']?/gi, type: 'context', importance: 0.5, expiresInDays: 90 },
    { pattern: /使用\s*(\S+)\s*框架/gi, type: 'context', importance: 0.6, expiresInDays: 60 },
    { pattern: /技术栈[：:]\s*([^\n]+)/gi, type: 'context', importance: 0.6, expiresInDays: 60 },
    { pattern: /工作目录[：:]\s*(\S+)/gi, type: 'context', importance: 0.4, expiresInDays: 30 },
    { pattern: /(react|vue|angular|svelte|next|nuxt)/gi, type: 'context', importance: 0.5, expiresInDays: 60 },
    { pattern: /(typescript|javascript|python|go|rust|java)/gi, type: 'context', importance: 0.5, expiresInDays: 60 },
    { pattern: /(postgres|mysql|mongodb|sqlite|redis)/gi, type: 'context', importance: 0.5, expiresInDays: 60 },

    // Preference - 用户偏好
    { pattern: /偏好[：:]\s*([^\n]+)/gi, type: 'preference', importance: 0.7, expiresInDays: 120 },
    { pattern: /prefer(?:s|red)?\s+(?:to\s+)?(\S+)/gi, type: 'preference', importance: 0.7, expiresInDays: 120 },
    { pattern: /喜欢使用\s*(\S+)/gi, type: 'preference', importance: 0.6, expiresInDays: 120 },
    { pattern: /不要使用\s*(\S+)/gi, type: 'preference', importance: 0.7, expiresInDays: 120 },
    { pattern: /avoid\s+(?:using\s+)?(\S+)/gi, type: 'preference', importance: 0.7, expiresInDays: 120 },
    { pattern: /使用\s*(\S+Case)\s*命名/gi, type: 'preference', importance: 0.6, expiresInDays: 180 },
    { pattern: /conventional\s*commits?/gi, type: 'preference', importance: 0.6, expiresInDays: 180 },

    // Knowledge - 技术知识
    { pattern: /学到了?\s*[：:]?\s*([^\n]+)/gi, type: 'knowledge', importance: 0.6, expiresInDays: 90 },
    { pattern: /learned\s+(?:that\s+)?([^\n]+)/gi, type: 'knowledge', importance: 0.6, expiresInDays: 90 },
    { pattern: /发现\s*([^\n]+)/gi, type: 'knowledge', importance: 0.5, expiresInDays: 60 },
    { pattern: /原来\s*([^\n]+)/gi, type: 'knowledge', importance: 0.5, expiresInDays: 60 },
    { pattern: /api\s+endpoint[：:]\s*([^\n]+)/gi, type: 'knowledge', importance: 0.5, expiresInDays: 60 },
    { pattern: /正确的用法[是：:]\s*([^\n]+)/gi, type: 'knowledge', importance: 0.6, expiresInDays: 90 },

    // Experience - 解决问题的经验
    { pattern: /解决了\s*([^\n]+?)(?:问题|错误|bug)/gi, type: 'experience', importance: 0.8, expiresInDays: 180 },
    { pattern: /fixed\s+(?:the\s+)?([^\n]+?)(?:error|bug|issue)/gi, type: 'experience', importance: 0.8, expiresInDays: 180 },
    { pattern: /修复了?\s*([^\n]+)/gi, type: 'experience', importance: 0.7, expiresInDays: 120 },
    { pattern: /问题是[：:]\s*([^\n]+)/gi, type: 'experience', importance: 0.7, expiresInDays: 120 },
    { pattern: /issue\s+was[：:]\s*([^\n]+)/gi, type: 'experience', importance: 0.7, expiresInDays: 120 },
    { pattern: /踩坑[：:]\s*([^\n]+)/gi, type: 'experience', importance: 0.8, expiresInDays: 180 },
    { pattern: /注意[：:]\s*([^\n]+)/gi, type: 'experience', importance: 0.6, expiresInDays: 90 },
    { pattern: /best\s*practice[：:]\s*([^\n]+)/gi, type: 'experience', importance: 0.7, expiresInDays: 180 },
    { pattern: /最佳实践[：:]\s*([^\n]+)/gi, type: 'experience', importance: 0.7, expiresInDays: 180 }
]

/**
 * 记忆提取器类
 */
export class MemoryExtractor {
    private store: Store
    private config: MemoryExtractorConfig

    constructor(store: Store, config?: Partial<MemoryExtractorConfig>) {
        this.store = store
        this.config = { ...DEFAULT_CONFIG, ...config }
    }

    /**
     * 从会话摘要中提取记忆
     * @param sessionSummary 会话摘要文本或结构化摘要
     * @param profileId AI Profile ID
     * @param namespace 命名空间
     */
    extractMemoriesFromSession(
        sessionSummary: string | SessionSummary,
        profileId: string,
        namespace: string
    ): ExtractedMemory[] {
        const summary = typeof sessionSummary === 'string'
            ? this.parseSessionSummary(sessionSummary)
            : sessionSummary

        const memories: ExtractedMemory[] = []

        // 合并所有文本内容进行分析
        const textContent = this.buildTextContent(summary)

        // 使用模式匹配提取记忆
        for (const patternDef of MEMORY_PATTERNS) {
            const pattern = new RegExp(patternDef.pattern.source, patternDef.pattern.flags)
            let match
            while ((match = pattern.exec(textContent)) !== null) {
                const content = this.cleanContent(match[0], patternDef.type)
                if (content && content.length > 5) {  // 过滤太短的内容
                    memories.push({
                        type: patternDef.type,
                        content,
                        importance: patternDef.importance,
                        expiresInDays: patternDef.expiresInDays
                    })
                }
            }
        }

        // 提取错误处理经验（如果有错误记录）
        if (summary.errors && summary.errors.length > 0) {
            memories.push(...this.extractErrorExperiences(summary))
        }

        // 提取决策记忆
        if (summary.decisions && summary.decisions.length > 0) {
            memories.push(...this.extractDecisionMemories(summary))
        }

        // 去重（基于内容相似度）
        const dedupedMemories = this.deduplicateMemories(memories)

        // 过滤低重要性的记忆
        const filteredMemories = dedupedMemories.filter(m => m.importance >= this.config.minImportance)

        // 按重要性排序并限制数量
        const sortedMemories = filteredMemories
            .sort((a, b) => b.importance - a.importance)
            .slice(0, this.config.maxMemoriesPerSession)

        // 添加元数据
        const now = Date.now()
        for (const memory of sortedMemories) {
            memory.metadata = {
                source: 'session_summary',
                sessionId: summary.sessionId,
                extractedAt: now,
                keywords: this.extractKeywords(memory.content)
            }
        }

        return sortedMemories
    }

    /**
     * 保存提取的记忆到数据库
     * 自动进行去重处理
     */
    async saveMemories(
        memories: ExtractedMemory[],
        profileId: string,
        namespace: string
    ): Promise<StoredAIProfileMemory[]> {
        const savedMemories: StoredAIProfileMemory[] = []

        for (const memory of memories) {
            // 检查是否存在相似记忆
            const existingMemory = this.findSimilarMemory(memory, profileId, namespace)

            if (existingMemory) {
                // 更新已存在的记忆
                const updated = this.store.updateProfileMemory(existingMemory.id, {
                    content: memory.content,
                    importance: Math.max(existingMemory.importance, memory.importance),
                    expiresAt: memory.expiresInDays
                        ? Date.now() + memory.expiresInDays * 24 * 60 * 60 * 1000
                        : existingMemory.expiresAt,
                    metadata: memory.metadata
                })
                if (updated) {
                    savedMemories.push(updated)
                    console.log(`[MemoryExtractor] Updated existing memory: ${existingMemory.id}`)
                }
            } else {
                // 创建新记忆
                const created = this.store.createProfileMemory(namespace, profileId, {
                    memoryType: memory.type,
                    content: memory.content,
                    importance: memory.importance,
                    expiresAt: memory.expiresInDays
                        ? Date.now() + memory.expiresInDays * 24 * 60 * 60 * 1000
                        : null,
                    metadata: memory.metadata
                })
                savedMemories.push(created)
                console.log(`[MemoryExtractor] Created new memory: ${created.id} (${memory.type})`)
            }
        }

        return savedMemories
    }

    /**
     * 提取并保存记忆（一站式方法）
     */
    async extractAndSaveMemories(
        sessionSummary: string | SessionSummary,
        profileId: string,
        namespace: string
    ): Promise<StoredAIProfileMemory[]> {
        const memories = this.extractMemoriesFromSession(sessionSummary, profileId, namespace)
        if (memories.length === 0) {
            console.log('[MemoryExtractor] No memories extracted from session')
            return []
        }

        console.log(`[MemoryExtractor] Extracted ${memories.length} memories, saving...`)
        return this.saveMemories(memories, profileId, namespace)
    }

    // ==================== 私有方法 ====================

    /**
     * 构建用于分析的文本内容
     */
    private buildTextContent(summary: SessionSummary): string {
        const parts: string[] = []

        if (summary.recentActivity) {
            parts.push(summary.recentActivity)
        }

        if (summary.codeChanges) {
            parts.push(...summary.codeChanges)
        }

        if (summary.errors) {
            parts.push(...summary.errors)
        }

        if (summary.decisions) {
            parts.push(...summary.decisions)
        }

        if (summary.project) {
            parts.push(`项目: ${summary.project}`)
        }

        if (summary.workDir) {
            parts.push(`工作目录: ${summary.workDir}`)
        }

        return parts.join('\n')
    }

    /**
     * 清理提取的内容
     */
    private cleanContent(content: string, type: AIProfileMemoryType): string {
        let cleaned = content
            .trim()
            .replace(/^[：:\s]+/, '')
            .replace(/[：:\s]+$/, '')
            .slice(0, 200)  // 限制长度

        // 根据类型添加前缀使内容更清晰
        if (!cleaned.includes(':') && !cleaned.includes('：')) {
            switch (type) {
                case 'context':
                    // 技术栈类型不需要额外前缀
                    break
                case 'preference':
                    if (!cleaned.startsWith('偏好') && !cleaned.toLowerCase().startsWith('prefer')) {
                        cleaned = `偏好: ${cleaned}`
                    }
                    break
                case 'knowledge':
                    if (!cleaned.startsWith('知识') && !cleaned.toLowerCase().startsWith('learn')) {
                        cleaned = `知识: ${cleaned}`
                    }
                    break
                case 'experience':
                    if (!cleaned.startsWith('经验') && !cleaned.toLowerCase().startsWith('experience')) {
                        cleaned = `经验: ${cleaned}`
                    }
                    break
            }
        }

        return cleaned
    }

    /**
     * 解析会话摘要文本为结构化格式
     */
    private parseSessionSummary(summaryText: string): SessionSummary {
        // 尝试解析 JSON 格式的摘要
        const jsonMatch = summaryText.match(/\[\[SESSION_SUMMARY\]\]([\s\S]*?)(?:$|\[\[)/i)
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[1].trim()) as SessionSummary
            } catch {
                // JSON 解析失败，继续使用文本解析
            }
        }

        // 构建基本的摘要结构
        return {
            sessionId: 'unknown',
            namespace: 'default',
            workDir: this.extractField(summaryText, /工作目录|workDir|path/i) || 'unknown',
            project: this.extractField(summaryText, /项目|project/i) || 'unknown',
            recentActivity: summaryText.slice(0, 1000),
            codeChanges: this.extractList(summaryText, /代码变更|code\s*changes?/i),
            errors: this.extractList(summaryText, /错误|errors?/i),
            decisions: this.extractList(summaryText, /决策|decisions?/i),
            messageCount: 0,
            lastMessageSeq: 0,
            timestamp: Date.now()
        }
    }

    /**
     * 从文本中提取字段值
     */
    private extractField(text: string, pattern: RegExp): string | null {
        const lines = text.split('\n')
        for (const line of lines) {
            if (pattern.test(line)) {
                const colonIndex = line.indexOf(':')
                if (colonIndex > 0) {
                    return line.slice(colonIndex + 1).trim()
                }
            }
        }
        return null
    }

    /**
     * 从文本中提取列表
     */
    private extractList(text: string, pattern: RegExp): string[] {
        const items: string[] = []
        const lines = text.split('\n')
        let inSection = false

        for (const line of lines) {
            if (pattern.test(line)) {
                inSection = true
                continue
            }
            if (inSection) {
                const trimmed = line.trim()
                if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.match(/^\d+\./)) {
                    items.push(trimmed.replace(/^[-*\d.]+\s*/, ''))
                } else if (trimmed === '' || trimmed.match(/^[A-Z]/)) {
                    break
                }
            }
        }

        return items
    }

    /**
     * 提取错误处理经验
     */
    private extractErrorExperiences(summary: SessionSummary): ExtractedMemory[] {
        const memories: ExtractedMemory[] = []

        for (const error of summary.errors || []) {
            memories.push({
                type: 'experience',
                content: `遇到错误: ${error.slice(0, 150)}`,
                importance: 0.75,
                expiresInDays: 120
            })
        }

        return memories
    }

    /**
     * 提取决策记忆
     */
    private extractDecisionMemories(summary: SessionSummary): ExtractedMemory[] {
        const memories: ExtractedMemory[] = []

        for (const decision of summary.decisions || []) {
            memories.push({
                type: 'experience',
                content: `决策: ${decision.slice(0, 150)}`,
                importance: 0.7,
                expiresInDays: 90
            })
        }

        return memories
    }

    /**
     * 去重记忆列表
     */
    private deduplicateMemories(memories: ExtractedMemory[]): ExtractedMemory[] {
        const result: ExtractedMemory[] = []

        for (const memory of memories) {
            let isDuplicate = false
            for (const existing of result) {
                if (existing.type === memory.type) {
                    const similarity = this.calculateSimilarity(memory.content, existing.content)
                    if (similarity >= this.config.deduplicationThreshold) {
                        // 保留重要性更高的那个
                        if (memory.importance > existing.importance) {
                            const index = result.indexOf(existing)
                            result[index] = memory
                        }
                        isDuplicate = true
                        break
                    }
                }
            }
            if (!isDuplicate) {
                result.push(memory)
            }
        }

        return result
    }

    /**
     * 从文本中提取关键词
     */
    private extractKeywords(text: string): string[] {
        const stopWords = new Set([
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
            'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
            'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
            'this', 'that', 'these', 'those', 'it', 'its',
            '的', '是', '在', '了', '和', '与', '或', '及', '等', '把', '被', '将'
        ])

        const words = text.toLowerCase()
            .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word))

        const wordCount = new Map<string, number>()
        for (const word of words) {
            wordCount.set(word, (wordCount.get(word) || 0) + 1)
        }

        return [...wordCount.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([word]) => word)
    }

    /**
     * 查找是否存在相似记忆
     */
    private findSimilarMemory(
        memory: ExtractedMemory,
        profileId: string,
        namespace: string
    ): StoredAIProfileMemory | null {
        const existingMemories = this.store.getProfileMemories(namespace, profileId, {
            type: memory.type,
            limit: 50
        })

        for (const existing of existingMemories) {
            const similarity = this.calculateSimilarity(memory.content, existing.content)
            if (similarity >= this.config.deduplicationThreshold) {
                return existing
            }
        }

        return null
    }

    /**
     * 计算两个文本的相似度 (Jaccard similarity)
     */
    private calculateSimilarity(text1: string, text2: string): number {
        const words1 = new Set(text1.toLowerCase().split(/\s+/))
        const words2 = new Set(text2.toLowerCase().split(/\s+/))

        const intersection = new Set([...words1].filter(w => words2.has(w)))
        const union = new Set([...words1, ...words2])

        return union.size === 0 ? 0 : intersection.size / union.size
    }
}

/**
 * 创建记忆提取器实例
 */
export function createMemoryExtractor(
    store: Store,
    config?: Partial<MemoryExtractorConfig>
): MemoryExtractor {
    return new MemoryExtractor(store, config)
}

/**
 * 简化版提取函数（向后兼容）
 * 从会话摘要和任务描述中提取记忆
 */
export function extractMemoriesFromSession(
    sessionSummary: string,
    taskDescription: string
): ExtractedMemory[] {
    const combined = `${taskDescription}\n${sessionSummary}`
    const memories: ExtractedMemory[] = []

    for (const patternDef of MEMORY_PATTERNS) {
        const pattern = new RegExp(patternDef.pattern.source, patternDef.pattern.flags)
        let match
        while ((match = pattern.exec(combined)) !== null) {
            const content = match[0].trim().slice(0, 200)
            if (content.length > 5) {
                memories.push({
                    type: patternDef.type,
                    content,
                    importance: patternDef.importance,
                    expiresInDays: patternDef.expiresInDays
                })
            }
        }
    }

    // 去重并限制数量
    const seen = new Set<string>()
    return memories
        .filter(m => {
            const key = `${m.type}:${m.content.toLowerCase().slice(0, 50)}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 10)
}
