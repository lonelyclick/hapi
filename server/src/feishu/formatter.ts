/**
 * Feishu message formatter.
 * Converts Brain agent output to Feishu message formats.
 */

const MAX_TEXT_LENGTH = 4000

/**
 * Extract text from a SyncEngine message content object.
 * Only extracts agent/assistant role messages.
 */
export function extractAgentText(content: unknown): string | null {
    if (!content || typeof content !== 'object') return null
    const record = content as Record<string, unknown>

    const role = record.role as string | undefined
    if (role !== 'agent' && role !== 'assistant') return null

    const innerContent = record.content as Record<string, unknown> | string | null
    if (typeof innerContent === 'string') {
        return innerContent
    }
    if (innerContent && typeof innerContent === 'object') {
        const data = innerContent.data as Record<string, unknown> | undefined

        // Claude Code agent format: { type: 'assistant', message: { content: [{ type: 'text', text: '...' }] } }
        if (data?.type === 'assistant' && data.message) {
            const message = data.message as Record<string, unknown>
            const blocks = message.content as Array<Record<string, unknown>> | undefined
            if (Array.isArray(blocks)) {
                const texts = blocks
                    .filter(b => b.type === 'text' && typeof b.text === 'string')
                    .map(b => b.text as string)
                if (texts.length > 0) return texts.join('\n')
            }
        }

        // Simple text format
        if (typeof data?.type === 'string' && data.type === 'message' && typeof data.message === 'string') {
            return data.message
        }

        // Codex format
        const contentType = (innerContent as Record<string, unknown>).type as string
        if (contentType === 'codex' && data?.type === 'message' && typeof data.message === 'string') {
            return data.message
        }
        if (contentType === 'text') {
            return ((innerContent as Record<string, unknown>).text as string) || null
        }
    }
    return null
}

/**
 * Check if a message is an internal Brain orchestration message
 * (e.g. "[子 session 任务完成]") that should NOT be forwarded to Feishu.
 */
export function isInternalBrainMessage(text: string): boolean {
    // Brain callback messages
    if (text.startsWith('[子 session 任务完成]')) return true
    // Tool use results
    if (text.startsWith('[tool_result]')) return true
    return false
}

/**
 * Format text for Feishu post message (rich text with Markdown support).
 * Truncates if too long.
 */
export function formatForFeishuPost(text: string): object {
    let finalText = text
    if (finalText.length > MAX_TEXT_LENGTH) {
        finalText = finalText.slice(0, MAX_TEXT_LENGTH) + '\n\n...(内容过长已截断，完整内容请在 Hapi Web 查看)'
    }

    return {
        zh_cn: {
            content: [[{ tag: 'text', text: finalText }]]
        }
    }
}

/**
 * Build a Feishu message payload ready for the API.
 */
export function buildFeishuMessage(text: string): { msgType: string; content: string } {
    return {
        msgType: 'post',
        content: JSON.stringify(formatForFeishuPost(text)),
    }
}
