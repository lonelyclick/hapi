/**
 * Review 模块 API 路由
 *
 * 这是一个试验性功能，用于多 Session 协作 Review 模式
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine, DecryptedMessage } from '../sync/syncEngine'
import type { SSEManager } from '../sse/sseManager'
import type { WebAppEnv } from '../web/middleware/auth'
import type { ReviewStore } from './store'
import type { AutoReviewService } from './autoReview'

// Review 上下文最大消息数
const REVIEW_CONTEXT_MAX_MESSAGES = 10

// 支持的 Review 模型
const reviewModelValues = ['claude', 'codex', 'gemini', 'glm', 'minimax', 'grok', 'openrouter'] as const
const reviewModelVariantValues = ['opus', 'sonnet', 'haiku', 'gpt-5.2-codex', 'gpt-5.1-codex-max'] as const

const createReviewSessionSchema = z.object({
    mainSessionId: z.string().min(1),
    reviewModel: z.enum(reviewModelValues),
    reviewModelVariant: z.string().optional()
})

/**
 * 从消息内容中提取用户文本
 */
function extractUserText(content: unknown): string | null {
    if (!content || typeof content !== 'object') {
        return null
    }
    const record = content as Record<string, unknown>
    if (record.role !== 'user') {
        return null
    }
    const body = record.content as Record<string, unknown> | string | undefined
    if (!body) {
        return null
    }
    if (typeof body === 'string') {
        return body.trim() || null
    }
    if (typeof body === 'object' && body.type === 'text' && typeof body.text === 'string') {
        return body.text.trim() || null
    }
    return null
}

/**
 * 从主 Session 的消息中构建 Review 上下文
 * 提取最近 N 轮对话中所有用户的输入
 */
function buildReviewContext(messages: DecryptedMessage[]): string {
    const userMessages: string[] = []

    for (const message of messages) {
        const userText = extractUserText(message.content)
        if (userText) {
            userMessages.push(userText)
        }
    }

    if (userMessages.length === 0) {
        return '(无用户消息)'
    }

    return userMessages.join('\n\n---\n\n')
}

/**
 * 对话轮次类型
 */
interface DialogueRound {
    roundNumber: number
    userInput: string
    aiMessages: string[]  // AI 在这一轮的所有消息
    messageIds: string[]  // 原始消息 ID
}

/**
 * 从消息中提取 AI 的文本内容
 */
function extractAIText(content: unknown): string | null {
    if (!content || typeof content !== 'object') {
        return null
    }
    const record = content as Record<string, unknown>
    if (record.role !== 'agent') {
        return null
    }

    let payload: Record<string, unknown> | null = null
    const rawContent = record.content
    if (typeof rawContent === 'string') {
        try {
            payload = JSON.parse(rawContent)
        } catch {
            payload = null
        }
    } else if (typeof rawContent === 'object' && rawContent) {
        payload = rawContent as Record<string, unknown>
    }

    if (!payload) return null

    const data = payload.data as Record<string, unknown>
    if (!data || data.type !== 'assistant') return null

    const message = data.message as Record<string, unknown>
    if (message?.content) {
        const contentArr = message.content as Array<{ type?: string; text?: string }>
        const texts: string[] = []
        for (const item of contentArr) {
            if (item.type === 'text' && item.text) {
                texts.push(item.text)
            }
        }
        if (texts.length > 0) {
            return texts.join('\n')
        }
    }
    return null
}

/**
 * 将消息按轮次分组
 * 一轮 = 一个用户输入 + 后续所有 AI 回复（直到下一个用户输入）
 */
function groupMessagesIntoRounds(messages: DecryptedMessage[]): DialogueRound[] {
    const rounds: DialogueRound[] = []
    let currentRound: DialogueRound | null = null
    let roundNumber = 0

    for (const message of messages) {
        const userText = extractUserText(message.content)
        const aiText = extractAIText(message.content)

        if (userText) {
            // 用户输入开始新的一轮
            if (currentRound) {
                rounds.push(currentRound)
            }
            roundNumber++
            currentRound = {
                roundNumber,
                userInput: userText,
                aiMessages: [],
                messageIds: [message.id]
            }
        } else if (aiText && currentRound) {
            // AI 回复添加到当前轮
            currentRound.aiMessages.push(aiText)
            currentRound.messageIds.push(message.id)
        }
    }

    // 添加最后一轮
    if (currentRound) {
        rounds.push(currentRound)
    }

    return rounds
}

/**
 * 汇总 AI 消息为简洁摘要
 */
