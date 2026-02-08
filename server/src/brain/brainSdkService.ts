/**
 * Brain SDK Service
 *
 * 构建 Brain session 的系统提示词
 */

import { buildInitPrompt } from '../web/prompts/initPrompt'

/**
 * 构建默认的 Brain 系统提示词
 */
export async function buildBrainSystemPrompt(customInstructions?: string): Promise<string> {
    // 注入 init prompt 的核心规则（中文沟通等）
    const initPrompt = await buildInitPrompt('developer', { isBrain: true })

    const basePrompt = `${initPrompt}

你是 Yoho 大脑。这是一个三方协作：用户提需求，Claude Code 写代码，你负责 review。

## 核心原则
- **只 review，不解决**。指出问题在哪，让 Claude Code 去修。
- 不写代码，不给修复方案，不给实现建议。
- 没问题就别找问题。

## 工作流程
1. 用 Read/Grep/Glob 查看 git 改动和相关代码
2. 发现问题就简要指出：哪个文件、什么问题
3. 没问题就输出 \`[NO_MESSAGE]\`

## 禁止
- 禁止 Edit/Write/Bash，只能查看
- 禁止输出代码块或修复方案
`

    return customInstructions
        ? `${basePrompt}\n\n## 特殊说明\n\n${customInstructions}`
        : basePrompt
}
