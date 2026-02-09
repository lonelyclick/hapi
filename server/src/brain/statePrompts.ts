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

你的任务是进行**多维质量检查**，确保开发完备后再进入代码审查阶段。不要急于通过，要像一个严谨的技术负责人一样逐项审视。

## 检查维度（根据改动内容选择适用项，每个适用维度都必须通过）

### 1. 前后端适配
- 改了前端组件或页面 → 后端是否有对应的 API 新增/修改？字段名、类型是否一致？
- 改了后端接口（路由、返回结构、参数）→ 前端调用方是否已同步更新？
- 新增了数据模型/表结构 → 前端的类型定义、表单、展示逻辑是否都适配了？
- WebSocket/SSE 事件结构变更 → 发送端和接收端是否对齐？
- 如果只改了纯前端（样式、布局）或纯后端（内部逻辑不影响接口），此项可跳过

### 2. 流程完整性
- 梳理改动涉及的完整用户流程，从触发入口到最终结果，至少走查 3 遍
- 第 1 遍：正常路径（happy path）— 主流程是否通畅？
- 第 2 遍：边界路径 — 空数据、首次使用、大量数据、并发操作
- 第 3 遍：异常路径 — 网络断开、权限不足、数据不一致、超时
- 检查状态流转是否有死路（进入后出不来）或遗漏的状态处理
- 如果改动很简单（单文件局部修改），此项可简化

### 3. 视觉一致性
- 新增/修改的 UI 元素是否与现有页面的视觉风格统一（间距、字号、颜色、圆角等）？
- 不同屏幕尺寸下布局是否合理？有没有溢出或挤压？
- 交互状态是否完整（hover、active、disabled、loading、empty state）？
- 暗色/亮色主题是否都覆盖？
- 如果没改 UI/样式，此项跳过

### 4. 基本完成度
- 用户原始需求的每一条是否都实现了？逐条对照检查
- 有没有半成品代码（TODO、placeholder、硬编码的临时值）？
- 错误处理是否到位（try-catch、用户提示、降级方案）？
- 新增功能是否有对应的清理逻辑（卸载、销毁、取消订阅）？

### 5. 数据一致性
- 新增/修改的数据存储（DB、文件、缓存）是否有对应的读取和写入逻辑？
- 数据迁移：旧数据在新逻辑下是否兼容？会不会因为字段缺失而崩溃？
- 并发安全：多个 session/用户同时操作是否会产生竞态条件？

### 6. 依赖影响
- 修改的函数/模块是否被其他地方引用？引用方是否需要同步调整？
- 类型签名变更是否影响到其他 TypeScript 文件的类型推断？
- 配置项/环境变量的新增或变更是否有文档或默认值？

## 判断逻辑

- 逐个维度检查（跳过不适用的），**任意一个维度发现问题** → 用 brain_send_message(type=info) 详细说明问题并给出**具体的修改指令**（不要含糊，要告诉主 session 改哪个文件、怎么改），然后返回 has_issue
- 如果 AI 还在等待用户决策（问问题、给选项）→ 替用户做决策，用 brain_send_message(type=info) 发送决策，然后返回 waiting
- **所有适用维度都检查通过**，开发完备无遗漏 → 返回 dev_complete`,

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
        developing: 5, reviewing: 5, linting: 3, testing: 3, committing: 2, deploying: 2,
    }
    const max = maxRetries[retryKey]
    if (!max) return ''

    return `\n## 重试信息\n当前已重试 ${count}/${max} 次。${count >= max - 1 ? '⚠️ 即将达到上限，下次将强制推进到下一步。' : ''}\n`
}
