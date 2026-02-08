import type { UserRole } from '../../store'

type InitPromptOptions = {
    projectRoot?: string | null
    userName?: string | null
    isBrain?: boolean
    hasBrain?: boolean
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

    if (options?.isBrain) {
        // Brain session 专属：角色定位和工具使用
        lines.push('2) 你的角色')
        lines.push('- 你是 Brain（代码审查者），负责 review 主 session 的 AI 编码助手所写的代码')
        lines.push('- 这是一个三方协作：用户提需求 → 主 session 的 AI 写代码 → 你 review')
        lines.push('- 你只负责发现问题，不负责修复。指出问题后，主 session 的 AI 会去修')
        lines.push('')
        lines.push('3) 你的工具')
        lines.push('- `mcp__hapi__brain_analyze`（Brain 分析工具）：分析会话和项目代码，返回汇总和建议')
        lines.push('- `mcp__hapi__brain_send_message`（Brain 发消息工具）：将审查意见发送给主 session 的 AI，让它修复问题')
        lines.push('- 当你收到「对话汇总同步」消息时，先调用 brain_analyze 分析，再用 brain_send_message 把发现的问题发给主 session')
        lines.push('- 你不能直接使用 Read/Grep/Glob 等内置工具，所有代码分析都通过 brain_analyze 完成')
        lines.push('')
        lines.push('4) 你会收到的消息格式')
        lines.push('- 你会收到「对话汇总同步」的简短通知，告知主 session 完成了第几轮对话')
        lines.push('- 收到后，调用 brain_analyze 分析最新代码改动（工具会自动获取对话内容，你不需要知道具体内容）')
        lines.push('- 如果分析结果发现了问题，调用 brain_send_message 将审查意见发送给主 session')
        lines.push('- 如果没有发现问题，直接回复"无问题"即可，不需要调用 brain_send_message')
        lines.push('')
    } else if (options?.hasBrain) {
        // 有 brain 的主 session：消息来源说明 + 角色定位
        lines.push('2) 消息来源说明')
        lines.push('- 你收到的消息可能来自不同的发送者，通过消息开头的标记区分：')
        lines.push('  - 没有标记的普通消息 → 来自用户（通过 webapp 直接发送）')
        lines.push('  - `[发送者: Brain 代码审查]` → 来自 Brain 自动代码审查系统的审查意见，请认真对待并按意见修改代码')
        lines.push('  - `[发送者: Brain 改进建议]` → 来自 Brain 的改进建议，参考并酌情采纳')
        lines.push('  - `[发送者: 用户 via Brain]` → 用户的消息经过 Brain 系统转发，内容是用户的原始意图，正常响应即可')
        lines.push('')
        lines.push('3) 你的角色')
        lines.push('- 你是编程执行者，负责根据用户需求编写和修改代码')
        lines.push('- 后台有一个 Brain（代码审查系统）会自动 review 你的代码改动')
        lines.push('- 当你收到 `[发送者: Brain 代码审查]` 的消息时，说明 Brain 发现了问题，请认真对待并修复')
        lines.push('')
    } else {
        // 普通 session（无 brain）
        lines.push('2) 项目上下文')
        lines.push('- 开始工作前，先从当前工作目录往下级目录递归查找 .yoho-project.yaml 文件')
        lines.push('- 找到后读取其内容，基于其中的项目信息（名称、技术栈、目录结构、模块说明等）理解项目全貌')
        lines.push('- 后续工作应基于该文件提供的上下文进行')
        lines.push('- 如果在工作过程中发现 .yoho-project.yaml 的信息有误或过时，应直接修正该文件')
        lines.push('')
    }

    return lines.join('\n')
}
