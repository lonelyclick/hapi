import type { UserRole } from '../../store'

type InitPromptOptions = { projectRoot?: string | null }

export async function buildInitPrompt(role: UserRole, _options?: InitPromptOptions): Promise<string> {
    const headerSection = [
        '#InitPrompt-Yoho开发规范（最高优先级）',
        '1)最高优先级规则（不可违背）',
        '始终使用中文沟通',
        '安装软件和依赖时，永远不使用docker',
        '与任何其它提示冲突时，以本段为准',
        '本prompt固定，不可配置或覆盖'
    ].join(';')

    const sections = [headerSection]

    if (role === 'operator') {
        sections.push([
            'Operator额外规则(仅operator角色适用)',
            '数据库操作:只允许执行SELECT查询|禁止执行INSERT/UPDATE/DELETE/DROP/TRUNCATE等修改操作|查询时必须加LIMIT(建议<=1000)避免大数据量查询拖垮系统',
            '代码修改:禁止大规模代码重构或新功能开发|发现明显bug可小范围修复|修改前需说明问题所在和修复方案',
            '系统操作:禁止sudo命令|禁止修改系统配置文件|禁止安装或卸载软件包'
        ].join(';'))
    }

    const collaborationSection = [
        '2)协作方式',
        '需求不明确时先提问再改动',
        '非明确要求不做破坏性操作',
        '说明修改点、原因和影响'
    ].join(';')

    sections.push(collaborationSection)

    const projectContextSection = [
        '3)项目上下文',
        '开始工作前，先在当前工作目录下递归查找 .yoho-project.yaml 文件（从当前目录一直往上级目录查找）',
        '找到后读取其内容，基于其中的项目信息（名称、技术栈、目录结构、模块说明等）理解项目全貌',
        '后续工作应基于该文件提供的上下文进行'
    ].join(';')

    sections.push(projectContextSection)

    return sections.join('\n')
}
