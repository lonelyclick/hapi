import { Hono } from 'hono'
import { z } from 'zod'
import type { WebAppEnv } from '../middleware/auth'
import { configuration } from '../../configuration'
import { getFeishuBaseUrl, getFeishuTenantAccessToken } from '../../services/feishu'

const streamSchema = z.object({
    streamId: z.string().min(1),
    sequenceId: z.number().int().min(0),
    action: z.enum(['start', 'continue', 'stop', 'cancel']),
    speech: z.string().min(1),
    format: z.string().optional(),
    engineType: z.string().optional()
})

const ACTION_MAP: Record<z.infer<typeof streamSchema>['action'], number> = {
    start: 1,
    continue: 0,
    stop: 2,
    cancel: 3
}

type StreamRecognizeData = {
    recognition_text?: string
}

export function createSpeechRoutes(): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.post('/speech-to-text/stream', async (c) => {
        if (!configuration.feishuAppId || !configuration.feishuAppSecret) {
            return c.json({ error: 'Feishu app is not configured' }, 503)
        }

        let payload: unknown
        try {
            payload = await c.req.json()
        } catch {
            return c.json({ error: 'Invalid JSON body' }, 400)
        }

        const parsed = streamSchema.safeParse(payload)
        if (!parsed.success) {
            return c.json({ error: 'Invalid speech payload' }, 400)
        }

        try {
            const token = await getFeishuTenantAccessToken()
            const action = ACTION_MAP[parsed.data.action]
            const url = `${getFeishuBaseUrl()}/open-apis/speech_to_text/v1/speech/stream_recognize`
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    config: {
                        stream_id: parsed.data.streamId,
                        sequence_id: parsed.data.sequenceId,
                        action,
                        format: parsed.data.format ?? 'pcm',
                        engine_type: parsed.data.engineType ?? '16k_auto'
                    },
                    speech: {
                        speech: parsed.data.speech
                    }
                })
            })

            const resetHeader = response.headers.get('x-ogw-ratelimit-reset')
            const retryAfter = resetHeader ? Number(resetHeader) : null

            const text = await response.text()
            let payload: Record<string, unknown> = {}
            if (text) {
                try {
                    payload = JSON.parse(text) as Record<string, unknown>
                } catch {
                    payload = { raw: text }
                }
            }

            const code = typeof payload.code === 'number' ? payload.code : undefined
            const msg = typeof payload.msg === 'string' ? payload.msg : undefined

            const isRateLimited = response.status === 429
                || (response.status === 400 && (code === 99991400 || code === 10024))
                || (msg ? msg.toLowerCase().includes('frequency limit') || msg.toLowerCase().includes('qps exceeded') : false)

            if (isRateLimited) {
                return c.json({ error: 'rate_limited', retryAfter, code }, 429)
            }

            if (!response.ok) {
                return c.json({ error: `Feishu HTTP ${response.status}`, code, detail: payload }, 502)
            }

            if (code && code !== 0) {
                return c.json({ error: msg ?? `Feishu error ${code}`, code }, 502)
            }

            return c.json(payload as { code?: number; msg?: string; data?: StreamRecognizeData })
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Speech-to-text failed'
            }, 502)
        }
    })

    return app
}
