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
    const basePrompt = `你是 Yoho 的超级大脑。你会收到另一个 AI session 的对话汇总，每一轮会话都会发送给你。

## 你的工作方式
1. 根据每一轮会话的内容，结合 git 当前的改动情况（使用工具查看），做出判断
2. 如果发现不合理的地方（逻辑错误、安全问题、性能隐患、需求偏差等），**提出具体建议**
3. 如果没有问题，只需回复"知道了"，不要强行找问题

## 工具使用
- 使用 \`Read\`、\`Grep\`、\`Glob\` 工具查看代码和 git 改动
- **禁止修改任何文件** - 只能查看，不能 Edit/Write/Bash

## 输出格式
当有问题需要指出时，使用 JSON 格式：
\`\`\`json
{
  "suggestions": [
    {
      "id": "唯一ID",
      "type": "bug|security|performance|improvement",
      "severity": "high|medium|low",
      "title": "简短标题",
      "detail": "详细描述和解决方案"
    }
  ],
  "summary": "总体评价"
}
\`\`\`

当没有问题时，直接输出：
\`\`\`json
{
  "suggestions": [],
  "summary": "知道了"
}
\`\`\`
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
    previousSuggestions?: Array<{
        id: string
        type: string
        severity: string
        title: string
        detail: string
        applied: boolean
        deleted?: boolean
    }>,
    timeRange?: { start: number; end: number }
): string {
    const lines: string[] = [
        '## 代码审查任务\n',
        contextSummary
    ]

    // 时间范围
    if (timeRange) {
        const startDate = new Date(timeRange.start).toLocaleString('zh-CN')
        lines.push(`\n**开发时间范围：** ${startDate} 开始`)
    }

    // 之前的建议
    if (previousSuggestions && previousSuggestions.length > 0) {
        const pending = previousSuggestions.filter(s => !s.applied && !s.deleted)
        const applied = previousSuggestions.filter(s => s.applied)
        const deleted = previousSuggestions.filter(s => s.deleted && !s.applied)

        if (pending.length > 0) {
            lines.push('\n## 待处理的建议（需保留到新列表）')
            pending.forEach(s => {
                lines.push(`- [${s.type}/${s.severity}] ${s.title}: ${s.detail}`)
            })
        }

        if (applied.length > 0) {
            lines.push('\n## 已发送给主AI的建议（检查是否已修复）')
            applied.forEach(s => {
                lines.push(`- [${s.type}/${s.severity}] ${s.title}: ${s.detail}`)
            })
        }

        if (deleted.length > 0) {
            lines.push('\n## 用户删除的建议（不要再提类似问题）')
            deleted.forEach(s => {
                lines.push(`- [${s.type}/${s.severity}] ${s.title}`)
            })
        }
    }

    // 对话汇总
    if (roundsSummary) {
        lines.push('\n## 对话汇总\n')
        lines.push(roundsSummary)
    }

    lines.push(`
## 你的反应
根据会话内容，结合 git 当前改动情况（用 Read/Grep/Glob 工具查看相关代码），做出判断：
1. 如果发现不合理的地方，提出具体建议
2. 如果没有问题，只需要"知道了"

## 输出要求
- **输出完整的建议列表**，会覆盖之前的所有建议
- 保留仍有效的待处理建议（去重合并）
- 移除已修复的建议
- 不要重复用户删除的问题
- 如果没有问题，suggestions 为空数组，summary 写"知道了"

## 输出格式
\`\`\`json
{
  "suggestions": [
    {
      "id": "1",
      "type": "bug|security|performance|improvement",
      "severity": "high|medium|low",
      "title": "简短标题",
      "detail": "详细描述，包含问题位置和解决方案"
    }
  ],
  "summary": "总体评价，不超过200字"
}
\`\`\`
`)

    return lines.join('\n')
}
