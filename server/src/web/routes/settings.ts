import { Hono } from 'hono'
import { z } from 'zod'
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'

const addEmailSchema = z.object({
    email: z.string().email()
})

const removeEmailSchema = z.object({
    email: z.string().email()
})

export function createSettingsRoutes(store: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // 获取所有允许的邮箱
    app.get('/settings/allowed-emails', (c) => {
        const emails = store.getAllowedEmails()
        return c.json({ emails })
    })

    // 添加允许的邮箱
    app.post('/settings/allowed-emails', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = addEmailSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid email format' }, 400)
        }

        const success = store.addAllowedEmail(parsed.data.email)
        if (!success) {
            return c.json({ error: 'Failed to add email' }, 500)
        }

        const emails = store.getAllowedEmails()
        return c.json({ ok: true, emails })
    })

    // 删除允许的邮箱
    app.delete('/settings/allowed-emails', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = removeEmailSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid email format' }, 400)
        }

        const success = store.removeAllowedEmail(parsed.data.email)
        if (!success) {
            return c.json({ error: 'Email not found' }, 404)
        }

        const emails = store.getAllowedEmails()
        return c.json({ ok: true, emails })
    })

    return app
}
