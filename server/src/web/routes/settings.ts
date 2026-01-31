import { Hono } from 'hono'
import { z } from 'zod'
import type { WebAppEnv } from '../middleware/auth'
import type { IStore, UserRole } from '../../store'

const addProjectSchema = z.object({
    name: z.string().min(1).max(100),
    path: z.string().min(1).max(500),
    description: z.string().max(500).optional(),
    machineId: z.string().nullable().optional()
})

const updateProjectSchema = z.object({
    name: z.string().min(1).max(100),
    path: z.string().min(1).max(500),
    description: z.string().max(500).optional(),
    machineId: z.string().nullable().optional()
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

export function createSettingsRoutes(
    store: IStore
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // ==================== 项目管理 ====================

    // 获取所有项目（支持按 machineId 过滤）
    app.get('/settings/projects', async (c) => {
        const machineId = c.req.query('machineId')
        // machineId 参数为空字符串时当作 null 处理（获取通用项目）
        const filterMachineId = machineId === '' ? null : machineId
        const projects = await store.getProjects(filterMachineId)
        return c.json({ projects })
    })

    // 添加项目
    app.post('/settings/projects', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = addProjectSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid project data' }, 400)
        }

        const project = await store.addProject(
            parsed.data.name,
            parsed.data.path,
            parsed.data.description,
            parsed.data.machineId
        )
        if (!project) {
            return c.json({ error: 'Failed to add project. Path may already exist.' }, 400)
        }

        const projects = await store.getProjects()
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

        const project = await store.updateProject(
            id,
            parsed.data.name,
            parsed.data.path,
            parsed.data.description,
            parsed.data.machineId
        )
        if (!project) {
            return c.json({ error: 'Project not found or path already exists' }, 404)
        }

        const projects = await store.getProjects()
        return c.json({ ok: true, project, projects })
    })

    // 删除项目
    app.delete('/settings/projects/:id', async (c) => {
        const id = c.req.param('id')
        const success = await store.removeProject(id)
        if (!success) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const projects = await store.getProjects()
        return c.json({ ok: true, projects })
    })

    // ==================== 角色预设 Prompt ====================

    // 获取所有角色的预设 Prompt
    app.get('/settings/role-prompts', async (_c) => {
        const prompts = await store.getAllRolePrompts()
        return _c.json({ prompts })
    })

    // 获取指定角色的预设 Prompt
    app.get('/settings/role-prompts/:role', async (c) => {
        const role = c.req.param('role')
        if (role !== 'developer' && role !== 'operator') {
            return c.json({ error: 'Invalid role' }, 400)
        }
        const prompt = await store.getRolePrompt(role as UserRole)
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

        const success = await store.setRolePrompt(role as UserRole, parsed.data.prompt)
        if (!success) {
            return c.json({ error: 'Failed to set prompt' }, 500)
        }

        const prompts = await store.getAllRolePrompts()
        return c.json({ ok: true, prompts })
    })

    // 删除角色的预设 Prompt
    app.delete('/settings/role-prompts/:role', async (c) => {
        const role = c.req.param('role')
        if (role !== 'developer' && role !== 'operator') {
            return c.json({ error: 'Invalid role' }, 400)
        }

        await store.removeRolePrompt(role as UserRole)
        const prompts = await store.getAllRolePrompts()
        return c.json({ ok: true, prompts })
    })

    // ==================== 输入预设管理 ====================

    // 获取所有输入预设
    app.get('/settings/input-presets', async (_c) => {
        const presets = await store.getAllInputPresets()
        return _c.json({ presets })
    })

    // 添加输入预设
    app.post('/settings/input-presets', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = addInputPresetSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid preset data' }, 400)
        }

        const preset = await store.addInputPreset(parsed.data.trigger, parsed.data.title, parsed.data.prompt)
        if (!preset) {
            return c.json({ error: 'Failed to add preset. Trigger may already exist.' }, 400)
        }

        const presets = await store.getAllInputPresets()
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

        const preset = await store.updateInputPreset(id, parsed.data.trigger, parsed.data.title, parsed.data.prompt)
        if (!preset) {
            return c.json({ error: 'Preset not found or trigger already exists' }, 404)
        }

        const presets = await store.getAllInputPresets()
        return c.json({ ok: true, preset, presets })
    })

    // 删除输入预设
    app.delete('/settings/input-presets/:id', async (c) => {
        const id = c.req.param('id')
        const success = await store.removeInputPreset(id)
        if (!success) {
            return c.json({ error: 'Preset not found' }, 404)
        }

        const presets = await store.getAllInputPresets()
        return c.json({ ok: true, presets })
    })

    return app
}
