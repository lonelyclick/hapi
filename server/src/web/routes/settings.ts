import { Hono } from 'hono'
import { z } from 'zod'
import type { WebAppEnv } from '../middleware/auth'
import type { Store, UserRole } from '../../store'

const userRoleSchema = z.enum(['developer', 'operator'])

const addUserSchema = z.object({
    email: z.string().email(),
    role: userRoleSchema.optional().default('developer')
})

const updateUserRoleSchema = z.object({
    role: userRoleSchema
})

const removeUserSchema = z.object({
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

const setRolePromptSchema = z.object({
    prompt: z.string().max(10000)
})

const addInputPresetSchema = z.object({
    trigger: z.string().min(1).max(50),
    title: z.string().min(1).max(100),
    prompt: z.string().min(1).max(50000)
})

const updateInputPresetSchema = z.object({
    trigger: z.string().min(1).max(50),
    title: z.string().min(1).max(100),
    prompt: z.string().min(1).max(50000)
})

export function createSettingsRoutes(store: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // ==================== 用户管理 (合并了 Allowed Emails) ====================

    // 获取所有用户
    app.get('/settings/users', (_c) => {
        const users = store.getAllowedUsers()
        return _c.json({ users })
    })

    // 添加用户
    app.post('/settings/users', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = addUserSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid user data' }, 400)
        }

        const success = store.addAllowedEmail(parsed.data.email, parsed.data.role as UserRole)
        if (!success) {
            return c.json({ error: 'Failed to add user' }, 500)
        }

        const users = store.getAllowedUsers()
        return c.json({ ok: true, users })
    })

    // 更新用户角色
    app.put('/settings/users/:email/role', async (c) => {
        const email = decodeURIComponent(c.req.param('email'))
        const json = await c.req.json().catch(() => null)
        const parsed = updateUserRoleSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid role' }, 400)
        }

        const success = store.updateAllowedEmailRole(email, parsed.data.role as UserRole)
        if (!success) {
            return c.json({ error: 'User not found' }, 404)
        }

        const users = store.getAllowedUsers()
        return c.json({ ok: true, users })
    })

    // 删除用户
    app.delete('/settings/users', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = removeUserSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid email format' }, 400)
        }

        const success = store.removeAllowedEmail(parsed.data.email)
        if (!success) {
            return c.json({ error: 'User not found' }, 404)
        }

        const users = store.getAllowedUsers()
        return c.json({ ok: true, users })
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

    // ==================== 角色预设 Prompt ====================

    // 获取所有角色的预设 Prompt
    app.get('/settings/role-prompts', (_c) => {
        const prompts = store.getAllRolePrompts()
        return _c.json({ prompts })
    })

    // 获取指定角色的预设 Prompt
    app.get('/settings/role-prompts/:role', (c) => {
        const role = c.req.param('role')
        if (role !== 'developer' && role !== 'operator') {
            return c.json({ error: 'Invalid role' }, 400)
        }
        const prompt = store.getRolePrompt(role as UserRole)
        return c.json({ role, prompt })
    })

    // 设置角色的预设 Prompt
    app.put('/settings/role-prompts/:role', async (c) => {
        const role = c.req.param('role')
        if (role !== 'developer' && role !== 'operator') {
            return c.json({ error: 'Invalid role' }, 400)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = setRolePromptSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid prompt data' }, 400)
        }

        const success = store.setRolePrompt(role as UserRole, parsed.data.prompt)
        if (!success) {
            return c.json({ error: 'Failed to set prompt' }, 500)
        }

        const prompts = store.getAllRolePrompts()
        return c.json({ ok: true, prompts })
    })

    // 删除角色的预设 Prompt
    app.delete('/settings/role-prompts/:role', (c) => {
        const role = c.req.param('role')
        if (role !== 'developer' && role !== 'operator') {
            return c.json({ error: 'Invalid role' }, 400)
        }

        store.removeRolePrompt(role as UserRole)
        const prompts = store.getAllRolePrompts()
        return c.json({ ok: true, prompts })
    })

    // ==================== 输入预设管理 ====================

    // 获取所有输入预设
    app.get('/settings/input-presets', (_c) => {
        const presets = store.getAllInputPresets()
        return _c.json({ presets })
    })

    // 添加输入预设
    app.post('/settings/input-presets', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = addInputPresetSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid preset data' }, 400)
        }

        const preset = store.addInputPreset(parsed.data.trigger, parsed.data.title, parsed.data.prompt)
        if (!preset) {
            return c.json({ error: 'Failed to add preset. Trigger may already exist.' }, 400)
        }

        const presets = store.getAllInputPresets()
        return c.json({ ok: true, preset, presets })
    })

    // 更新输入预设
    app.put('/settings/input-presets/:id', async (c) => {
        const id = c.req.param('id')
        const json = await c.req.json().catch(() => null)
        const parsed = updateInputPresetSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid preset data' }, 400)
        }

        const preset = store.updateInputPreset(id, parsed.data.trigger, parsed.data.title, parsed.data.prompt)
        if (!preset) {
            return c.json({ error: 'Preset not found or trigger already exists' }, 404)
        }

        const presets = store.getAllInputPresets()
        return c.json({ ok: true, preset, presets })
    })

    // 删除输入预设
    app.delete('/settings/input-presets/:id', (c) => {
        const id = c.req.param('id')
        const success = store.removeInputPreset(id)
        if (!success) {
            return c.json({ error: 'Preset not found' }, 404)
        }

        const presets = store.getAllInputPresets()
        return c.json({ ok: true, presets })
    })

    return app
}
