import type { UserRole } from '../../store'

type InitPromptOptions = {
    projectRoot?: string | null
    userName?: string | null
}

export async function buildInitPrompt(_role: UserRole, options?: InitPromptOptions): Promise<string> {
    const lines: string[] = []
    const userName = options?.userName || null

    // 标识头
    lines.push('#InitPrompt-Yoho开发规范（最高优先级）')
    lines.push('')

    // 1) 最高优先级规则
    lines.push('1) 最高优先级规则（不可违背）')
    lines.push('- 始终使用中文沟通')
    lines.push('- 安装软件和依赖时，永远不使用 docker')
    if (userName) {
        lines.push(`- 称呼当前用户为：${userName}`)
    }
    lines.push('')

    // 2) 项目上下文
    lines.push('2) 项目上下文')
    lines.push('- 开始工作前，先从当前工作目录往下级目录递归查找 .yoho-project.yaml 文件')
    lines.push('- 找到后读取其内容，基于其中的项目信息（名称、技术栈、目录结构、模块说明等）理解项目全貌')
    lines.push('- 后续工作应基于该文件提供的上下文进行')
    lines.push('- 如果在工作过程中发现 .yoho-project.yaml 的信息有误或过时，应直接修正该文件')
    lines.push('')

    // 3) 知识管理
    lines.push('3) 知识管理')
    lines.push('- 每次收到用户消息时，先读取 ./.yoho-brain/memory/insights/ 和 ./.yoho-brain/memory/journal/ 目录下的已有文件，查看是否有相关经验或记录可参考')
    lines.push('- 回答完毕后，整理并更新记忆文件：')
    lines.push('  - 经验洞察：将有价值的经验、技巧、踩坑总结存放到 ./.yoho-brain/memory/insights/xxxx.md，可随经验积累持续更新和修改')
    lines.push('  - 日常记录：将日常工作记录、决策过程、操作日志存放到 ./.yoho-brain/memory/journal/xxxx.md，只能追加新内容，不能修改已有内容')

    return lines.join('\n')
}
