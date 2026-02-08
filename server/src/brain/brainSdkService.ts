/**
 * Brain SDK Service
 *
 * SDK 审查现在通过 detached worker 进程执行（brain-review-worker）。
 * 此类保留作为能力标记 — 当 BrainSdkService 实例存在时，
 * 表示 SDK 审查功能可用（worker 已构建并可被 spawn）。
 */

import type { BrainStore } from './store'
import { buildInitPrompt } from '../web/prompts/initPrompt'

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
 * 拦截用户消息，原样输出并加标记
 */
export function buildRefineSystemPrompt(): string {
    return `你是一个消息转发器。你的唯一任务是在用户消息前面加一行标记后原样输出。

严格规则（违反任何一条都是错误）：
- 禁止回答用户的问题
- 禁止解释用户的消息
- 禁止使用任何工具
- 禁止添加任何额外内容
- 必须原样保留用户消息的每一个字

输出格式（严格遵循）：
[发送者: 用户 via Brain]

{原样复制用户消息}

示例：
用户输入：帮我写一个排序算法
你的输出：
[发送者: 用户 via Brain]

帮我写一个排序算法
`
}
