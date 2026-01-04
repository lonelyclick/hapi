import { Hono } from 'hono'
import { z } from 'zod'
import type { WebAppEnv } from '../middleware/auth'
import type { Store, UserRole, AutoIterExecutionStatus, AutoIterActionType, AIProfileRole, AIProfileStatus } from '../../store'
import type { AutoIterationService } from '../../agent/autoIteration'
import type { AdvisorScheduler } from '../../agent/advisorScheduler'
import type { AdvisorService } from '../../agent/advisorService'

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

// ==================== 自动迭代相关 Schema ====================

const executionPolicySchema = z.enum([
    'auto_execute', 'notify_then_execute', 'require_confirm', 'always_manual', 'disabled'
])

const actionTypeSchema = z.enum([
    'format_code', 'fix_lint', 'add_comments', 'run_tests',
    'fix_type_errors', 'update_deps', 'refactor', 'optimize',
    'edit_config', 'create_file', 'delete_file',
    'git_commit', 'git_push', 'deploy', 'custom'
])

const notificationLevelSchema = z.enum(['all', 'errors_only', 'none'])

const updateAutoIterationConfigSchema = z.object({
    enabled: z.boolean().optional(),
    policy: z.record(actionTypeSchema, executionPolicySchema).optional(),
    allowedProjects: z.array(z.string()).optional(),
    notificationLevel: notificationLevelSchema.optional(),
    keepLogsDays: z.number().min(1).max(365).optional()
})

const autoIterationLogsQuerySchema = z.object({
    status: z.union([
        z.enum(['pending', 'approved', 'executing', 'completed', 'failed', 'rejected', 'cancelled', 'timeout']),
        z.array(z.enum(['pending', 'approved', 'executing', 'completed', 'failed', 'rejected', 'cancelled', 'timeout']))
    ]).optional(),
    actionType: actionTypeSchema.optional(),
    projectPath: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).optional(),
    offset: z.coerce.number().min(0).optional()
})

// ==================== AI 员工档案 Schema ====================

const aiProfileRoleSchema = z.enum(['developer', 'architect', 'reviewer', 'pm', 'tester', 'devops'])
const aiProfileStatusSchema = z.enum(['idle', 'working', 'resting'])

const createAIProfileSchema = z.object({
    name: z.string().min(1).max(50),
    role: aiProfileRoleSchema,
    specialties: z.array(z.string()).max(10).default([]),
    personality: z.string().max(500).nullable().optional(),
    greetingTemplate: z.string().max(500).nullable().optional(),
    preferredProjects: z.array(z.string()).max(20).default([]),
    workStyle: z.string().max(500).nullable().optional(),
    avatarEmoji: z.string().max(10).default('🤖')
})

const updateAIProfileSchema = z.object({
    name: z.string().min(1).max(50).optional(),
    role: aiProfileRoleSchema.optional(),
    specialties: z.array(z.string()).max(10).optional(),
    personality: z.string().max(500).nullable().optional(),
    greetingTemplate: z.string().max(500).nullable().optional(),
    preferredProjects: z.array(z.string()).max(20).optional(),
    workStyle: z.string().max(500).nullable().optional(),
    avatarEmoji: z.string().max(10).optional(),
    status: aiProfileStatusSchema.optional()
})

