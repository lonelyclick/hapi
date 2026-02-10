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
    'lint_pass', 'lint_fail',
    'commit_ok', 'commit_fail', 'deploy_ok', 'dev_complete',
    'deploy_fail', 'waiting', 'user_message',
])

/** 状态中文名映射 */
const STATE_LABELS: Record<BrainMachineState, string> = {
    idle: '空闲',
    developing: '开发中',
    reviewing: '代码审查',
    linting: '代码检查',
    committing: '提交中',
    deploying: '部署中',
    done: '已完成',
}

/** 流程可视化（标注当前位置） */
function renderPipeline(current: BrainMachineState): string {
    const stages: BrainMachineState[] = ['idle', 'developing', 'reviewing', 'linting', 'committing', 'deploying', 'done']
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
    commit_ok: '提交成功',
    commit_fail: '提交失败',
    deploy_ok: '部署成功',
    deploy_fail: '部署失败',
    waiting: '已发指令给主 session，等它执行完（保持当前阶段）',
}

/** 各状态的 Brain 指令 */
const STATE_INSTRUCTIONS: Record<BrainMachineState, string> = {
    idle: '主 session 尚未开始工作，等待中。',

    developing: `你处于「开发中」阶段：主 session 刚结束一轮输出/修改。

先调用 brain_summarize，判断主 session 是否已经停下并等待下一步输入。

然后只做一个决定（只选一个 signal）：
- 主 session 仍在输出/工具未结束/没有明确结论：返回 waiting
- 主 session 在等用户决策：用 brain_send_message(type=info) 给出决策或一个关键确认问题，然后返回 waiting
- 主 session 已停下且声称"已完成"：挑 1 个最高风险点，用 brain_send_message(type=review) 推动它自检并回报结论，然后返回 has_issue
- 你已经从至少 3 个不同维度推动过自检且结论都满意：返回 dev_complete

重要：每次 has_issue 只聚焦 1 个维度，且每次选择不同的维度（不要重复之前已审查过的方向）。
维度示例：边界条件、错误处理、类型契约、安全/权限、可维护性、性能、并发安全、向后兼容等。
如果改动涉及 CSS/样式/UI，必须包含「移动端适配」和「PC端兼容」这两个维度。`,

    reviewing: `你处于「代码审查」阶段：你不直接看代码，你的作用是推动主 session 自己做审查并回报结论。

先调用 brain_summarize，确认主 session 是否已停下，以及它是否已经给出审查结论。

你需要在这个阶段完成 3 轮推动（顺序执行，每轮只做 1 件事）：
1. 第 1 轮：给出 1 个审查方向（只给方向名称，不要细化具体检查项），用 brain_send_message(type=review) 推动主 session 自查并回报结论，然后返回 waiting
2. 第 2 轮：确认第 1 轮结论后，给出另 1 个不同的审查方向，同样只给方向不细化，推动自查，返回 waiting
3. 第 3 轮：确认前 2 轮结论后，用 brain_send_message(type=review) 推动主 session 做一次完善度自检："检查当前改动是否有遗漏、是否有潜在 bug、是否有未处理的边界情况"，然后返回 waiting

3 轮全部完成且结论都满意后，返回 no_issue。

每轮只做一个决定（只选一个 signal）：
- 主 session 仍在输出/工具未结束/没有明确停下：返回 waiting
- 主 session 在等用户回答问题：用 brain_send_message(type=info) 给出回答/取舍，然后返回 ai_question
- 你已推动但主 session 还没回报结论：返回 waiting
- 3 轮推动全部完成且结论满意：返回 no_issue
- 发现严重问题需要修改代码：返回 has_issue`,

    linting: `你处于「代码检查」阶段（lint/typecheck 等）。

先调用 brain_summarize，确认主 session 是否已经贴出了完整检查输出。

然后只做一个决定（只选一个 signal）：
- 还没看到完整输出：用 brain_send_message(type=info) 请它运行 lint 并贴出完整输出，然后返回 waiting
- 输出显示通过：返回 lint_pass
- 输出显示失败：用 brain_send_message(type=info) 请它修复后重新运行并回报结果，然后返回 lint_fail`,

    committing: `你处于「提交」阶段。

先调用 brain_summarize，确认用户是否明确希望现在提交/推送（提交通常会影响他人可见的历史）。

然后只做一个决定（只选一个 signal）：
- 若还未明确获得“可以提交”的确认：用 brain_send_message(type=info) 请主 session 先向用户确认是否现在提交（或给出更稳妥替代与取舍），然后返回 waiting
- 若已确认可以提交但尚未提交：用 brain_send_message(type=info) 请它完成提交（commit message 清晰描述改动）并回报结果，然后返回 waiting
- 提交成功：返回 commit_ok
- 提交失败：用 brain_send_message(type=info) 请它贴出失败原因、修复后重试并回报结果，然后返回 commit_fail`,

    deploying: `你处于「部署」阶段（通常是不可逆/对外可见操作）。

先调用 brain_summarize，确认用户是否明确希望现在部署，以及是否有窗口/环境约束。

然后只做一个决定（只选一个 signal）：
- 若还未明确获得“可以部署”的确认：用 brain_send_message(type=info) 请主 session 先向用户确认是否现在部署（并说明风险与取舍），然后返回 waiting
- 若已确认可以部署但尚未部署：用 brain_send_message(type=info) 请它按项目约定执行部署并回报完整结果，然后返回 waiting
- 部署成功：返回 deploy_ok
- 部署失败：用 brain_send_message(type=info) 请它贴出失败原因、做最小修复后再试并回报结果，然后返回 deploy_fail`,

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
    let allowed = getAllowedSignals(currentState)
    // developing 阶段：至少审查 3 个维度（has_issue 计数 < 3 时不允许 dev_complete）
    if (currentState === 'developing' && stateContext.retries.developing < 3) {
        allowed = allowed.filter(s => s !== 'dev_complete')
    }
    const signalList = allowed
        .map(s => `${s}: ${SIGNAL_DESCRIPTIONS[s] || s}`)
        .join('\n')

    const retryInfo = buildRetryInfo(currentState, stateContext)
    console.log('[StatePrompts] buildStateReviewPrompt:', {
        state: currentState,
        allowedSignals: allowed.join(','),
        rounds: roundNumbers.join(','),
        retries: JSON.stringify(stateContext.retries),
        lastSignal: stateContext.lastSignal ?? 'none',
    })

    return `<task_stage>${STATE_LABELS[currentState]}</task_stage>
<pipeline>${renderPipeline(currentState)}</pipeline>
<completed_rounds>${roundNumbers.join(', ')}</completed_rounds>${retryInfo}

<instructions>
${STATE_INSTRUCTIONS[currentState]}
</instructions>

<constraints>
每次最多发送 1 条 brain_send_message，1~3 句话，只推动一个关键点。
brain_send_message 会自动在末尾追加“完成后停下/不要自行推进下一步”等约束；message 本体不要重复。
工具调用完成后，你的最终回复只写一行，例如：SIGNAL:waiting（将 waiting 替换为你选择的 signal 名；不要放进代码块/反引号，也不要附加其它文本）。
</constraints>

<allowed_signals>
${signalList}
</allowed_signals>`
}


