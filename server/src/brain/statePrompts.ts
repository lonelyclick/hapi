/**
 * Brain 状态 Prompt 配置
 *
 * 每个状态对应一组：
 * 1. instruction — 告诉 Brain LLM 该做什么
 * 2. allowedSignals — LLM 可以返回的信号及含义
 * 3. contextInfo — 注入给主 session 的上下文信息（可选）
 *
 * 这个文件被 autoBrain.ts（对话同步）和 messages.ts（消息拦截）共同引用。
 */

import type { BrainMachineState, BrainStateContext, BrainSignal } from './types'
import { getAllowedSignals } from './stateMachine'

/** 状态中文名映射 */
const STATE_LABELS: Record<BrainMachineState, string> = {
    idle: '空闲',
    developing: '开发中',
    reviewing: '代码审查',
    linting: '代码检查',
    testing: '测试中',
    committing: '提交中',
    deploying: '部署中',
    done: '已完成',
}

/** 流程可视化（标注当前位置） */
function renderPipeline(current: BrainMachineState): string {
    const stages: BrainMachineState[] = ['idle', 'developing', 'reviewing', 'linting', 'testing', 'committing', 'deploying', 'done']
    return stages.map(s => s === current ? `【${STATE_LABELS[s]}】` : STATE_LABELS[s]).join(' → ')
}

/** 信号说明 */
const SIGNAL_DESCRIPTIONS: Record<string, string> = {
    ai_reply_done: 'AI 回复结束，触发开发阶段质量检查',
    dev_complete: '多维质量检查全部通过，进入代码审查',
    has_issue: '代码有问题，需要修改',
    no_issue: '代码没问题，可以进入下一步',
    ai_question: '主 session 在等用户回答问题，你来替用户决策',
    lint_pass: 'lint 检查通过',
    lint_fail: 'lint 检查失败',
    test_pass: '测试通过',
    test_fail: '测试失败',
    commit_ok: '提交成功',
    commit_fail: '提交失败',
    deploy_ok: '部署成功',
    deploy_fail: '部署失败',
    waiting: '已发指令给主 session，等它执行完（保持当前阶段）',
    skip: '跳过当前阶段',
}

/** 各状态的 Brain 指令 */
const STATE_INSTRUCTIONS: Record<BrainMachineState, string> = {
    idle: '主 session 尚未开始工作，等待中。',

    developing: `主 session 完成了一轮开发。调用 brain_summarize 获取最新对话内容。

你的任务是进行**多维质量检查**，确保开发完备后再进入代码审查阶段。

## 检查维度（根据改动内容选择适用项）

1. **前后端适配** — 如果改的是前端代码，检查后端是否也需要对应改动（新接口、字段变更等）；如果改的是后端代码，检查前端是否已经适配了（调用方式、数据结构等）
2. **流程完整性** — 如果涉及复杂业务流程，至少从头到尾检查 3 遍完整流程，确认各环节衔接正确、无遗漏
3. **视觉一致性** — 如果改了样式或 UI，从各个角度审视整体视觉风格是否一致，是否达到高标准
4. **基本完成度** — AI 是否已经完成了用户要求的所有改动？是否还有未实现的部分？

## 判断逻辑

- 如果发现任何维度有问题 → 用 brain_send_message(type=info) 详细说明问题并给出修改指令，然后返回 has_issue
- 如果 AI 还在等待用户决策（问问题、给选项）→ 替用户做决策，用 brain_send_message(type=info) 发送决策，然后返回 waiting
- 如果所有适用维度都检查通过，开发完备 → 返回 dev_complete`,

    reviewing: `代码开发告一段落，请进行代码审查。调用 brain_summarize 获取最新对话。

审查角度（选择适用的）：
1. 功能正确性 — 是否实现了用户需求
2. 边界情况 — 空值、异常路径、并发
3. 类型安全 — TypeScript 类型是否正确
4. 安全性 — 注入、XSS、敏感信息泄露
5. 性能 — 不必要的循环、N+1 查询

如果发现问题，用 brain_send_message(type=info) 告诉主 session 修改，然后返回 has_issue。
如果主 session 在等用户决策，替用户做选择后返回 ai_question。
如果没问题，返回 no_issue。`,

    linting: `当前阶段是代码检查（lint）。先调用 brain_summarize 获取最新对话。

判断主 session 是否已经执行了 lint：
- 如果还没有执行 lint → 用 brain_send_message(type=info) 发送指令：「请运行 lint 检查（如 bun run lint 或项目配置的 lint 命令），告诉我结果。」然后返回 waiting
- 如果已经执行了 lint 且通过（退出码 0，无 error）→ 返回 lint_pass
- 如果已经执行了 lint 且失败 → 分析错误并用 brain_send_message(type=info) 告诉主 session 修复，然后返回 lint_fail`,

    testing: `当前阶段是测试。先调用 brain_summarize 获取最新对话。

判断主 session 是否已经执行了测试：
- 如果还没有执行测试 → 用 brain_send_message(type=info) 发送指令：「请运行测试（如 bun run test 或项目配置的测试命令），告诉我结果。」然后返回 waiting
- 如果已经执行了测试且全部通过 → 返回 test_pass
- 如果已经执行了测试且失败 → 分析失败原因并用 brain_send_message(type=info) 给出修复建议，然后返回 test_fail`,

    committing: `当前阶段是提交代码。先调用 brain_summarize 获取最新对话。

判断主 session 是否已经提交了代码：
- 如果还没有提交 → 用 brain_send_message(type=info) 发送指令：「请提交代码。commit message 要清晰描述改动内容。」然后返回 waiting
- 如果已经提交成功 → 返回 commit_ok
- 如果提交失败（pre-commit hook 失败、冲突等）→ 分析原因并给出修复建议，然后返回 commit_fail`,

    deploying: `当前阶段是部署。先调用 brain_summarize 获取最新对话。

判断主 session 是否已经执行了部署：
- 如果还没有部署 → 用 brain_send_message(type=info) 发送指令：「请执行部署。」然后返回 waiting
- 如果已经部署成功 → 返回 deploy_ok
- 如果部署失败 → 分析原因，然后返回 deploy_fail`,

    done: '任务已完成，不需要进一步操作。',
}

