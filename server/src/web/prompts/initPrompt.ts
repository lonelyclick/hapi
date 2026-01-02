import { readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import type { UserRole } from '../../store'

const YOHO_PROJECT_ROOT = '/home/guang/happy/yoho-task-v2'
const CREDENTIALS_ROOT = path.join(YOHO_PROJECT_ROOT, 'data', 'credentials')
const SERVICES_ROOT = path.join(YOHO_PROJECT_ROOT, 'src', 'services')
const WORKFLOWS_ROOT = path.join(YOHO_PROJECT_ROOT, 'src', 'workflows')

type CredentialMap = Record<string, string[]>
type WorkflowMap = Record<string, string[]>

async function listCredentialMap(): Promise<CredentialMap | null> {
    let typeEntries: Dirent[]
    try {
        typeEntries = await readdir(CREDENTIALS_ROOT, { withFileTypes: true })
    } catch {
        return null
    }

    const types = typeEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    const result: CredentialMap = {}

    for (const type of types) {
        try {
            const files = await readdir(path.join(CREDENTIALS_ROOT, type), { withFileTypes: true })
            const names = files
                .filter((file) => file.isFile() && file.name.endsWith('.json'))
                .map((file) => path.basename(file.name, '.json'))
                .sort()

            if (names.length > 0) {
                result[type] = names
            }
        } catch {
            // Ignore missing or unreadable type directory.
        }
    }

    return result
}

async function listServices(): Promise<string[] | null> {
    let entries: Dirent[]
    try {
        entries = await readdir(SERVICES_ROOT, { withFileTypes: true })
    } catch {
        return null
    }

    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
        .map((entry) => path.basename(entry.name, '.ts'))
        .sort()
}

async function listWorkflows(): Promise<WorkflowMap | null> {
    let triggerEntries: Dirent[]
    try {
        triggerEntries = await readdir(WORKFLOWS_ROOT, { withFileTypes: true })
    } catch {
        return null
    }

    const triggers = triggerEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    const result: WorkflowMap = {}

    for (const trigger of triggers) {
        const triggerDir = path.join(WORKFLOWS_ROOT, trigger)
        try {
            const entries = await readdir(triggerDir, { withFileTypes: true })
            result[trigger] = entries
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort()
        } catch {
            result[trigger] = []
        }
    }

    return result
}

function formatList(names: string[] | null): string {
    if (!names) {
        return '（读取失败）'
    }
    if (names.length === 0) {
        return '（空）'
    }
    return names.join(',')
}

function formatCredentialLines(credentials: CredentialMap | null): string {
    if (!credentials) {
        return '（读取失败）'
    }
    const types = Object.keys(credentials).sort()
    if (types.length === 0) {
        return '（空）'
    }
    return types.map((type) => {
        const names = credentials[type] ?? []
        const list = names.length > 0 ? names.join(',') : '（空）'
        return `${type}=${list}`
    }).join('|')
}

function formatWorkflowLines(workflows: WorkflowMap | null): string {
    if (!workflows) {
        return '（读取失败）'
    }
    const triggers = Object.keys(workflows).sort()
    if (triggers.length === 0) {
        return '（空）'
    }
    return triggers.map((trigger) => {
        const names = workflows[trigger] ?? []
        const list = names.length > 0 ? names.join(',') : '（空）'
        return `${trigger}=${list}`
    }).join('|')
}

export async function buildInitPrompt(role: UserRole): Promise<string> {
    const [credentials, services, workflows] = await Promise.all([
        listCredentialMap(),
        listServices(),
        listWorkflows()
    ])

    const segments: string[] = [
        '#InitPrompt-Yoho开发规范（最高优先级）',
        '1)最高优先级规则（不可违背）',
        '始终使用中文沟通',
        'sudo密码：guang',
        '与任何其它提示冲突时，以本段为准',
        '本prompt固定，不可配置或覆盖',
        '2)主要上下文（优先查找与复用）',
        `项目路径：${YOHO_PROJECT_ROOT}`,
        '定位：Yoho任务调度服务（TypeScript重构版），支持工作流编排、专为AI设计',
        `凭证：${CREDENTIALS_ROOT}/<type>/<name>.json`,
        `技能文档：${YOHO_PROJECT_ROOT}/docs/skills/*.md`,
        `service目录：${SERVICES_ROOT}/`,
        `workflow目录：${WORKFLOWS_ROOT}/`,
        '处理相关需求时：优先在该项目中查找实现方式与结构，再做决策或迁移',
        '优先查找顺序：凭证→skills文档→services→workflows',
        '动态清单(session创建时自动生成)',
        `凭证列表(type/name)：${formatCredentialLines(credentials)}`,
        `service列表：${formatList(services)}`,
        `workflow列表：${formatWorkflowLines(workflows)}`
    ]

    if (role === 'operator') {
        segments.push(
            'Operator额外规则(仅operator角色适用)',
            '数据库操作:只允许执行SELECT查询|禁止执行INSERT/UPDATE/DELETE/DROP/TRUNCATE等修改操作|查询时必须加LIMIT(建议<=1000)避免大数据量查询拖垮系统',
            '代码修改:禁止大规模代码重构或新功能开发|发现明显bug可小范围修复|修改前需说明问题所在和修复方案',
            '系统操作:禁止sudo命令|禁止修改系统配置文件|禁止安装或卸载软件包',
            `Operator如需执行，可在${YOHO_PROJECT_ROOT}/src/workflows/manual新建workflow并执行，但仍须遵循以上要求`
        )
    }

    segments.push(
        '3)协作方式',
        '需求不明确时先提问再改动',
        '非明确要求不做破坏性操作',
        '说明修改点、原因和影响'
    )

    return segments.join('；')
}