function summarizeAIMessages(aiMessages: string[]): string {
    if (aiMessages.length === 0) {
        return '(AI 无回复)'
    }

    // 合并所有 AI 消息，限制长度
    const combined = aiMessages.join('\n\n')
    const maxLength = 2000
    if (combined.length > maxLength) {
        return combined.slice(0, maxLength) + '...(已截断)'
    }
    return combined
}

/**
 * 格式化时间戳为可读字符串
 */
function formatTimestamp(ts: number): string {
    const date = new Date(ts)
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    })
}

/**
 * 格式化时间戳为 git 命令可用的格式
 */
function formatGitTimestamp(ts: number): string {
    const date = new Date(ts)
    return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
}

/**
 * 之前的建议项
 */
interface PreviousSuggestion {
    id: string
    type: string
    severity: string
    title: string
    detail: string
    applied: boolean   // 是否已发送给主 AI
    deleted?: boolean  // 是否被用户删除（不采纳）
}

/**
 * 构建 Review Prompt - 要求返回 JSON 格式的建议列表
 */
function buildReviewPrompt(
    roundsSummary: string,
    timeRange?: { start: number; end: number },
    previousSuggestions?: PreviousSuggestion[]
): string {
    const timeRangeInfo = timeRange
        ? `\n## 时间范围\n\n开发时间：${formatTimestamp(timeRange.start)} ~ ${formatTimestamp(timeRange.end)}\n`
        : ''

    const gitHint = timeRange
        ? `用 git log/diff --after="${formatGitTimestamp(timeRange.start)}" --before="${formatGitTimestamp(timeRange.end + 60000)}" 查看时间段内改动，或 git diff HEAD 查看未提交改动`
        : `用 git log -5 和 git diff HEAD~3 查看最近改动`

    // 构建之前建议的上下文
    let previousSuggestionsInfo = ''
    if (previousSuggestions && previousSuggestions.length > 0) {
        // 已发送给主 AI 的建议（需要检查是否修复）
        const appliedSuggestions = previousSuggestions.filter(s => s.applied)
        // 用户删除的建议（不要再提类似问题）
        const deletedSuggestions = previousSuggestions.filter(s => s.deleted && !s.applied)
        // 待处理的建议（保留到新列表中）
        const pendingSuggestions = previousSuggestions.filter(s => !s.applied && !s.deleted)

        if (pendingSuggestions.length > 0) {
            previousSuggestionsInfo += '\n## 待处理的建议（需保留到新列表，去重合并）\n'
            for (const s of pendingSuggestions) {
                previousSuggestionsInfo += `- [${s.type}/${s.severity}] ${s.title}: ${s.detail}\n`
            }
        }

        if (appliedSuggestions.length > 0) {
            previousSuggestionsInfo += '\n## 已发送给主AI的建议（检查是否已修复，已修复则不要再提）\n'
            for (const s of appliedSuggestions) {
                previousSuggestionsInfo += `- [${s.type}/${s.severity}] ${s.title}: ${s.detail}\n`
            }
        }

        if (deletedSuggestions.length > 0) {
            previousSuggestionsInfo += '\n## 用户删除的建议（不要再提类似问题）\n'
            for (const s of deletedSuggestions) {
                previousSuggestionsInfo += `- [${s.type}/${s.severity}] ${s.title}\n`
            }
        }
    }

    return `你是代码审查专家。请使用 plan 模式。**只能查看代码，禁止修改文件。**

## 背景
${roundsSummary}
${timeRangeInfo}${previousSuggestionsInfo}
## 审查
${gitHint}
鼓励读取相关文件。审查：正确性、安全、性能、需求、可维护性。

## 输出要求
**重要：你的输出是完整的建议列表，会覆盖之前所有建议。**
- 保留"待处理的建议"中仍有效的项目（去重、合并类似问题）
- 移除"已发送给主AI"中已修复的项目
- 不要重复"用户删除的建议"中的问题
- 新增本次发现的问题

## 输出JSON
\`\`\`json
{"suggestions":[{"id":"1","type":"bug|security|performance|improvement","severity":"high|medium|low","title":"简短标题","detail":"详细描述和解决方案，发给主AI执行"}],"summary":"总体评价"}
\`\`\`
`
}

