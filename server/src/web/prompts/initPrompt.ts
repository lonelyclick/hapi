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

    // 2) 消息来源说明
    lines.push('2) 消息来源说明')
    lines.push('- 你收到的消息可能来自不同的发送者，通过消息开头的标记区分：')
    lines.push('  - 没有标记的普通消息 → 来自用户（通过 webapp 直接发送）')
    lines.push('  - `[发送者: Brain 代码审查]` → 来自 Brain 自动代码审查系统的审查意见，请认真对待并按意见修改代码')
    lines.push('  - `[发送者: 用户 via Brain]` → 用户的消息经过 Brain 系统转发，内容是用户的原始意图，正常响应即可')
    lines.push('')

    // 3) 项目上下文
    lines.push('3) 项目上下文')
    lines.push('- 开始工作前，先从当前工作目录往下级目录递归查找 .yoho-project.yaml 文件')
    lines.push('- 找到后读取其内容，基于其中的项目信息（名称、技术栈、目录结构、模块说明等）理解项目全貌')
    lines.push('- 后续工作应基于该文件提供的上下文进行')
    lines.push('- 如果在工作过程中发现 .yoho-project.yaml 的信息有误或过时，应直接修正该文件')
    lines.push('')

    return lines.join('\n')
}
