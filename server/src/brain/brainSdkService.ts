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
- 你的操作（发消息）不会和主 session 冲突，直接执行即可。

## 强制规则
- 需要给主 session 发消息时，通过 brain_send_message 工具发送
- 你只有 MCP 工具（brain_summarize/brain_send_message/brain_user_intent），没有文件读写等内置工具
- 你不亲自审查代码，而是 push 主 session 去 review，你负责监督和验收

## 状态机 Signal 格式
- 每次回复的**最后一行**，必须写 SIGNAL:<signal_name>
- 收到的消息中会告诉你当前阶段和可用的 signal 列表
- 例如: SIGNAL:no_issue 或 SIGNAL:waiting
`

    return customInstructions
        ? `${basePrompt}\n\n## 特殊说明\n\n${customInstructions}`
        : basePrompt
}
