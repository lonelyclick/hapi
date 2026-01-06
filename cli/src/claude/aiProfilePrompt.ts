import type { AIProfile } from '@/api/types'

const ROLE_DESCRIPTIONS: Record<string, string> = {
    developer: 'Software Developer - You write clean, efficient code and solve technical problems.',
    architect: 'Software Architect - You design system architecture and make technical decisions.',
    reviewer: 'Code Reviewer - You review code, provide feedback, and ensure quality.',
    pm: 'Project Manager - You coordinate tasks, track progress, and communicate with stakeholders.',
    tester: 'QA Tester - You write tests, find bugs, and ensure software quality.',
    devops: 'DevOps Engineer - You handle deployment, infrastructure, and automation.'
}

/**
 * 构建 AI 员工身份提示词
 */
export function buildAIProfilePrompt(profile: AIProfile): string {
    const parts: string[] = []

    // 角色和身份
    parts.push(`# Your Identity: ${profile.avatarEmoji} ${profile.name}`)
    parts.push('')
    parts.push(`**Role:** ${ROLE_DESCRIPTIONS[profile.role] || profile.role}`)

    // 专长
    if (profile.specialties.length > 0) {
        parts.push(`**Specialties:** ${profile.specialties.join(', ')}`)
    }

    // 工作风格
    if (profile.workStyle) {
        parts.push(`**Work Style:** ${profile.workStyle}`)
    }

    // 个性
    if (profile.personality) {
        parts.push('')
        parts.push('## Your Personality')
        parts.push(profile.personality)
    }

    // 问候语模板（作为提示）
    if (profile.greetingTemplate) {
        parts.push('')
        parts.push('## Greeting Style')
        parts.push(`When starting a conversation, you might say something like: "${profile.greetingTemplate}"`)
    }

    // 统计信息（展示经验）
    if (profile.stats.tasksCompleted > 0) {
        parts.push('')
        parts.push('## Your Experience')
        parts.push(`You have completed ${profile.stats.tasksCompleted} tasks with ${Math.floor(profile.stats.activeMinutes / 60)} hours of active work.`)
    }

    parts.push('')
    parts.push('---')
    parts.push('')

    return parts.join('\n')
}

/**
 * 检查是否应该注入 AI Profile（基于会话名称或参数）
 */
export function shouldInjectAIProfile(
    profile: AIProfile | null,
    sessionName?: string,
    claudeAgent?: string
): boolean {
    // 没有 profile 就不注入
    if (!profile) return false

    // 如果 claudeAgent 是特殊角色，不注入普通 profile
    const specialAgents = ['cto']
    if (claudeAgent && specialAgents.includes(claudeAgent.toLowerCase())) {
        return false
    }

    // 默认：如果有 profile 就注入
    return true
}
