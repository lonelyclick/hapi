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

/** 所有有效的 BrainSignal 值 */
const VALID_SIGNALS = new Set<string>([
    'ai_reply_done', 'has_issue', 'no_issue', 'ai_question',
    'lint_pass', 'lint_fail', 'test_pass', 'test_fail',
    'commit_ok', 'commit_fail', 'deploy_ok', 'dev_complete',
    'deploy_fail', 'waiting', 'user_message', 'skip',
])

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

**核心原则：你看不到代码，所有检查必须 push 给主 session 执行。每次只 push 一个维度，等它做完再 push 下一个。不要一次性列一堆检查项。**

## 你的任务

调用 brain_summarize 后，根据对话内容判断当前状态：

1. **AI 在等用户回答问题** → 替用户做决策，用 brain_send_message(type=info) 发送决策，返回 waiting

2. **AI 还在写代码/调试** → 不要打断，返回 waiting

3. **AI 刚完成代码修改** → 开始分轮 push 自查。每次只 push 一个角度，用 brain_send_message(type=info) 发送，然后返回 has_issue 等主 session 执行完。角度包括但不限于（根据改动灵活选择，用你自己的话说，不要照搬模板）：
   - 需求对照：让主 session 回顾用户原始需求，逐条列出是否实现
   - 前后端适配：如果改了接口，让主 session 检查前后端是否对齐
   - 边界情况：让主 session 检查空值、异常路径等
   - 半成品搜索：让主 session 用 Grep 搜索 TODO、placeholder、硬编码
   - 依赖检查：让主 session 用 Grep 搜索被修改函数的调用方
   - 错误处理：让主 session 检查新增的异步操作是否有异常处理

4. **主 session 刚完成了你上一轮 push 的检查** → 看它的报告：
   - 如果发现了问题但还没修 → 让它修，返回 has_issue
   - 如果发现了问题并已修 → 继续 push 下一个检查角度，返回 has_issue
   - 如果这个角度没问题 → 继续 push 下一个检查角度，返回 has_issue
   - 如果所有角度都已检查完毕（至少 3 个角度） → 返回 dev_complete

**关键：每次返回 has_issue 推一个新角度，而不是一次性全推。这样能确保每个角度都被认真对待。用你自己的语言组织指令，根据具体改动内容灵活调整检查重点。**`,

    reviewing: `代码审查阶段。调用 brain_summarize 获取最新对话内容。

**核心原则：你看不到代码，所有审查必须 push 给主 session 执行。每次只 push 一个审查角度，等它做完再 push 下一个。只要上一轮审查还发现了问题，就继续推下一轮，不要停。最多 10 轮。**

## 你的任务

调用 brain_summarize 后，根据对话内容判断当前状态：

1. **AI 在等用户回答问题** → 替用户做决策，用 brain_send_message(type=info) 发送决策，返回 ai_question

2. **主 session 还没有开始审查，或者刚完成上一轮且上一轮有问题** → 用 brain_send_message(type=info) push 下一个审查角度。角度包括但不限于（根据改动灵活选择，用你自己的话说）：
   - 功能正确性：让主 session 逐个检查实现逻辑是否和需求一致
   - 边界情况：让主 session 检查空值、异常路径、并发
   - 类型安全：让主 session 检查 TypeScript 类型是否正确
   - 安全性：让主 session 检查注入、XSS、敏感信息泄露
   - 性能：让主 session 检查不必要的循环、N+1 查询、内存泄漏
   - 可读性：让主 session 检查命名、结构是否清晰
   - 回归风险：让主 session 检查改动是否可能破坏已有功能
   然后返回 has_issue

3. **主 session 完成了审查且本轮没有发现新问题** → 判断是否已审查了足够多的角度（至少 3 个角度）：
   - 还不够 → 继续 push 下一个角度，返回 has_issue
   - 够了 → 返回 no_issue

**关键：每次只推一个角度。只要还有问题就继续。用你自己的语言描述，根据这个项目的具体改动灵活调整审查重点，不要生搬硬套。**`,

    linting: `代码检查（lint）阶段。调用 brain_summarize 获取最新对话内容。

**核心原则：你看不到代码，所有操作 push 给主 session 执行。**

## 你的任务

调用 brain_summarize 后，根据对话内容判断当前状态：

1. **主 session 还没有执行 lint** → 用 brain_send_message(type=info) 让主 session 去执行。用你自己的话告诉它运行项目的 lint 命令并报告完整结果。返回 waiting

2. **主 session 报告 lint 通过** → 返回 lint_pass

3. **主 session 报告 lint 失败** → 用 brain_send_message(type=info) 让主 session 修复 lint 错误并重新运行。返回 lint_fail`,

    testing: `测试阶段。调用 brain_summarize 获取最新对话内容。

**核心原则：你看不到代码，所有操作 push 给主 session 执行。测试要多轮推进，确保覆盖充分。**

## 你的任务

调用 brain_summarize 后，根据对话内容判断当前状态：

1. **主 session 还没有执行测试** → 用 brain_send_message(type=info) 让主 session 运行项目的测试命令并报告完整结果。返回 waiting

