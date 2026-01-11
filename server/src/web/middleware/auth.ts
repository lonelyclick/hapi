import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { jwtVerify } from 'jose'

export type WebAppEnv = {
    Variables: {
        userId: number
        namespace: string
        email?: string
        clientId?: string
        deviceType?: string
    }
}

const jwtPayloadSchema = z.object({
    uid: z.number(),
    ns: z.string(),
    em: z.string().optional(),
    cid: z.string().optional(),
    dt: z.string().optional()
})

export function createAuthMiddleware(jwtSecret: Uint8Array): MiddlewareHandler<WebAppEnv> {
    return async (c, next) => {
        const path = c.req.path
        if (path === '/api/auth' || path === '/api/bind') {
            await next()
            return
        }

        const authorization = c.req.header('authorization')
        const tokenFromHeader = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
        // 支持从 URL query 获取 token（用于 SSE 和图片等需要直接 URL 访问的场景）
        const allowTokenInQuery = path === '/api/events' || path.includes('/file') || path.includes('/server-uploads/') || path.includes('/server-downloads/')
        const tokenFromQuery = allowTokenInQuery ? c.req.query().token : undefined
        const token = tokenFromHeader ?? tokenFromQuery

        if (!token) {
            return c.json({ error: 'Missing authorization token' }, 401)
        }

        try {
            const verified = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] })
            const parsed = jwtPayloadSchema.safeParse(verified.payload)
            if (!parsed.success) {
                return c.json({ error: 'Invalid token payload' }, 401)
            }

            c.set('userId', parsed.data.uid)
            c.set('namespace', parsed.data.ns)
            c.set('email', parsed.data.em)
            c.set('clientId', parsed.data.cid)
            c.set('deviceType', parsed.data.dt)
            await next()
            return
        } catch {
            return c.json({ error: 'Invalid token' }, 401)
        }
    }
}