export function createSettingsRoutes(
    store: Store,
    autoIterationService?: AutoIterationService,
    getAdvisorScheduler?: () => AdvisorScheduler | null,
    getAdvisorService?: () => AdvisorService | null
): Hono<WebAppEnv> {
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

    // ==================== 自动迭代管理 ====================

    // 获取自动迭代配置
    app.get('/settings/auto-iteration', (c) => {
        if (!autoIterationService) {
            return c.json({ error: 'AutoIteration service not available' }, 503)
        }

        const config = autoIterationService.getConfig()
        const policySummary = autoIterationService.getPolicySummary()
        const stats = autoIterationService.getStats()

        return c.json({
            config,
            policySummary,
            stats
        })
    })

    // 更新自动迭代配置
    app.put('/settings/auto-iteration', async (c) => {
        if (!autoIterationService) {
            return c.json({ error: 'AutoIteration service not available' }, 503)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = updateAutoIterationConfigSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid config data', details: parsed.error.issues }, 400)
        }

        const userId = c.get('userId')
        const config = await autoIterationService.updateConfig({
            ...parsed.data,
            updatedBy: String(userId)
        })

        return c.json({ ok: true, config })
    })

    // 启用自动迭代
    app.post('/settings/auto-iteration/enable', async (c) => {
        if (!autoIterationService) {
            return c.json({ error: 'AutoIteration service not available' }, 503)
        }

        const userId = c.get('userId')
        await autoIterationService.enable(String(userId))

        return c.json({ ok: true, enabled: true })
    })

    // 禁用自动迭代
    app.post('/settings/auto-iteration/disable', async (c) => {
        if (!autoIterationService) {
            return c.json({ error: 'AutoIteration service not available' }, 503)
        }

        const userId = c.get('userId')
        await autoIterationService.disable(String(userId))

        return c.json({ ok: true, enabled: false })
    })

    // 获取执行日志
    app.get('/settings/auto-iteration/logs', (c) => {
        if (!autoIterationService) {
            return c.json({ error: 'AutoIteration service not available' }, 503)
        }

        const query = c.req.query()
        const parsed = autoIterationLogsQuerySchema.safeParse(query)

        const filters = parsed.success ? {
            status: parsed.data.status as AutoIterExecutionStatus | AutoIterExecutionStatus[] | undefined,
            actionType: parsed.data.actionType as AutoIterActionType | undefined,
            projectPath: parsed.data.projectPath,
            limit: parsed.data.limit ?? 50,
            offset: parsed.data.offset ?? 0
        } : { limit: 50, offset: 0 }

        const logs = autoIterationService.getLogs(filters)

        return c.json({ logs })
    })

    // 获取单条日志
    app.get('/settings/auto-iteration/logs/:id', (c) => {
        if (!autoIterationService) {
            return c.json({ error: 'AutoIteration service not available' }, 503)
        }

        const id = c.req.param('id')
        const log = autoIterationService.getLog(id)

        if (!log) {
            return c.json({ error: 'Log not found' }, 404)
        }

        return c.json({ log })
    })

    // 批准操作
    app.post('/settings/auto-iteration/logs/:id/approve', (c) => {
        if (!autoIterationService) {
            return c.json({ error: 'AutoIteration service not available' }, 503)
        }

        const id = c.req.param('id')
        const userId = c.get('userId')
        const success = autoIterationService.handleApproval(id, true, String(userId))

        if (!success) {
            return c.json({ error: 'No pending approval found or already processed' }, 400)
        }

        return c.json({ ok: true })
    })

    // 拒绝操作
    app.post('/settings/auto-iteration/logs/:id/reject', (c) => {
        if (!autoIterationService) {
            return c.json({ error: 'AutoIteration service not available' }, 503)
        }

        const id = c.req.param('id')
        const userId = c.get('userId')
        const success = autoIterationService.handleApproval(id, false, String(userId))

        if (!success) {
            return c.json({ error: 'No pending approval found or already processed' }, 400)
        }

        return c.json({ ok: true })
    })

    // 回滚操作
    app.post('/settings/auto-iteration/logs/:id/rollback', async (c) => {
        if (!autoIterationService) {
            return c.json({ error: 'AutoIteration service not available' }, 503)
        }

        const id = c.req.param('id')
        const success = await autoIterationService.rollback(id)

        if (!success) {
            return c.json({ error: 'Rollback failed or not available' }, 400)
        }

        return c.json({ ok: true })
    })

    // 获取待处理审批
    app.get('/settings/auto-iteration/pending', (c) => {
        if (!autoIterationService) {
            return c.json({ error: 'AutoIteration service not available' }, 503)
        }

        const pending = autoIterationService.getPendingApprovals()

        return c.json({ pending })
    })

    // ==================== Advisor 审查 ====================

    // 手动触发审查
    app.post('/settings/advisor/trigger-review', async (c) => {
        const advisorScheduler = getAdvisorScheduler?.()
        if (!advisorScheduler) {
            return c.json({ error: 'AdvisorScheduler not available' }, 503)
        }

        const json = await c.req.json().catch(() => ({})) as { type?: string }
        const reviewType = json.type === 'daily' ? 'daily' : 'proactive'

        await advisorScheduler.manualTriggerReview(reviewType)

        return c.json({ ok: true, type: reviewType })
    })

    // 获取待处理的建议
    app.get('/settings/advisor/suggestions', (c) => {
        const advisorService = getAdvisorService?.()
        if (!advisorService) {
            return c.json({ error: 'AdvisorService not available' }, 503)
        }

        const suggestions = advisorService.getPendingSuggestions()
        return c.json({ suggestions })
    })

    // 接受建议
    app.post('/settings/advisor/suggestions/:id/accept', async (c) => {
        const advisorService = getAdvisorService?.()
        if (!advisorService) {
            return c.json({ error: 'AdvisorService not available' }, 503)
        }

        const id = c.req.param('id')
        const userId = c.get('userId')

        const result = await advisorService.acceptSuggestion(id, String(userId))

        if (!result.success) {
            return c.json({ error: result.error }, 404)
        }

        return c.json({ ok: true, actionTriggered: result.actionTriggered })
    })

    // 拒绝建议
    app.post('/settings/advisor/suggestions/:id/reject', async (c) => {
        const advisorService = getAdvisorService?.()
        if (!advisorService) {
            return c.json({ error: 'AdvisorService not available' }, 503)
        }

        const id = c.req.param('id')
        const userId = c.get('userId')
        const json = await c.req.json().catch(() => ({})) as { reason?: string }

        const result = await advisorService.rejectSuggestion(id, String(userId), json.reason)

        if (!result.success) {
            return c.json({ error: result.error }, 404)
        }

        return c.json({ ok: true })
    })

    // ==================== AI 员工档案管理 ====================

    // 获取所有 AI 员工档案
    app.get('/settings/ai-profiles', (c) => {
        const namespace = c.get('namespace')
        const profiles = store.getAIProfiles(namespace)
        return c.json({ profiles })
    })

    // 获取单个 AI 员工档案
    app.get('/settings/ai-profiles/:id', (c) => {
        const id = c.req.param('id')
        const profile = store.getAIProfile(id)

        if (!profile) {
            return c.json({ error: 'Profile not found' }, 404)
        }

        return c.json({ profile })
    })

    // 创建 AI 员工档案
    app.post('/settings/ai-profiles', async (c) => {
        const namespace = c.get('namespace')
        const json = await c.req.json()
        const parsed = createAIProfileSchema.safeParse(json)

        if (!parsed.success) {
            return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)
        }

        const data = parsed.data
        const profile = store.createAIProfile(namespace, {
            name: data.name,
            role: data.role as AIProfileRole,
            specialties: data.specialties,
            personality: data.personality ?? null,
            greetingTemplate: data.greetingTemplate ?? null,
            preferredProjects: data.preferredProjects,
            workStyle: data.workStyle ?? null,
            avatarEmoji: data.avatarEmoji,
            status: 'idle' as AIProfileStatus,
            stats: { tasksCompleted: 0, activeMinutes: 0, lastActiveAt: null }
        })

        return c.json({ profile }, 201)
    })

    // 更新 AI 员工档案
    app.patch('/settings/ai-profiles/:id', async (c) => {
        const id = c.req.param('id')
        const json = await c.req.json()
        const parsed = updateAIProfileSchema.safeParse(json)

        if (!parsed.success) {
            return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)
        }

        const profile = store.updateAIProfile(id, parsed.data)

        if (!profile) {
            return c.json({ error: 'Profile not found' }, 404)
        }

        return c.json({ profile })
    })

    // 删除 AI 员工档案
    app.delete('/settings/ai-profiles/:id', (c) => {
        const id = c.req.param('id')
        const deleted = store.deleteAIProfile(id)

        if (!deleted) {
            return c.json({ error: 'Profile not found' }, 404)
        }

        return c.json({ ok: true })
    })

    return app
}
