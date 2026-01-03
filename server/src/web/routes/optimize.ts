import { Hono } from 'hono'
import { z } from 'zod'
import { configuration } from '../../configuration'
import type { WebAppEnv } from '../middleware/auth'

const optimizeBodySchema = z.object({
    text: z.string().min(1).max(10000)
})

export function createOptimizeRoutes(): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.post('/optimize', async (c) => {
        const apiKey = configuration.geminiApiKey
        if (!apiKey) {
            return c.json({ error: 'Gemini API key not configured' }, 503)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = optimizeBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const { text } = parsed.data

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{
                                text: `你是一个文本优化助手。请优化以下用户输入的文本：
1. 修正语音转文字可能产生的错误（同音字、断句问题）
2. 特别注意中英文混合识别错误：
   - 英文单词被错误识别成中文（如 "react" 被识别成 "瑞艾克特"）
   - 英文发音不准导致的拼写错误（如 "componet" 应为 "component"）
   - 技术术语的识别错误（如 "API"、"TypeScript"、"Node.js" 等）
3. 保持原意的同时使语句更通顺自然
4. 不要添加额外信息，只优化表达
5. 保留所有以 @ 开头的文件引用（如 @deploy.sh、@README.md），这是特殊语法，不要修改或删除 @ 符号
6. 如果优化后的结果与原文只有标点符号、空格或缩进的差异（如添加/删除句号、逗号、空格等），则直接返回原文，不要做任何修改
7. 直接输出优化后的文本，不要解释

用户输入：
${text}`
                            }]
                        }],
                        generationConfig: {
                            temperature: 0.3,
                            maxOutputTokens: 2048
                        }
                    })
                }
            )

            if (!response.ok) {
                console.error(`[Optimize] Gemini API error: ${response.status}`)
                return c.json({ error: 'Gemini API error' }, 502)
            }

            const data = await response.json() as {
                candidates?: Array<{
                    content?: { parts?: Array<{ text?: string }> }
                }>
            }
            const optimizedText = data.candidates?.[0]?.content?.parts?.[0]?.text
            if (!optimizedText) {
                return c.json({ error: 'No response from Gemini' }, 502)
            }

            return c.json({ optimized: optimizedText.trim() })
        } catch (error) {
            console.error('[Optimize] Failed to call Gemini:', error)
            return c.json({ error: 'Failed to optimize text' }, 500)
        }
    })

    return app
}
