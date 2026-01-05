import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { z } from 'zod'
import { configuration } from '../../configuration'
import { safeCompareStrings } from '../../utils/crypto'
import { parseAccessToken } from '../../utils/accessToken'
import { validateTelegramInitData } from '../telegramInitData'
import { getOrCreateOwnerId } from '../ownerId'
import type { WebAppEnv } from '../middleware/auth'
import type { IStore } from '../../store'

const telegramAuthSchema = z.object({
    initData: z.string()
})

const accessTokenAuthSchema = z.object({
    accessToken: z.string(),
    email: z.string().optional(),
    clientId: z.string().optional(),
    deviceType: z.string().optional()
})

const authBodySchema = z.union([telegramAuthSchema, accessTokenAuthSchema])

export function createAuthRoutes(jwtSecret: Uint8Array, store: IStore): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.post('/auth', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = authBodySchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        let userId: number
        let email: string | undefined
        let firstName: string | undefined
        let lastName: string | undefined
        let namespace: string
        let clientId: string | undefined
        let deviceType: string | undefined

        // Access Token authentication (CLI_API_TOKEN)
        if ('accessToken' in parsed.data) {
            const parsedToken = parseAccessToken(parsed.data.accessToken)
            if (!parsedToken || !safeCompareStrings(parsedToken.baseToken, configuration.cliApiToken)) {
                return c.json({ error: 'Invalid access token' }, 401)
            }

            // 检查邮箱白名单
            const userEmail = parsed.data.email?.toLowerCase()
            if (userEmail) {
                const allowedEmails = store.getAllowedEmails()
                // 如果白名单为空，允许所有邮箱；否则检查是否在白名单中
                if (allowedEmails.length > 0 && !allowedEmails.includes(userEmail)) {
                    return c.json({ error: 'Email not authorized' }, 403)
                }
            }

            userId = await getOrCreateOwnerId()
            email = userEmail
            firstName = userEmail?.split('@')[0] || 'Web User'
            clientId = parsed.data.clientId
            deviceType = parsed.data.deviceType
            namespace = parsedToken.namespace
        } else {
            if (!configuration.telegramEnabled || !configuration.telegramBotToken) {
                return c.json({ error: 'Telegram authentication is disabled. Configure TELEGRAM_BOT_TOKEN.' }, 503)
            }

            // Telegram initData authentication
            const result = validateTelegramInitData(parsed.data.initData, configuration.telegramBotToken)
            if (!result.ok) {
                return c.json({ error: result.error }, 401)
            }

            const telegramUserId = String(result.user.id)
            const storedUser = store.getUser('telegram', telegramUserId)
            if (!storedUser) {
                return c.json({ error: 'not_bound' }, 401)
            }

            userId = await getOrCreateOwnerId()
            email = result.user.username  // Telegram uses username as email equivalent
            firstName = result.user.first_name
            lastName = result.user.last_name
            namespace = storedUser.namespace
        }

        const token = await new SignJWT({
            uid: userId,
            ns: namespace,
            em: email,
            cid: clientId,
            dt: deviceType
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('15m')
            .sign(jwtSecret)

        return c.json({
            token,
            user: {
                id: userId,
                email,
                firstName,
                lastName,
                clientId,
                deviceType
            }
        })
    })

    return app
}