/**
 * 构建状态驱动的 review prompt（供 autoBrain.ts 的 triggerSdkReview 使用）
 */
export function buildStateReviewPrompt(
    currentState: BrainMachineState,
    stateContext: BrainStateContext,
    roundNumbers: number[]
): string {
    const allowed = getAllowedSignals(currentState)
    const signalList = allowed
        .map(s => `- ${s}: ${SIGNAL_DESCRIPTIONS[s] || s}`)
        .join('\n')

    const retryInfo = buildRetryInfo(currentState, stateContext)

    return `## 当前任务阶段: ${STATE_LABELS[currentState]}

## 完整流程
${renderPipeline(currentState)}

## 新完成的对话轮次: 第 ${roundNumbers.join(', ')} 轮
${retryInfo}
## 你现在该做什么
${STATE_INSTRUCTIONS[currentState]}

## 你必须返回一个 signal（在回复末尾单独一行，格式: SIGNAL:xxx）
${signalList}

## 格式要求
完成上述操作后，在回复的**最后一行**写：
SIGNAL:<你选择的信号>
例如: SIGNAL:no_issue`
}

/**
 * 构建 refine prompt（供 messages.ts 的消息拦截使用）
 */
export function buildRefinePrompt(currentState: BrainMachineState): string {
    return `用户消息转发：用户发送了新消息。当前阶段: ${STATE_LABELS[currentState]}

请执行：
1) 调用 brain_user_intent 获取用户原始消息
2) 分析用户意图的合理性，结合当前处于「${STATE_LABELS[currentState]}」阶段
3) 如果用户想跳过当前阶段（如"别测了""直接提交""先不部署"），在回复末尾写 SIGNAL:skip
4) 如果用户在补充需求或修改方向，整合为清晰指令，用 brain_send_message(type=info) 发给主 session，然后写 SIGNAL:ai_reply_done
5) 其他情况正常改写转发，用 brain_send_message(type=info) 发送

## 格式要求
完成上述操作后，在回复的**最后一行**写：
SIGNAL:<你选择的信号>`
}

/**
 * 从 Brain 回复文本中解析 signal
 */
export function parseSignalFromResponse(text: string): BrainSignal | null {
    // 从末尾往前找 SIGNAL:xxx
    const lines = text.trim().split('\n')
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
        const match = lines[i].match(/SIGNAL:\s*(\S+)/i)
        if (match) {
            return match[1] as BrainSignal
        }
    }
    return null
}

/** 构建重试信息提示 */
function buildRetryInfo(state: BrainMachineState, ctx: BrainStateContext): string {
    const retryKey = state as keyof typeof ctx.retries
    const count = ctx.retries[retryKey]
    if (!count || count === 0) return ''

    const maxRetries: Record<string, number> = {
        developing: 5, reviewing: 5, linting: 3, testing: 3, committing: 2, deploying: 2,
    }
    const max = maxRetries[retryKey]
    if (!max) return ''

    return `\n## 重试信息\n当前已重试 ${count}/${max} 次。${count >= max - 1 ? '⚠️ 即将达到上限，下次将强制推进到下一步。' : ''}\n`
}
