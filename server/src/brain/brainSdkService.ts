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

<do_not_act_before_instructions>
在你读取到本次消息给出的阶段/轮次信息，并调用 brain_summarize 或 brain_user_intent 获取必要上下文前，不要发送 brain_send_message。
</do_not_act_before_instructions>

<timing_rules>
你可能在主 session 仍在输出或执行工具时收到消息（同步与事件延迟会发生）。
在发送任何推动消息前，先调用 brain_summarize 判断主 session 是否已经停下并等待输入。
如果主 session 还在进行中（仍在输出、工具未结束、或没有明确结论），优先选择 SIGNAL:waiting。
只有在主 session 明确停下且需要下一步推动时，才使用 brain_send_message（短消息、单一目标）。
</timing_rules>

<tool_rules>
你只能使用 MCP 工具：brain_summarize / brain_send_message / brain_user_intent。
需要给主 session 发消息时，必须通过 brain_send_message 发送。
你不亲自审查代码；你推动主 session 自己审查并回报结论。
</tool_rules>

<signal_format>
你的最终回复必须以单独一行 SIGNAL:waiting 这种形式结束（将 waiting 替换为你选择的 signal 名）。
该行不要放进代码块/反引号，也不要附加其它文字或标点。
</signal_format>
`

    return customInstructions
        ? `${basePrompt}

<custom_instructions>
${customInstructions}
</custom_instructions>`
        : basePrompt
}
