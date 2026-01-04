import type { AgentEvent } from '@/chat/types'

export function formatUnixTimestamp(value: number): string {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) return String(value)
    return date.toLocaleString()
}

export type EventPresentation = {
    icon: string | null
    text: string
}

export function getEventPresentation(event: AgentEvent): EventPresentation {
    if (event.type === 'switch') {
        const mode = event.mode === 'local' ? 'local' : 'remote'
        return { icon: '🔄', text: `Switched to ${mode}` }
    }
    if (event.type === 'title-changed') {
        const title = typeof event.title === 'string' ? event.title : ''
        return { icon: null, text: title ? `Title changed to "${title}"` : 'Title changed' }
    }
    if (event.type === 'permission-mode-changed') {
        const modeValue = (event as Record<string, unknown>).mode
        const mode = typeof modeValue === 'string' ? modeValue : 'default'
        return { icon: '🔐', text: `Permission mode: ${mode}` }
    }
    if (event.type === 'limit-reached') {
        const endsAt = typeof event.endsAt === 'number' ? event.endsAt : null
        return { icon: '⏳', text: endsAt ? `Usage limit reached until ${formatUnixTimestamp(endsAt)}` : 'Usage limit reached' }
    }
    if (event.type === 'message') {
        return { icon: null, text: typeof event.message === 'string' ? event.message : 'Message' }
    }
    // Advisor suggestions
    if (event.type === 'advisor-suggestion') {
        const e = event as Record<string, unknown>
        const severity = e.severity as string
        const severityIcon = severity === 'critical' ? '🚨'
            : severity === 'high' ? '⚠️'
            : severity === 'medium' ? '💡'
            : 'ℹ️'
        const category = e.category as string || 'general'
        const title = e.title as string || 'Advisor suggestion'
        return { icon: severityIcon, text: `[${category}] ${title}` }
    }
    if (event.type === 'advisor-suggestion-status') {
        const e = event as Record<string, unknown>
        const status = e.status as string
        const statusIcon = status === 'accepted' ? '✅'
            : status === 'rejected' ? '❌'
            : status === 'stale' ? '⏰'
            : '📋'
        const title = e.title as string || 'Suggestion'
        return { icon: statusIcon, text: `${title} - ${status}` }
    }
    try {
        return { icon: null, text: JSON.stringify(event) }
    } catch {
        return { icon: null, text: String(event.type) }
    }
}

export function renderEventLabel(event: AgentEvent): string {
    return getEventPresentation(event).text
}