2. **主 session 报告测试通过，但还没有做过额外验证** → 继续 push 下一轮验证，比如（根据改动灵活选择，用你自己的话说）：
   - 让主 session 手动验证关键功能路径（用 curl 或类似方式测试 API）
   - 让主 session 检查是否有未覆盖的边界场景需要补测试
   - 让主 session 检查改动是否影响了其他模块的测试
   返回 test_fail（推回 developing 让它做额外验证）

3. **主 session 已经完成多轮验证（至少跑过测试 + 做过一次额外验证）** → 返回 test_pass

4. **主 session 报告测试失败** → 用 brain_send_message(type=info) 让主 session 修复失败的测试并重新运行。返回 test_fail`,

    committing: `当前阶段是提交代码。调用 brain_summarize 获取最新对话内容。

**你的任务是推动主 session 提交代码，并根据对话中主 session 报告的结果判断。**

### 情况 1：主 session 还没有提交代码
→ 用 brain_send_message(type=info) 发送指令：

\`\`\`
请提交代码。commit message 要清晰描述改动内容。
\`\`\`
然后返回 waiting

### 情况 2：主 session 报告提交成功
→ 返回 commit_ok

### 情况 3：主 session 报告提交失败（pre-commit hook 失败、冲突等）
→ 用 brain_send_message(type=info) 告诉主 session 修复问题后重新提交，然后返回 commit_fail`,

    deploying: `当前阶段是部署。调用 brain_summarize 获取最新对话内容。

**你的任务是推动主 session 执行部署，并根据对话中主 session 报告的结果判断。**

### 情况 1：主 session 还没有执行部署
→ 用 brain_send_message(type=info) 发送指令：

\`\`\`
请执行部署（如 git push origin main 或项目配置的部署命令），然后告诉我执行结果。
\`\`\`
然后返回 waiting

### 情况 2：主 session 报告部署成功
→ 返回 deploy_ok

### 情况 3：主 session 报告部署失败
→ 用 brain_send_message(type=info) 告诉主 session 检查并修复部署问题，然后返回 deploy_fail`,

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
    console.log('[StatePrompts] buildStateReviewPrompt:', {
        state: currentState,
        allowedSignals: allowed.join(','),
        rounds: roundNumbers.join(','),
        retries: JSON.stringify(stateContext.retries),
        lastSignal: stateContext.lastSignal ?? 'none',
    })

    return `## 当前任务阶段: ${STATE_LABELS[currentState]}

## 完整流程
${renderPipeline(currentState)}

## 新完成的对话轮次: 第 ${roundNumbers.join(', ')} 轮
${retryInfo}
## 你现在该做什么
${STATE_INSTRUCTIONS[currentState]}

## 边界约束
你通过 brain_send_message 发给主 session 的每条指令末尾，都必须附加以下约束（用你自己的话说，但意思不能变）：
「只执行上述指令，完成后立即停下。不要自行推进下一步（如运行测试、提交代码、部署等），等待后续指令。」

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
    console.log('[StatePrompts] buildRefinePrompt: state=', currentState, 'label=', STATE_LABELS[currentState])
    return `用户消息转发：用户发送了新消息。当前阶段: ${STATE_LABELS[currentState]}

请执行：
1) 调用 brain_user_intent 获取用户原始消息
2) 分析用户意图的合理性，结合当前处于「${STATE_LABELS[currentState]}」阶段
3) 如果用户想跳过当前阶段（如"别测了""直接提交""先不部署"），在回复末尾写 SIGNAL:skip
4) 如果用户在补充需求或修改方向，整合为清晰指令，用 brain_send_message(type=info) 发给主 session，然后写 SIGNAL:ai_reply_done
5) 其他情况正常改写转发，用 brain_send_message(type=info) 发送，然后写 SIGNAL:waiting

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
    const lastLines = lines.slice(Math.max(0, lines.length - 5))
    console.log('[StatePrompts] parseSignal: scanning last', lastLines.length, 'lines:', lastLines.map(l => l.trim()).join(' | '))
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
        const match = lines[i].match(/SIGNAL:\s*(\S+)/i)
        if (match) {
            const signal = match[1]
            if (!VALID_SIGNALS.has(signal)) {
                console.log('[StatePrompts] parseSignal: INVALID signal:', signal, 'at line', i, '- ignoring')
                continue
            }
            console.log('[StatePrompts] parseSignal: found valid signal:', signal, 'at line', i)
            return signal as BrainSignal
        }
    }
    console.log('[StatePrompts] parseSignal: no valid signal found in text (length:', text.length, ', total lines:', lines.length, ')')
    return null
}

/** 构建重试信息提示 */
function buildRetryInfo(state: BrainMachineState, ctx: BrainStateContext): string {
    const retryKey = state as keyof typeof ctx.retries
    const count = ctx.retries[retryKey]
    if (!count || count === 0) return ''

    const maxRetries: Record<string, number> = {
        developing: 8, reviewing: 10, linting: 3, testing: 5, committing: 2, deploying: 2,
    }
    const max = maxRetries[retryKey]
    if (!max) return ''

    return `\n## 重试信息\n当前已重试 ${count}/${max} 次。${count >= max - 1 ? '⚠️ 即将达到上限，下次将强制推进到下一步。' : ''}\n`
}