/**
 * 构建 refine prompt（供 messages.ts 的消息拦截使用）
 */
export function buildRefinePrompt(currentState: BrainMachineState): string {
    console.log('[StatePrompts] buildRefinePrompt: state=', currentState, 'label=', STATE_LABELS[currentState])
    return `<refine_context>用户发送了新消息。当前阶段: ${STATE_LABELS[currentState]}</refine_context>

<task>
先调用 brain_user_intent 获取用户原话。
然后用 brain_send_message(type=info) 发给主 session 一条短消息。
短消息内容要求：
开头用 1 句话质疑/确认用户决策是否最优（指出风险或更稳妥替代；必要时只问 1 个关键确认问题）。
随后用 1~3 句话说明目标、约束、验收（不要拆步骤，不要 checklist）。
如果用户要求跳过关键质量环节（例如不审查/直接部署），在短消息里说明风险，并推动主 session 以最小必要方式补齐质量验证。
</task>

<signal_choice>
若该用户消息会改变/推进主任务方向：SIGNAL:ai_reply_done
否则：SIGNAL:waiting
</signal_choice>

<final_response>
工具调用完成后，你的最终回复只写一行，例如：SIGNAL:waiting（将 waiting 替换为你选择的 signal 名；不要附加其它文本）。
</final_response>`
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
        const match = lines[i].match(/SIGNAL:\s*([a-z0-9_]+)/i)
        if (match) {
            const signal = match[1].toLowerCase()
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

    // developing 阶段：显示审查维度进度
    if (state === 'developing') {
        const reviewed = count ?? 0
        const minRequired = 3
        if (reviewed < minRequired) {
            return `\n<review_progress>已审查 ${reviewed}/${minRequired} 个维度，还需审查 ${minRequired - reviewed} 个不同维度才能进入代码审查阶段。</review_progress>\n`
        }
        return `\n<review_progress>已审查 ${reviewed} 个维度（已满足最低 ${minRequired} 个要求），可以返回 dev_complete 进入下一阶段。</review_progress>\n`
    }

    if (!count || count === 0) return ''

    const maxRetries: Record<string, number> = {
        reviewing: 10, linting: 3, committing: 2, deploying: 2,
    }
    const max = maxRetries[retryKey]
    if (!max) return ''

    return `\n<retry_info>当前已重试 ${count}/${max} 次。${count >= max - 1 ? '注意：即将达到上限，下次将强制推进到下一步。' : ''}</retry_info>\n`
}
