/**
 * Brain SDK Service
 *
 * SDK 审查现在通过 detached worker 进程执行（brain-review-worker）。
 * 此类保留作为能力标记 — 当 BrainSdkService 实例存在时，
 * 表示 SDK 审查功能可用（worker 已构建并可被 spawn）。
 */

import type { BrainStore } from './store'

/**
 * Brain 请求状态
 */
export type BrainRequestStatus = 'idle' | 'running' | 'completed' | 'error' | 'aborted'

/**
 * Brain 请求结果
 */
export interface BrainRequestResult {
    status: BrainRequestStatus
    output?: string
    error?: string
    numTurns?: number
    costUsd?: number
    durationMs?: number
    startedAt?: number
    completedAt?: number
}

/**
 * Brain SDK Service（能力标记）
 *
 * SDK 审查的实际执行由 detached worker 进程完成。
 * 此类的存在表示 SDK 审查功能可用。
 */
export class BrainSdkService {
    constructor(private brainStore: BrainStore) {}
}

/**
 * 构建默认的 Brain 系统提示词
 */
export function buildBrainSystemPrompt(customInstructions?: string): string {
    const basePrompt = `你是 Yoho 大脑，参与一个三方协作会话：

- **用户**：提需求、做决策
- **Claude Code（主 session）**：写代码、执行任务
- **你（Yoho 大脑）**：review 代码、指出问题、推进流程

你会收到主 session 的对话汇总，每一轮会话都会同步给你。

## 你的职责
- **只做 review 和推进**：指出问题所在，告知主 session 去修复，但不要自己给出解决方案或代码
- 你不写代码、不提供修复方案、不给出具体实现，这些是 Claude Code 的工作
- 你只需要说"哪里有问题"、"需要关注什么"，然后让主 session 自己处理

## 你的工作方式
1. 结合 git 当前的改动情况（使用工具查看），review 代码
2. 如果发现问题（逻辑错误、安全问题、性能隐患、需求偏差等），简要指出问题，让主 session 去修
3. 如果没有问题，不需要强行找问题

## 工具使用
- 使用 \`Read\`、\`Grep\`、\`Glob\` 工具查看代码和 git 改动
- **禁止修改任何文件** - 只能查看，不能 Edit/Write/Bash

## 输出规则
- 指出问题时简洁直接，例如："xxx 文件第 xx 行有 xxx 问题，需要修复"
- 不要给出修复代码或具体实现方案
- 如果没有问题，只需输出 \`[NO_MESSAGE]\`，不要输出其他内容
`

    return customInstructions
        ? `${basePrompt}\n\n## 特殊说明\n\n${customInstructions}`
        : basePrompt
}

/**
 * 构建代码审查提示词
 */
export function buildReviewPrompt(
    contextSummary: string,
    roundsSummary?: string,
    timeRange?: { start: number; end: number }
): string {
    const lines: string[] = [
        '## 代码审查任务\n',
        contextSummary
    ]

    if (timeRange) {
        const startDate = new Date(timeRange.start).toLocaleString('zh-CN')
        lines.push(`\n**开发时间范围：** ${startDate} 开始`)
    }

    if (roundsSummary) {
        lines.push('\n## 对话汇总\n')
        lines.push(roundsSummary)
    }

    lines.push(`
## 你的任务
结合 git 当前改动情况（用 Read/Grep/Glob 工具查看相关代码），review 代码：
- 如果发现问题，简要指出问题所在，让主 session 去修复（不要给出解决方案或代码）
- 如果没有问题，只需输出 \`[NO_MESSAGE]\`
`)

    return lines.join('\n')
}

/**
 * 构建 refine 阶段的系统提示词
 * 第二个 worker 用来对审查结果做二次处理
 */
export function buildRefineSystemPrompt(): string {
    return `你是一个消息处理助手。你会收到一段代码审查结果，你的任务是对它做简单处理后输出。

## 规则
1. 阅读收到的审查结果内容
2. 在末尾加上后缀："\n\n— brain 处理过"
3. 直接输出处理后的完整文本，不要添加额外解释
4. 不要使用任何工具，直接输出文本即可
`
}
