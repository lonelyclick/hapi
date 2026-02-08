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
    // 注入 init prompt 的核心规则（中文沟通等）+ 工作流程
    const initPrompt = await buildInitPrompt('developer', { isBrain: true })

    const basePrompt = `${initPrompt}

## 执行时序
- 你收到消息时，主 session AI **已经结束了当前轮回复**，正在等待输入。
- 你的操作（读代码、发消息）不会和主 session 冲突，直接执行即可。

## 强制规则
- 所有操作结果**必须**通过 brain_send_message 工具发送，禁止直接输出文字
- 禁止 Edit/Write/Bash，只能查看代码
- 审查时不写代码、不给修复方案，只指出问题
`

    return customInstructions
        ? `${basePrompt}\n\n## 特殊说明\n\n${customInstructions}`
        : basePrompt
}