export function createReviewRoutes(
    reviewStore: ReviewStore,
    getSyncEngine: () => SyncEngine | null,
    getSseManager: () => SSEManager | null,
    autoReviewService?: AutoReviewService
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // 创建 Review Session
    app.post('/review/sessions', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = createReviewSessionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', details: parsed.error.issues }, 400)
        }

        const { mainSessionId, reviewModel, reviewModelVariant } = parsed.data
        const namespace = c.get('namespace')

        // 获取主 Session
        const mainSession = engine.getSessionByNamespace(mainSessionId, namespace)
        if (!mainSession) {
            return c.json({ error: 'Main session not found' }, 404)
        }

        if (!mainSession.active) {
            return c.json({ error: 'Main session is not active' }, 400)
        }

        const machineId = mainSession.metadata?.machineId?.trim()
        if (!machineId) {
            return c.json({ error: 'Main session has no machine' }, 400)
        }

        const machine = engine.getMachineByNamespace(machineId, namespace)
        if (!machine || !machine.active) {
            return c.json({ error: 'Machine is offline' }, 409)
        }

        // 获取主 Session 的最近消息，提取用户输入作为上下文
        const page = await engine.getMessagesPage(mainSessionId, {
            limit: REVIEW_CONTEXT_MAX_MESSAGES * 2,  // 获取更多消息以确保有足够的用户消息
            beforeSeq: null
        })

        const contextSummary = buildReviewContext(page.messages)

        // 获取主 Session 的工作目录
        const directory = mainSession.metadata?.path
        if (!directory) {
            return c.json({ error: 'Main session has no working directory' }, 400)
        }

        // 创建 Review Session（在同一目录下）
        const spawnResult = await engine.spawnSession(
            machineId,
            directory,
            reviewModel as 'claude' | 'codex' | 'gemini' | 'glm' | 'minimax' | 'grok' | 'openrouter',
            false,  // 不使用 yolo 模式
            'simple',
            undefined,
            {
                modelMode: reviewModelVariant as 'opus' | 'sonnet' | undefined,
                source: 'review'
            }
        )

        if (spawnResult.type !== 'success') {
            return c.json({ error: spawnResult.message }, 500)
        }

        const reviewSessionId = spawnResult.sessionId

        // 等待 Review Session 上线
        const waitForOnline = async (sessionId: string, timeoutMs: number): Promise<boolean> => {
            const start = Date.now()
            while (Date.now() - start < timeoutMs) {
                const session = engine.getSession(sessionId)
                if (session?.active) {
                    return true
                }
                await new Promise(resolve => setTimeout(resolve, 500))
            }
            return false
        }

        const isOnline = await waitForOnline(reviewSessionId, 60_000)
        if (!isOnline) {
            return c.json({ error: 'Review session failed to come online' }, 500)
        }

        // 保存 Review Session 记录
        const reviewSession = await reviewStore.createReviewSession({
            namespace,
            mainSessionId,
            reviewSessionId,
            reviewModel,
            reviewModelVariant,
            contextSummary
        })

        // 自动触发同步历史对话
        if (autoReviewService) {
            // 异步触发，不阻塞响应
            autoReviewService.triggerSync(mainSessionId).catch(err => {
                console.error('[Review] Failed to trigger auto sync:', err)
            })
        }

        return c.json({
            id: reviewSession.id,
            reviewSessionId,
            mainSessionId,
            reviewModel,
            reviewModelVariant,
            status: 'pending'
        })
    })

    // 获取主 Session 的 Review Sessions 列表
    app.get('/review/sessions', async (c) => {
        const mainSessionId = c.req.query('mainSessionId')
        if (!mainSessionId) {
            return c.json({ error: 'mainSessionId is required' }, 400)
        }

        const reviewSessions = await reviewStore.getReviewSessionsByMainSession(mainSessionId)

        return c.json({ reviewSessions })
    })

    // 获取主 Session 当前活跃的 Review Session
    // 注意：这个路由必须在 /review/sessions/:id 之前定义，否则 'active' 会被当作 id
    app.get('/review/sessions/active/:mainSessionId', async (c) => {
        const mainSessionId = c.req.param('mainSessionId')
        const reviewSession = await reviewStore.getActiveReviewSession(mainSessionId)

        if (!reviewSession) {
            return c.json({ error: 'No active review session' }, 404)
        }

        return c.json(reviewSession)
    })

    // 获取单个 Review Session
    app.get('/review/sessions/:id', async (c) => {
        const id = c.req.param('id')
        const reviewSession = await reviewStore.getReviewSession(id)

        if (!reviewSession) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        return c.json(reviewSession)
    })

    // 完成 Review Session
    app.post('/review/sessions/:id/complete', async (c) => {
        const id = c.req.param('id')
        const body = await c.req.json().catch(() => ({})) as { result?: string }

        const success = await reviewStore.completeReviewSession(id, body.result ?? '')

        if (!success) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        return c.json({ success: true })
    })

    // 同步汇总 - 发送每一轮对话给 Review AI 做汇总
    // 每次最多处理 3 轮，批量发送给 AI 汇总
    app.post('/review/sessions/:id/sync', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const reviewSession = await reviewStore.getReviewSession(id)
        if (!reviewSession) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        // 检查 Review AI 是否正在处理中，避免重复发送
        const reviewAISession = await engine.getSession(reviewSession.reviewSessionId)
        if (reviewAISession?.thinking) {
            return c.json({
                success: false,
                error: 'busy',
                message: 'Review AI 正在处理中，请等待完成后再同步'
            }, 409)
        }

        // 获取主 Session 所有消息
        const allMessages = await engine.getAllMessages(reviewSession.mainSessionId)

        // 按轮次分组消息
        const allRounds = groupMessagesIntoRounds(allMessages)

        // 获取已汇总的轮次
        const existingRounds = await reviewStore.getReviewRounds(id)
        const summarizedRoundNumbers = new Set(existingRounds.map(r => r.roundNumber))

        // 找出未汇总的轮次
        const pendingRounds = allRounds.filter(r => !summarizedRoundNumbers.has(r.roundNumber))

        if (pendingRounds.length === 0) {
            return c.json({
                success: true,
                newRoundsSynced: 0,
                totalRounds: allRounds.length,
                summarizedRounds: existingRounds.length,
                message: '所有轮次已汇总完毕'
            })
        }

        // 动态计算批量大小：根据消息体大小决定每批处理多少轮
        // 目标：每批 prompt 大小控制在 50KB 左右，避免超过模型上下文限制
        const MAX_BATCH_CHARS = 50000  // 50KB
        const MAX_ROUNDS_PER_BATCH = 10  // 最多 10 轮
        const MIN_ROUNDS_PER_BATCH = 1   // 最少 1 轮

        const batchRounds: typeof pendingRounds = []
        let currentBatchSize = 0
        const basePromptSize = 500  // 基础 prompt 模板大小估算

        for (const round of pendingRounds) {
            // 计算这一轮的大小
            const roundSize = round.userInput.length + round.aiMessages.join('').length + 200  // 200 是格式化开销

            // 如果加入这一轮会超过限制，且已经有至少一轮，就停止
            if (currentBatchSize + roundSize > MAX_BATCH_CHARS && batchRounds.length >= MIN_ROUNDS_PER_BATCH) {
                break
            }

            batchRounds.push(round)
            currentBatchSize += roundSize

            // 达到最大轮数限制
            if (batchRounds.length >= MAX_ROUNDS_PER_BATCH) {
                break
            }
        }

        // 构建批量汇总请求 Prompt
        let syncPrompt = `## 对话汇总任务

请帮我汇总以下 ${batchRounds.length} 轮对话的内容。

`

        for (const round of batchRounds) {
            syncPrompt += `### 第 ${round.roundNumber} 轮对话

**用户输入：**
${round.userInput}

**AI 回复：**
${round.aiMessages.join('\n\n---\n\n')}

---

`
        }

        syncPrompt += `### 要求

请用 JSON 数组格式输出汇总结果，每轮对话一个 JSON 对象：

\`\`\`json
[
${batchRounds.map(r => `  {
    "round": ${r.roundNumber},
    "summary": "用简洁的语言汇总 AI 在这一轮中做了什么，重点关注：执行了什么操作、修改了哪些文件、解决了什么问题。200-500字以内。"
  }`).join(',\n')}
]
\`\`\`

只输出 JSON 数组，不要输出其他内容。`

        // 发送给 Review AI
        await engine.sendMessage(reviewSession.reviewSessionId, {
            text: syncPrompt,
            sentFrom: 'webapp'
        })

        // 更新状态为 active（如果是 pending）
        if (reviewSession.status === 'pending') {
            await reviewStore.updateReviewSessionStatus(id, 'active')
        }

        return c.json({
            success: true,
            syncingRounds: batchRounds.map(r => r.roundNumber),
            batchSize: batchRounds.length,
            batchChars: currentBatchSize,  // 本批次消息体大小
            totalRounds: allRounds.length,
            summarizedRounds: existingRounds.length,
            pendingRounds: pendingRounds.length,
            message: `正在汇总第 ${batchRounds.map(r => r.roundNumber).join(', ')} 轮对话 (${Math.round(currentBatchSize / 1000)}KB)...`
        })
    })

    // 保存 AI 的汇总结果
    // 从 Review Session 的最新消息中提取汇总并保存到数据库
    // 支持单个 JSON 对象或 JSON 数组（批量汇总）
    app.post('/review/sessions/:id/save-summary', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const reviewSession = await reviewStore.getReviewSession(id)
        if (!reviewSession) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        // 获取 Review Session 的最新消息
        const messagesResult = await engine.getMessagesPage(reviewSession.reviewSessionId, { limit: 10, beforeSeq: null })

        // 提取最新的 AI 回复 - 支持单个对象或数组
        let summaries: Array<{ round: number; summary: string }> = []

        console.log('[save-summary] Messages count:', messagesResult.messages.length)

        for (const m of messagesResult.messages.reverse()) {
            const content = m.content as Record<string, unknown>
            console.log('[save-summary] Message role:', content?.role)
            if (content?.role !== 'agent') continue

            // 解析消息内容
            let payload: Record<string, unknown> | null = null
            const rawContent = content?.content
            console.log('[save-summary] rawContent type:', typeof rawContent)
            if (typeof rawContent === 'string') {
                try {
                    payload = JSON.parse(rawContent)
                } catch {
                    payload = null
                }
            } else if (typeof rawContent === 'object' && rawContent) {
                payload = rawContent as Record<string, unknown>
            }

            if (!payload) {
                console.log('[save-summary] No payload')
                continue
            }

            const data = payload.data as Record<string, unknown>
            console.log('[save-summary] data.type:', data?.type)
            if (!data || data.type !== 'assistant') continue

            const message = data.message as Record<string, unknown>
            if (message?.content) {
                const contentArr = message.content as Array<{ type?: string; text?: string }>
                for (const item of contentArr) {
                    if (item.type === 'text' && item.text) {
                        console.log('[save-summary] Found text, length:', item.text.length, 'preview:', item.text.slice(0, 200))
                        // 尝试从文本中提取 JSON - 找到最后一个 ```json 块
                        // 先找到所有 ```json ... ``` 块，取最后一个
                        const jsonBlocks = [...item.text.matchAll(/```json\s*([\s\S]*?)\s*```/g)]
                        console.log('[save-summary] Found', jsonBlocks.length, 'json blocks in text')
                        const jsonMatch = jsonBlocks.length > 0 ? jsonBlocks[jsonBlocks.length - 1] : null
                        if (jsonMatch) {
                            let jsonContent = jsonMatch[1].trim()

                            // 修复 AI 可能在 summary 文本中使用的未转义双引号
                            // 逐行处理，只处理 summary 行
                            const lines = jsonContent.split('\n')
                            const fixedLines = lines.map(line => {
                                // 匹配 "summary": "..." 行
                                const summaryMatch = line.match(/^(\s*"summary":\s*")(.*)("(?:,)?)\s*$/)
                                if (summaryMatch) {
                                    // 替换 summary 值中未转义的双引号为转义的双引号
                                    // 注意：已经转义的 \" 不要重复转义
                                    let content = summaryMatch[2]
                                    // 将未转义的 " 替换为 \"
                                    // 匹配：前面不是 \ 的 "
                                    content = content.replace(/(?<!\\)"/g, '\\"')
                                    return summaryMatch[1] + content + summaryMatch[3]
                                }
                                return line
                            })
                            jsonContent = fixedLines.join('\n')

                            try {
                                const parsed = JSON.parse(jsonContent)
                                // 支持数组格式
                                if (Array.isArray(parsed)) {
                                    summaries = parsed.filter(p => p.round && p.summary)
                                } else if (parsed.round && parsed.summary) {
                                    summaries = [parsed]
                                }
                                if (summaries.length > 0) break
                            } catch (e) {
                                console.log('[save-summary] JSON parse error:', (e as Error).message)
                                // 尝试找到错误位置
                                const errorMatch = (e as Error).message.match(/position (\d+)/)
                                if (errorMatch) {
                                    const pos = parseInt(errorMatch[1])
                                    console.log('[save-summary] Error context at position', pos, ':', JSON.stringify(jsonContent.slice(Math.max(0, pos - 30), pos + 30)))
                                }
                            }
                        }
                        // 也尝试直接解析整个文本
                        try {
                            const parsed = JSON.parse(item.text)
                            if (Array.isArray(parsed)) {
                                summaries = parsed.filter(p => p.round && p.summary)
                            } else if (parsed.round && parsed.summary) {
                                summaries = [parsed]
                            }
                            if (summaries.length > 0) break
                        } catch {
                            // 继续
                        }
                    }
                }
            }
            if (summaries.length > 0) break
        }

        console.log('[save-summary] Summaries found:', summaries.length)

        if (summaries.length === 0) {
            return c.json({ error: 'No summary found in AI response', noSummary: true }, 400)
        }

        // 获取主 Session 所有消息以获取原始数据
        const allMessages = await engine.getAllMessages(reviewSession.mainSessionId)
        const allRounds = groupMessagesIntoRounds(allMessages)

        // 获取已存在的轮次
        const existingRounds = await reviewStore.getReviewRounds(id)
        const existingRoundNumbers = new Set(existingRounds.map(r => r.roundNumber))

        // 批量保存
        const savedRounds: number[] = []
        const skippedRounds: number[] = []

        for (const summary of summaries) {
            // 跳过已存在的
            if (existingRoundNumbers.has(summary.round)) {
                skippedRounds.push(summary.round)
                continue
            }

            const targetRound = allRounds.find(r => r.roundNumber === summary.round)
            if (!targetRound) {
                console.warn(`[save-summary] Round ${summary.round} not found in main session`)
                continue
            }

            // 保存到数据库
            await reviewStore.createReviewRound({
                reviewSessionId: id,
                roundNumber: summary.round,
                userInput: targetRound.userInput,
                aiSummary: summary.summary,
                originalMessageIds: targetRound.messageIds
            })

            savedRounds.push(summary.round)
        }

        if (savedRounds.length === 0 && skippedRounds.length > 0) {
            return c.json({
                success: true,
                message: `第 ${skippedRounds.join(', ')} 轮已保存`,
                alreadyExists: true,
                skippedRounds
            })
        }

        return c.json({
            success: true,
            savedRounds,
            skippedRounds,
            totalSaved: savedRounds.length,
            message: savedRounds.length > 0
                ? `第 ${savedRounds.join(', ')} 轮汇总已保存`
                : '没有新的汇总需要保存'
        })
    })

    // 执行 Review（读取所有已汇总的轮次，发给 Review AI）
    app.post('/review/sessions/:id/start', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        // 解析请求体，获取之前的建议
        const body = await c.req.json().catch(() => null) as {
            previousSuggestions?: PreviousSuggestion[]
        } | null
        const previousSuggestions = body?.previousSuggestions

        const reviewSession = await reviewStore.getReviewSession(id)
        if (!reviewSession) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        // 只允许 pending 或 active 状态
        if (reviewSession.status !== 'pending' && reviewSession.status !== 'active') {
            return c.json({ error: 'Review session is not in pending or active status' }, 400)
        }

        // 获取所有已汇总的轮次
        const allSummarizedRounds = await reviewStore.getReviewRounds(id)

        if (allSummarizedRounds.length === 0) {
            return c.json({ error: 'No summarized rounds found. Please sync first.', noRounds: true }, 400)
        }

        // 获取已经 review 过的轮次号
        const reviewedRoundNumbers = await reviewStore.getReviewedRoundNumbers(id)

        // 过滤出未 review 过的轮次
        const unreviewedRounds = allSummarizedRounds.filter(r => !reviewedRoundNumbers.has(r.roundNumber))

        if (unreviewedRounds.length === 0) {
            return c.json({
                error: '所有轮次都已经 review 过了',
                allReviewed: true,
                totalRounds: allSummarizedRounds.length,
                reviewedRounds: reviewedRoundNumbers.size
            }, 400)
        }

        // 构建对话汇总（只包含未 review 过的轮次）
        const roundsSummary = unreviewedRounds.map(r => r.aiSummary).join('\n')
        const unreviewedRoundNumbers = unreviewedRounds.map(r => r.roundNumber)

        // 计算时间范围（只针对未 review 过的轮次）
        let timeRange: { start: number; end: number } | undefined
        const roundsWithTime = unreviewedRounds.filter(r => r.startedAt && r.endedAt)
        if (roundsWithTime.length > 0) {
            const startTimes = roundsWithTime.map(r => r.startedAt!).filter(t => t > 0)
            const endTimes = roundsWithTime.map(r => r.endedAt!).filter(t => t > 0)
            if (startTimes.length > 0 && endTimes.length > 0) {
                timeRange = {
                    start: Math.min(...startTimes),
                    end: Math.max(...endTimes)
                }
            }
        }

        // 发送 Review Prompt（包含之前的建议上下文）
        const reviewPrompt = buildReviewPrompt(roundsSummary, timeRange, previousSuggestions)

        // 创建执行记录（记录本次 review 的轮次号）
        const execution = await reviewStore.createReviewExecution({
            reviewSessionId: id,
            roundsReviewed: unreviewedRounds.length,
            reviewedRoundNumbers: unreviewedRoundNumbers,
            timeRangeStart: timeRange?.start ?? Date.now(),
            timeRangeEnd: timeRange?.end ?? Date.now(),
            prompt: reviewPrompt
        })

        await engine.sendMessage(reviewSession.reviewSessionId, {
            text: reviewPrompt,
            sentFrom: 'webapp'
        })

        // 更新状态为 active
        if (reviewSession.status === 'pending') {
            await reviewStore.updateReviewSessionStatus(id, 'active')
        }

        return c.json({
            success: true,
            status: 'active',
            roundsReviewed: unreviewedRounds.length,
            reviewedRoundNumbers: unreviewedRoundNumbers,
            skippedRounds: Array.from(reviewedRoundNumbers),
            executionId: execution.id,
            timeRange
        })
    })

    // 取消 Review Session
    app.post('/review/sessions/:id/cancel', async (c) => {
        const id = c.req.param('id')

        const success = await reviewStore.updateReviewSessionStatus(id, 'cancelled')

        if (!success) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        return c.json({ success: true })
    })

    // 删除 Review Session
    app.delete('/review/sessions/:id', async (c) => {
        const id = c.req.param('id')

        const success = await reviewStore.deleteReviewSession(id)

        if (!success) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        return c.json({ success: true })
    })

    // 检查未汇总的轮次
    app.get('/review/sessions/:id/pending-rounds', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const reviewSession = await reviewStore.getReviewSession(id)
        if (!reviewSession) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        // 获取主 Session 所有消息
        const allMessages = await engine.getAllMessages(reviewSession.mainSessionId)

        // 按轮次分组消息
        const allRounds = groupMessagesIntoRounds(allMessages)

        // 获取已汇总的轮次
        const existingRounds = await reviewStore.getReviewRounds(id)
        const summarizedRoundNumbers = new Set(existingRounds.map(r => r.roundNumber))

        // 找出未汇总的轮次
        const pendingRounds = allRounds.filter(r => !summarizedRoundNumbers.has(r.roundNumber))

        // 获取已经 review 过的轮次
        const reviewedRoundNumbers = await reviewStore.getReviewedRoundNumbers(id)

        // 计算待 review 的轮次（已汇总但未 review）
        const unreviewedRounds = existingRounds.filter(r => !reviewedRoundNumbers.has(r.roundNumber))

        return c.json({
            totalRounds: allRounds.length,
            summarizedRounds: existingRounds.length,
            pendingRounds: pendingRounds.length,
            hasPendingRounds: pendingRounds.length > 0,
            // 新增：review 相关统计
            reviewedRounds: reviewedRoundNumbers.size,
            unreviewedRounds: unreviewedRounds.length,
            hasUnreviewedRounds: unreviewedRounds.length > 0
        })
    })

    // 发送对话摘要给 Review AI
    app.post('/review/sessions/:id/summarize', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const reviewSession = await reviewStore.getReviewSession(id)
        if (!reviewSession) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        // 获取主 Session 所有消息以确保完整上下文
        const allMessages = await engine.getAllMessages(reviewSession.mainSessionId)

        // 提取完整对话（用户和 AI 的消息都要）
        const dialogueMessages: Array<{ role: string; text: string }> = []

        for (const m of allMessages) {
            const content = m.content as Record<string, unknown>
            const role = content?.role

            if (role === 'user') {
                // user 消息的 content 可能是 JSON 字符串
                let payload: Record<string, unknown> | null = null
                const rawContent = content?.content
                if (typeof rawContent === 'string') {
                    try {
                        payload = JSON.parse(rawContent)
                    } catch {
                        payload = null
                    }
                } else if (typeof rawContent === 'object' && rawContent) {
                    payload = rawContent as Record<string, unknown>
                }

                const text = typeof payload?.text === 'string' ? payload.text : ''
                if (text) {
                    dialogueMessages.push({ role: 'User', text })
                }
            } else if (role === 'agent') {
                // agent 消息的 content 可能是 JSON 字符串
                let payload: Record<string, unknown> | null = null
                const rawContent = content?.content
                if (typeof rawContent === 'string') {
                    try {
                        payload = JSON.parse(rawContent)
                    } catch {
                        payload = null
                    }
                } else if (typeof rawContent === 'object' && rawContent) {
                    payload = rawContent as Record<string, unknown>
                }

                if (!payload) continue

                const data = payload.data as Record<string, unknown>
                if (!data || data.type !== 'assistant') continue

                // data.message 是 Claude API 格式的消息对象
                const message = data.message as Record<string, unknown>
                if (message?.content) {
                    const contentArr = message.content as Array<{ type?: string; text?: string }>
                    for (const item of contentArr) {
                        if (item.type === 'text' && item.text) {
                            // AI 消息可能很长，截取前 2000 字符
                            const text = item.text
                            dialogueMessages.push({ role: 'AI', text: text.slice(0, 2000) + (text.length > 2000 ? '...(truncated)' : '') })
                        }
                    }
                }
            }
        }

        if (dialogueMessages.length === 0) {
            return c.json({ error: 'No messages found' }, 400)
        }

        // 只取最近的对话（最多 20 轮）
        const recentMessages = dialogueMessages.slice(-40)

        const summary = `以下是主 Session 中的对话内容，请基于这些内容进行 Review：

---

${recentMessages.map((msg) => `**${msg.role}**: ${msg.text}`).join('\n\n---\n\n')}

---

请分析上述对话内容，关注：
1. 用户的需求是否被正确理解
2. AI 的回复是否准确、完整
3. 代码实现是否有问题或可以改进
4. 有什么遗漏或需要注意的地方`

        // 发送给 Review Session
        await engine.sendMessage(reviewSession.reviewSessionId, {
            text: summary,
            sentFrom: 'webapp'
        })

        // 如果是 pending 状态，更新为 active
        if (reviewSession.status === 'pending') {
            await reviewStore.updateReviewSessionStatus(id, 'active')
        }

        return c.json({ success: true })
    })

    // 执行 Review 并发送结果到主 Session
    app.post('/review/sessions/:id/execute', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const reviewSession = await reviewStore.getReviewSession(id)
        if (!reviewSession) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        // 获取 Review Session 的最新 AI 回复
        const messagesResult = await engine.getMessagesPage(reviewSession.reviewSessionId, { limit: 50, beforeSeq: null })

        // 详细日志用于调试
        console.log('[Review Execute] Session:', reviewSession.reviewSessionId)
        console.log('[Review Execute] Messages count:', messagesResult.messages.length)

        // 提取最新的 AI 回复
        const agentMessages: string[] = []
        for (const m of messagesResult.messages) {
            const content = m.content as Record<string, unknown>
            const role = content?.role

            if (role === 'agent') {
                // content.content 可能是 JSON 字符串
                let payload: Record<string, unknown> | null = null
                const rawContent = content?.content
                if (typeof rawContent === 'string') {
                    try {
                        payload = JSON.parse(rawContent)
                    } catch {
                        payload = null
                    }
                } else if (typeof rawContent === 'object' && rawContent) {
                    payload = rawContent as Record<string, unknown>
                }

                if (!payload) continue

                const data = payload.data as Record<string, unknown>
                if (!data) continue

                // data.type === 'assistant' 是 AI 回复
                if (data.type === 'assistant') {
                    // data.message 是 Claude API 格式的消息对象
                    const message = data.message as Record<string, unknown>
                    if (message?.content) {
                        // content 是数组，每个元素可能有 text
                        const contentArr = message.content as Array<{ type?: string; text?: string }>
                        for (const item of contentArr) {
                            if (item.type === 'text' && item.text) {
                                agentMessages.push(item.text)
                            }
                        }
                    }
                }
            }
        }

        if (agentMessages.length === 0) {
            // 打印原始消息用于调试
            const rawSample = messagesResult.messages.slice(0, 5).map(m => {
                const c = m.content as Record<string, unknown>
                return { role: c?.role, type: c?.type, content: JSON.stringify(c?.content).slice(0, 200) }
            })
            console.log('[Review Execute] No agent messages found. Sample:', JSON.stringify(rawSample))
            return c.json({ error: 'No review output found' }, 400)
        }

        // 获取最新的 Review 输出
        const latestReview = agentMessages[agentMessages.length - 1]

        // 标记 Review 为完成
        await reviewStore.updateReviewSessionStatus(id, 'completed')

        // 更新最近的执行记录
        const executions = await reviewStore.getReviewExecutions(id)
        if (executions.length > 0) {
            const latestExecution = executions[0]  // 已按 created_at DESC 排序
            if (latestExecution.status === 'pending') {
                await reviewStore.completeReviewExecution(latestExecution.id, latestReview)
            }
        }

        // 只返回结果，不自动发送到主 Session
        return c.json({
            success: true,
            reviewResult: latestReview
        })
    })

    // 发送用户选择的建议到主 Session
    app.post('/review/sessions/:id/apply', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const body = await c.req.json().catch(() => null) as { action?: string } | null
        if (!body?.action) {
            return c.json({ error: 'action is required' }, 400)
        }

        const reviewSession = await reviewStore.getReviewSession(id)
        if (!reviewSession) {
            return c.json({ error: 'Review session not found' }, 404)
        }

        // 发送建议的 action 到主 Session
        await engine.sendMessage(reviewSession.mainSessionId, {
            text: body.action,
            sentFrom: 'webapp'
        })

        return c.json({ success: true })
    })

    return app
}
