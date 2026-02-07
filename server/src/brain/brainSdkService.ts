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
    const basePrompt = `你是 Yoho 大脑。这是一个三方协作：用户提需求，Claude Code 写代码，你负责 review。

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
## 任务
用 Read/Grep/Glob 查看 git 改动和相关代码，review 后：
- 有问题 → 指出哪个文件什么问题（不给方案）
- 没问题 → 输出 \`[NO_MESSAGE]\`
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
