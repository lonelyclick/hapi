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

const addProjectSchema = z.object({
    name: z.string().min(1).max(100),
    path: z.string().min(1).max(500),
    description: z.string().max(500).optional()
})

const updateProjectSchema = z.object({
    name: z.string().min(1).max(100),
    path: z.string().min(1).max(500),
    description: z.string().max(500).optional()
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

    // 获取所有项目
    app.get('/settings/projects', (c) => {
        const projects = store.getProjects()
        return c.json({ projects })
    })

    // 添加项目
    app.post('/settings/projects', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = addProjectSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid project data' }, 400)
        }

        const project = store.addProject(parsed.data.name, parsed.data.path, parsed.data.description)
        if (!project) {
            return c.json({ error: 'Failed to add project. Path may already exist.' }, 400)
        }

        const projects = store.getProjects()
        return c.json({ ok: true, project, projects })
    })

    // 更新项目
    app.put('/settings/projects/:id', async (c) => {
        const id = c.req.param('id')
        const json = await c.req.json().catch(() => null)
        const parsed = updateProjectSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid project data' }, 400)
        }

        const project = store.updateProject(id, parsed.data.name, parsed.data.path, parsed.data.description)
        if (!project) {
            return c.json({ error: 'Project not found or path already exists' }, 404)
        }

        const projects = store.getProjects()
        return c.json({ ok: true, project, projects })
    })

    // 删除项目
    app.delete('/settings/projects/:id', (c) => {
        const id = c.req.param('id')
        const success = store.removeProject(id)
        if (!success) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const projects = store.getProjects()
        return c.json({ ok: true, projects })
    })

    return app
}
