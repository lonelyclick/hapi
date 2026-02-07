/**
 * Brain 模块 API 路由
 *
 * 这是一个试验性功能，用于多 Session 协作 Brain 模式
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine, DecryptedMessage } from '../sync/syncEngine'
import type { SSEManager } from '../sse/sseManager'
import type { WebAppEnv } from '../web/middleware/auth'
import type { BrainStore } from './store'
import type { AutoBrainService } from './autoBrain'
import { buildBrainSystemPrompt, buildReviewPrompt, buildRefineSystemPrompt } from './brainSdkService'
import { refiningSessions } from '../web/routes/messages'

// Brain 上下文最大消息数
const BRAIN_CONTEXT_MAX_MESSAGES = 10

// 支持的 Brain 模型
const brainModelValues = ['claude', 'codex', 'gemini', 'glm', 'grok', 'openrouter'] as const
const brainModelVariantValues = ['opus', 'sonnet', 'haiku', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max'] as const

const createBrainSessionSchema = z.object({
    mainSessionId: z.string().min(1),
    brainModel: z.enum(brainModelValues),
    brainModelVariant: z.string().optional()
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
 * 从主 Session 的消息中构建 Brain 上下文
 * 提取最近 N 轮对话中所有用户的输入
 */
function buildBrainContext(messages: DecryptedMessage[]): string {
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
 * 构建 Brain Prompt
 */
function buildBrainPrompt(
    roundsSummary: string,
    timeRange?: { start: number; end: number }
): string {
    const timeRangeInfo = timeRange
        ? `\n## 时间范围\n\n开发开始时间：${formatTimestamp(timeRange.start)}\n`
        : ''

    return `以下是主 session 的对话汇总。只能查看代码，禁止修改文件。

## 背景
${roundsSummary}
${timeRangeInfo}
## 任务
用工具查看 git 改动和相关代码，review 后：
- 有问题 → 指出哪个文件什么问题（不给修复方案）
- 没问题 → 输出 \`[NO_MESSAGE]\`
`
}

export function createBrainRoutes(
    brainStore: BrainStore,
    getSyncEngine: () => SyncEngine | null,
    getSseManager: () => SSEManager | null,
    autoBrainService?: AutoBrainService
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // 创建 Brain Session
    app.post('/brain/sessions', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = createBrainSessionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', details: parsed.error.issues }, 400)
        }

        const { mainSessionId, brainModel, brainModelVariant } = parsed.data
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
            limit: BRAIN_CONTEXT_MAX_MESSAGES * 2,  // 获取更多消息以确保有足够的用户消息
            beforeSeq: null
        })

        const contextSummary = buildBrainContext(page.messages)

        // 获取主 Session 的工作目录
        const directory = mainSession.metadata?.path
        if (!directory) {
            return c.json({ error: 'Main session has no working directory' }, 400)
        }

        // 创建 Brain Session（在同一目录下）
        const spawnResult = await engine.spawnSession(
            machineId,
            directory,
            brainModel as 'claude' | 'opencode',
            false,  // 不使用 yolo 模式
            'simple',
            undefined,
            {
                modelMode: brainModelVariant as 'opus' | 'sonnet' | undefined,
                source: 'brain'
            }
        )

        if (spawnResult.type !== 'success') {
            return c.json({ error: spawnResult.message }, 500)
        }

        const brainSessionId = spawnResult.sessionId

        // 等待 Brain Session 上线
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

        const isOnline = await waitForOnline(brainSessionId, 60_000)
        if (!isOnline) {
            return c.json({ error: 'Brain session failed to come online' }, 500)
        }

        // 保存 Brain Session 记录
        const brainSession = await brainStore.createBrainSession({
            namespace,
            mainSessionId,
            brainSessionId,
            brainModel,
            brainModelVariant,
            contextSummary
        })

        // 自动触发同步历史对话
        if (autoBrainService) {
            // 延迟触发，确保 CLI daemon 有时间 join socket room
            setTimeout(() => {
                autoBrainService.triggerSync(mainSessionId).catch(err => {
                    console.error('[Brain] Failed to trigger auto sync:', err)
                })
            }, 3000)
        }

        return c.json({
            id: brainSession.id,
            brainSessionId,
            mainSessionId,
            brainModel,
            brainModelVariant,
            status: 'pending'
        })
    })

    // 获取主 Session 的 Brain Sessions 列表
    app.get('/brain/sessions', async (c) => {
        const mainSessionId = c.req.query('mainSessionId')
        if (!mainSessionId) {
            return c.json({ error: 'mainSessionId is required' }, 400)
        }

        const brainSessions = await brainStore.getBrainSessionsByMainSession(mainSessionId)

        return c.json({ brainSessions })
    })

    // 获取主 Session 当前活跃的 Brain Session
    // 注意：这个路由必须在 /brain/sessions/:id 之前定义，否则 'active' 会被当作 id
    app.get('/brain/sessions/active/:mainSessionId', async (c) => {
        const mainSessionId = c.req.param('mainSessionId')
        const brainSession = await brainStore.getActiveBrainSession(mainSessionId)

        const isRefining = refiningSessions.has(mainSessionId)

        if (brainSession) {
            return c.json({ ...brainSession, isRefining })
        }

        // Fallback: 返回最近完成的 brain session（用于恢复 noMessage 等持久化状态）
        const latest = await brainStore.getLatestBrainSession(mainSessionId)
        if (!latest) {
            return c.json({ error: 'No active brain session' }, 404)
        }

        return c.json({ ...latest, isRefining })
    })

    // 获取单个 Brain Session
    app.get('/brain/sessions/:id', async (c) => {
        const id = c.req.param('id')
        const brainSession = await brainStore.getBrainSession(id)

        if (!brainSession) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        return c.json(brainSession)
    })

    // 完成 Brain Session
    app.post('/brain/sessions/:id/complete', async (c) => {
        const id = c.req.param('id')
        const body = await c.req.json().catch(() => ({})) as { result?: string }

        const success = await brainStore.completeBrainSession(id, body.result ?? '')

        if (!success) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        return c.json({ success: true })
    })

    // 同步汇总 - 发送每一轮对话给 Brain AI 做汇总
    // 每次最多处理 3 轮，批量发送给 AI 汇总
    app.post('/brain/sessions/:id/sync', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const brainSession = await brainStore.getBrainSession(id)
        if (!brainSession) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        // 检查 Brain AI 是否正在处理中，避免重复发送
        const brainAISession = await engine.getSession(brainSession.brainSessionId)
        if (brainAISession?.thinking) {
            return c.json({
                success: false,
                error: 'busy',
                message: 'Brain AI 正在处理中，请等待完成后再同步'
            }, 409)
        }

        // 获取主 Session 所有消息
        const allMessages = await engine.getAllMessages(brainSession.mainSessionId)

        // 按轮次分组消息
        const allRounds = groupMessagesIntoRounds(allMessages)

        // 获取已汇总的轮次
        const existingRounds = await brainStore.getBrainRounds(id)
        const summarizedRoundNumbers = new Set(existingRounds.map(r => r.roundNumber))

        // 找出未汇总的轮次（必须有 AI 回复，否则算作"未完成"的轮次）
        const pendingRounds = allRounds.filter(r => !summarizedRoundNumbers.has(r.roundNumber) && r.aiMessages.length > 0)

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

        // 发送给 Brain AI
        await engine.sendMessage(brainSession.brainSessionId, {
            text: syncPrompt,
            sentFrom: 'webapp'
        })

        // 更新状态为 active（如果是 pending）
        if (brainSession.status === 'pending') {
            await brainStore.updateBrainSessionStatus(id, 'active')
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
    // 从 Brain Session 的最新消息中提取汇总并保存到数据库
    // 支持单个 JSON 对象或 JSON 数组（批量汇总）
    app.post('/brain/sessions/:id/save-summary', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const brainSession = await brainStore.getBrainSession(id)
        if (!brainSession) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        // 获取 Brain Session 的最新消息
        const messagesResult = await engine.getMessagesPage(brainSession.brainSessionId, { limit: 10, beforeSeq: null })

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
        const allMessages = await engine.getAllMessages(brainSession.mainSessionId)
        const allRounds = groupMessagesIntoRounds(allMessages)

        // 获取已存在的轮次
        const existingRounds = await brainStore.getBrainRounds(id)
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
            await brainStore.createBrainRound({
                brainSessionId: id,
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

    // 执行 Brain（读取所有已汇总的轮次，发给 Brain AI）
    app.post('/brain/sessions/:id/start', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const brainSession = await brainStore.getBrainSession(id)
        if (!brainSession) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        // 只允许 pending 或 active 状态
        if (brainSession.status !== 'pending' && brainSession.status !== 'active') {
            return c.json({ error: 'Brain session is not in pending or active status' }, 400)
        }

        // 获取所有已汇总的轮次
        const allSummarizedRounds = await brainStore.getBrainRounds(id)

        if (allSummarizedRounds.length === 0) {
            return c.json({ error: 'No summarized rounds found. Please sync first.', noRounds: true }, 400)
        }

        // 获取已经 brain 过的轮次号
        const brainedRoundNumbers = await brainStore.getBrainedRoundNumbers(id)

        // 过滤出未 brain 过的轮次
        const unbrainedRounds = allSummarizedRounds.filter(r => !brainedRoundNumbers.has(r.roundNumber))

        if (unbrainedRounds.length === 0) {
            return c.json({
                error: '所有轮次都已经 brain 过了',
                allBrained: true,
                totalRounds: allSummarizedRounds.length,
                brainedRounds: brainedRoundNumbers.size
            }, 400)
        }

        // 构建对话汇总（只包含未 brain 过的轮次）
        const roundsSummary = unbrainedRounds.map(r => r.aiSummary).join('\n')
        const unbrainedRoundNumbers = unbrainedRounds.map(r => r.roundNumber)

        // 计算时间范围（只针对未 brain 过的轮次）
        let timeRange: { start: number; end: number } | undefined
        const roundsWithTime = unbrainedRounds.filter(r => r.startedAt && r.endedAt)
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

        const brainPrompt = buildBrainPrompt(roundsSummary, timeRange)

        // 创建执行记录（记录本次 brain 的轮次号）
        const execution = await brainStore.createBrainExecution({
            brainSessionId: id,
            roundsReviewed: unbrainedRounds.length,
            reviewedRoundNumbers: unbrainedRoundNumbers,
            timeRangeStart: timeRange?.start ?? Date.now(),
            timeRangeEnd: timeRange?.end ?? Date.now(),
            prompt: brainPrompt
        })

        await engine.sendMessage(brainSession.brainSessionId, {
            text: brainPrompt,
            sentFrom: 'webapp'
        })

        // 更新状态为 active
        if (brainSession.status === 'pending') {
            await brainStore.updateBrainSessionStatus(id, 'active')
        }

        return c.json({
            success: true,
            status: 'active',
            roundsBrained: unbrainedRounds.length,
            brainedRoundNumbers: unbrainedRoundNumbers,
            skippedRounds: Array.from(brainedRoundNumbers),
            executionId: execution.id,
            timeRange
        })
    })

    // 取消 Brain Session
    app.post('/brain/sessions/:id/cancel', async (c) => {
        const id = c.req.param('id')

        const success = await brainStore.updateBrainSessionStatus(id, 'cancelled')

        if (!success) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        return c.json({ success: true })
    })

    // 删除 Brain Session
    app.delete('/brain/sessions/:id', async (c) => {
        const id = c.req.param('id')

        const success = await brainStore.deleteBrainSession(id)

        if (!success) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        return c.json({ success: true })
    })

    // 检查未汇总的轮次
    app.get('/brain/sessions/:id/pending-rounds', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const brainSession = await brainStore.getBrainSession(id)
        if (!brainSession) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        // 获取主 Session 所有消息
        const allMessages = await engine.getAllMessages(brainSession.mainSessionId)

        // 按轮次分组消息
        const allRounds = groupMessagesIntoRounds(allMessages)

        // 获取已汇总的轮次
        const existingRounds = await brainStore.getBrainRounds(id)
        const summarizedRoundNumbers = new Set(existingRounds.map(r => r.roundNumber))

        // 找出未汇总的轮次（必须有 AI 回复，否则算作"未完成"的轮次）
        const pendingRounds = allRounds.filter(r => !summarizedRoundNumbers.has(r.roundNumber) && r.aiMessages.length > 0)

        // 获取已经 brain 过的轮次
        const brainedRoundNumbers = await brainStore.getBrainedRoundNumbers(id)

        // 计算待 brain 的轮次（已汇总但未 brain）
        const unbrainedRounds = existingRounds.filter(r => !brainedRoundNumbers.has(r.roundNumber))

        // 返回已保存的汇总内容（用于刷新页面后恢复显示）
        const savedSummaries = existingRounds.map(r => ({
            round: r.roundNumber,
            summary: r.aiSummary
        })).sort((a, b) => a.round - b.round)

        console.log('[pending-rounds] existingRounds:', existingRounds.length, 'brainedRounds:', brainedRoundNumbers.size, 'unbrainedRounds:', unbrainedRounds.length, 'pendingRounds:', pendingRounds.length)

        return c.json({
            totalRounds: allRounds.length,
            summarizedRounds: existingRounds.length,
            pendingRounds: pendingRounds.length,
            hasPendingRounds: pendingRounds.length > 0,
            // 新增：brain 相关统计
            brainedRounds: brainedRoundNumbers.size,
            unbrainedRounds: unbrainedRounds.length,
            hasUnbrainedRounds: unbrainedRounds.length > 0,
            // 已保存的汇总内容
            savedSummaries
        })
    })

    // 发送对话摘要给 Brain AI
    app.post('/brain/sessions/:id/summarize', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const brainSession = await brainStore.getBrainSession(id)
        if (!brainSession) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        // 获取主 Session 所有消息以确保完整上下文
        const allMessages = await engine.getAllMessages(brainSession.mainSessionId)

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

        const summary = `以下是主 Session 中的对话内容，请基于这些内容进行 Brain 分析：

---

${recentMessages.map((msg) => `**${msg.role}**: ${msg.text}`).join('\n\n---\n\n')}

---

请分析上述对话内容，关注：
1. 用户的需求是否被正确理解
2. AI 的回复是否准确、完整
3. 代码实现是否有问题或可以改进
4. 有什么遗漏或需要注意的地方`

        // 发送给 Brain Session
        await engine.sendMessage(brainSession.brainSessionId, {
            text: summary,
            sentFrom: 'webapp'
        })

        // 如果是 pending 状态，更新为 active
        if (brainSession.status === 'pending') {
            await brainStore.updateBrainSessionStatus(id, 'active')
        }

        return c.json({ success: true })
    })

    // 执行 Brain 并发送结果到主 Session
    app.post('/brain/sessions/:id/execute', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()

        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const brainSession = await brainStore.getBrainSession(id)
        if (!brainSession) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        // 获取 Brain Session 的最新 AI 回复
        const messagesResult = await engine.getMessagesPage(brainSession.brainSessionId, { limit: 50, beforeSeq: null })

        // 详细日志用于调试
        console.log('[Brain Execute] Session:', brainSession.brainSessionId)
        console.log('[Brain Execute] Messages count:', messagesResult.messages.length)

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
            console.log('[Brain Execute] No agent messages found. Sample:', JSON.stringify(rawSample))
            return c.json({ error: 'No brain output found' }, 400)
        }

        // 获取最新的 Brain 输出
        const latestBrain = agentMessages[agentMessages.length - 1]

        // 标记 Brain 为完成
        await brainStore.updateBrainSessionStatus(id, 'completed')

        // 更新最近的执行记录
        const executions = await brainStore.getBrainExecutions(id)
        if (executions.length > 0) {
            const latestExecution = executions[0]  // 已按 created_at DESC 排序
            if (latestExecution.status === 'pending') {
                await brainStore.completeBrainExecution(latestExecution.id, latestBrain)
            }
        }

        // 只返回结果，不自动发送到主 Session
        return c.json({
            success: true,
            brainResult: latestBrain
        })
    })

    // ============================================================
    // Brain SDK Routes - 使用 Claude Agent SDK 直接处理
    // ============================================================

    // 使用 SDK 执行 Brain 代码审查（spawn detached worker）
    app.post('/brain/sessions/:id/execute-sdk', async (c) => {
        const id = c.req.param('id')
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const brainSession = await brainStore.getBrainSession(id)
        if (!brainSession) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        // 检查是否已有正在运行的 execution
        const latestExec = await brainStore.getLatestExecutionWithProgress(id)
        if (latestExec?.status === 'running') {
            return c.json({ error: 'Brain review already in progress', executionId: latestExec.id }, 409)
        }

        const body = await c.req.json().catch(() => ({})) as {
            customInstructions?: string
        }

        // 获取主 Session 的信息
        const mainSession = engine.getSession(brainSession.mainSessionId)
        if (!mainSession) {
            return c.json({ error: 'Main session not found' }, 404)
        }

        const projectPath = mainSession.metadata?.path
        if (!projectPath) {
            return c.json({ error: 'Main session has no working directory' }, 400)
        }

        // 获取已汇总的轮次
        const allSummarizedRounds = await brainStore.getBrainRounds(id)
        if (allSummarizedRounds.length === 0) {
            return c.json({ error: 'No summarized rounds found. Please sync first.', noRounds: true }, 400)
        }

        // 获取已经 brain 过的轮次
        const brainedRoundNumbers = await brainStore.getBrainedRoundNumbers(id)

        // 过滤出未 brain 过的轮次
        const unbrainedRounds = allSummarizedRounds.filter(r => !brainedRoundNumbers.has(r.roundNumber))

        if (unbrainedRounds.length === 0) {
            return c.json({
                error: '所有轮次都已经 brain 过了',
                allBrained: true,
                totalRounds: allSummarizedRounds.length,
                brainedRounds: brainedRoundNumbers.size
            }, 400)
        }

        // 构建审查提示词
        const roundsSummary = unbrainedRounds.map(r => `### 第 ${r.roundNumber} 轮\n${r.aiSummary}`).join('\n\n')
        const contextSummary = brainSession.contextSummary || '(无上下文)'

        // 计算时间范围
        const roundsWithTime = unbrainedRounds.filter(r => r.startedAt && r.endedAt)
        let timeRange: { start: number; end: number } | undefined
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

        const reviewPrompt = buildReviewPrompt(
            contextSummary,
            roundsSummary,
            timeRange
        )

        const systemPrompt = buildBrainSystemPrompt(body.customInstructions)

        // 创建执行记录（status=running）
        const execution = await brainStore.createBrainExecution({
            brainSessionId: id,
            roundsReviewed: unbrainedRounds.length,
            reviewedRoundNumbers: unbrainedRounds.map(r => r.roundNumber),
            timeRangeStart: timeRange?.start ?? Date.now(),
            timeRangeEnd: timeRange?.end ?? Date.now(),
            prompt: reviewPrompt,
            status: 'running'
        })

        // spawn detached worker
        const { spawn } = await import('child_process')
        const { existsSync } = await import('fs')
        const pathMod = await import('path')

        // 查找 worker 路径
        let workerPath: string | null = null
        const serverDir = pathMod.dirname(process.execPath)
        const candidate1 = pathMod.join(serverDir, 'hapi-brain-worker')
        const candidate2 = '/home/guang/softwares/hapi/cli/dist-exe/bun-linux-x64/hapi-brain-worker'
        if (existsSync(candidate1)) workerPath = candidate1
        else if (existsSync(candidate2)) workerPath = candidate2

        if (!workerPath) {
            await brainStore.failBrainExecution(execution.id, 'hapi-brain-worker executable not found')
            return c.json({ error: 'Brain worker executable not found' }, 500)
        }

        const model = brainSession.brainModelVariant === 'opus'
            ? 'claude-opus-4-5-20250929'
            : 'claude-sonnet-4-5-20250929'

        const config = JSON.stringify({
            executionId: execution.id,
            brainSessionId: id,
            mainSessionId: brainSession.mainSessionId,
            prompt: reviewPrompt,
            projectPath,
            model,
            systemPrompt,
            serverCallbackUrl: `http://127.0.0.1:${process.env.WEBAPP_PORT || '3006'}`,
            serverToken: process.env.CLI_API_TOKEN || '',
        })

        try {
            const child = spawn(workerPath, [config], {
                detached: true,
                stdio: 'ignore',
                env: process.env as NodeJS.ProcessEnv
            })
            child.unref()
            console.log('[Brain SDK] Spawned detached worker PID:', child.pid, 'for execution:', execution.id)
        } catch (err) {
            await brainStore.failBrainExecution(execution.id, `Failed to spawn worker: ${(err as Error).message}`)
            return c.json({ error: 'Failed to spawn brain worker', message: (err as Error).message }, 500)
        }

        // SSE 广播 started 事件
        const sseManager = getSseManager()
        if (sseManager) {
            sseManager.broadcast({
                type: 'brain-sdk-progress',
                namespace: mainSession.namespace,
                sessionId: brainSession.mainSessionId,
                data: {
                    brainSessionId: id,
                    progressType: 'started',
                    data: {}
                }
            } as unknown as import('../sync/syncEngine.js').SyncEvent)
        }

        return c.json({
            success: true,
            status: 'spawned',
            executionId: execution.id,
            roundsBrained: unbrainedRounds.length
        }, 202)
    })

    // 获取 Brain SDK 查询状态（从 DB 查询）
    app.get('/brain/sessions/:id/sdk-status', async (c) => {
        const id = c.req.param('id')
        const execution = await brainStore.getLatestExecutionWithProgress(id)

        if (!execution) {
            return c.json({
                hasResult: false,
                isRunning: false,
                result: null
            })
        }

        return c.json({
            hasResult: execution.status === 'completed' || execution.status === 'failed',
            isRunning: execution.status === 'running',
            result: {
                status: execution.status,
                executionId: execution.id
            }
        })
    })

    // 获取 Brain Session 的最新执行进度日志（用于前端加载历史）
    app.get('/brain/sessions/:id/progress-log', async (c) => {
        const id = c.req.param('id')
        const brainSession = await brainStore.getBrainSession(id)
        if (!brainSession) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        const execution = await brainStore.getLatestExecutionWithProgress(id)
        if (!execution) {
            return c.json({ entries: [], isActive: false })
        }

        return c.json({
            entries: execution.progressLog,
            isActive: execution.status === 'running',
            executionId: execution.id
        })
    })

    // 中止 Brain SDK 查询
    // 触发 autoBrain 的 syncRounds（SDK 模式的完整链路：GLM 摘要 + SDK review）
    app.post('/brain/sessions/:id/auto-sync', async (c) => {
        if (!autoBrainService) {
            return c.json({ error: 'AutoBrain service not available' }, 503)
        }

        const id = c.req.param('id')
        const brainSession = await brainStore.getBrainSession(id)
        if (!brainSession) {
            return c.json({ error: 'Brain session not found' }, 404)
        }

        // 异步触发
        autoBrainService.triggerSync(brainSession.mainSessionId).catch(err => {
            console.error('[Brain] auto-sync trigger failed:', err)
        })

        return c.json({
            success: true,
            message: 'Auto sync triggered (async)'
        })
    })

    // Worker 完成后的回调通知（detached worker 通过 HTTP 通知 server）
    // 此路由在 publicPaths 中跳过 Keycloak 认证，使用 workerSecret 验证
    app.post('/brain/worker-callback', async (c) => {
        // 验证 worker secret（防止非 worker 调用）
        const workerSecret = c.req.header('x-worker-secret')
        const expectedSecret = process.env.CLI_API_TOKEN
        if (!workerSecret || !expectedSecret || workerSecret !== expectedSecret) {
            return c.json({ error: 'Unauthorized' }, 401)
        }

        const body = await c.req.json().catch(() => null) as {
            executionId: string
            brainSessionId: string
            mainSessionId: string
            status: 'completed' | 'failed'
            output?: string
            error?: string
            phase?: 'review' | 'refine'
            refineSentFrom?: 'webapp' | 'brain-review'
            originalPrompt?: string
        } | null

        if (!body?.executionId) {
            return c.json({ error: 'Invalid callback body' }, 400)
        }

        const engine = getSyncEngine()
        const callbackPhase = body.phase || 'review'

        console.log(`[BrainWorkerCallback] phase=${callbackPhase} status=${body.status} executionId=${body.executionId} mainSessionId=${body.mainSessionId} outputLen=${body.output?.length ?? 0} error=${body.error ?? 'none'}`)

        if (body.status === 'completed' && body.output) {
            if (body.output.includes('[NO_MESSAGE]')) {
                // NO_MESSAGE: 不发真实消息给主 session，只通过 SSE 广播通知前端
                // 持久化到 brain_sessions 表，前端刷新后可恢复状态
                console.log(`[BrainWorkerCallback] ${callbackPhase} result contains [NO_MESSAGE], broadcasting via SSE only`)
                await brainStore.completeBrainSession(body.brainSessionId, '[NO_MESSAGE]')
            } else if (callbackPhase === 'refine') {
                // refine 完成：发给主 session，sentFrom 由调用方决定
                // 注意：refine 是消息拦截优化，不结束 brain session
                const sentFrom = (body.refineSentFrom as 'webapp' | 'brain-review') || 'brain-review'
                console.log(`[BrainWorkerCallback] refine completed, sending to main session, sentFrom=${sentFrom}, outputLen=${body.output.length}`)
                await engine?.sendMessage(body.mainSessionId, {
                    text: body.output,
                    sentFrom
                })
            } else {
                // review 阶段完成：直接发给主 session，加上发送者标识
                console.log(`[BrainWorkerCallback] review completed, sending directly to main session, outputLen=${body.output.length}`)
                await engine?.sendMessage(body.mainSessionId, {
                    text: `[发送者: Brain 代码审查]\n\n${body.output}`,
                    sentFrom: 'brain-review'
                })
                // 保存 review 结果但保持 brain session 为 active（后续新对话还会继续被 review）
                await brainStore.updateBrainResult(body.brainSessionId, body.output)
            }
        } else if (body.status === 'failed') {
            console.error(`[BrainWorkerCallback] ${callbackPhase} FAILED: ${body.error || '未知错误'}`)
            if (callbackPhase === 'refine' && body.originalPrompt) {
                // refine 失败时，直接发送用户原始消息（不丢消息）
                console.log(`[BrainWorkerCallback] refine failed, falling back to send original message directly`)
                const sentFrom = (body.refineSentFrom as 'webapp' | 'brain-review') || 'webapp'
                await engine?.sendMessage(body.mainSessionId, {
                    text: body.originalPrompt,
                    sentFrom
                })
            } else {
                await engine?.sendMessage(body.mainSessionId, {
                    text: `Brain 审查失败: ${body.error || '未知错误'}`,
                    sentFrom: 'brain-review'
                })
            }
        }

        // 清除 refine 状态
        refiningSessions.delete(body.mainSessionId)

        // SSE 广播 done 事件：review/refine 完成、失败、NO_MESSAGE 均广播
        const shouldBroadcastDone = body.status === 'completed'
            || body.status === 'failed'

        if (shouldBroadcastDone) {
            const sseManager = getSseManager()
            if (sseManager) {
                const mainSession = engine?.getSession(body.mainSessionId)
                const noMessage = body.status === 'completed' && body.output?.includes('[NO_MESSAGE]')
                sseManager.broadcast({
                    type: 'brain-sdk-progress',
                    namespace: mainSession?.namespace,
                    sessionId: body.mainSessionId,
                    data: {
                        brainSessionId: body.brainSessionId,
                        progressType: 'done',
                        data: { status: body.status, noMessage }
                    }
                } as unknown as import('../sync/syncEngine.js').SyncEvent)
            }
        }

        return c.json({ success: true })
    })

    app.post('/brain/sessions/:id/sdk-abort', async (c) => {
        const id = c.req.param('id')

        // 从 DB 获取最新的 running execution
        const execution = await brainStore.getLatestExecutionWithProgress(id)
        if (!execution || execution.status !== 'running') {
            return c.json({ success: false, message: 'No running execution' })
        }

        // 获取 worker PID 并发送 SIGTERM
        const pid = await brainStore.getExecutionWorkerPid(execution.id)
        if (pid) {
            try {
                process.kill(pid, 'SIGTERM')
                return c.json({ success: true, message: `Sent SIGTERM to worker PID ${pid}` })
            } catch {
                return c.json({ success: false, message: 'Worker process not found (may have already exited)' })
            }
        }

        return c.json({ success: false, message: 'No worker PID found' })
    })

    return app
}
