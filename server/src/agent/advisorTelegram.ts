/**
 * AdvisorTelegramNotifier - Telegram 通知推送
 */

import type { InlineKeyboard } from 'grammy'
import type { StoredAgentSuggestion, SuggestionStatus } from '../store'
import type { AdvisorTelegramNotifier } from './advisorService'

interface TelegramBotLike {
    getBoundChatIds(namespace: string): number[]
    sendMessage(chatId: number, text: string, options?: { parse_mode?: string; reply_markup?: unknown }): Promise<void>
    buildMiniAppDeepLink(startParam: string): string
    isEnabled(): boolean
}

interface InlineKeyboardLike {
    url(label: string, url: string): InlineKeyboardLike
    row(): InlineKeyboardLike
}

export class AdvisorTelegramNotifierImpl implements AdvisorTelegramNotifier {
    private debounceMap = new Map<string, NodeJS.Timeout>()
    private debounceMs = 5000  // 5秒去抖

    private bot: TelegramBotLike | null = null

    setBotInterface(bot: TelegramBotLike): void {
        this.bot = bot
    }

    notifySuggestion(suggestion: StoredAgentSuggestion): void {
        if (!this.bot?.isEnabled()) {
            return
        }

        // 去抖：同一建议短时间内只发一次
        const key = `suggestion:${suggestion.id}`
        if (this.debounceMap.has(key)) {
            clearTimeout(this.debounceMap.get(key)!)
        }

        this.debounceMap.set(key, setTimeout(() => {
            this.debounceMap.delete(key)
            this.doNotifySuggestion(suggestion).catch(error => {
                console.error('[AdvisorTelegram] Failed to notify suggestion:', error)
            })
        }, this.debounceMs))
    }

    notifyStatusChange(suggestion: StoredAgentSuggestion, newStatus: SuggestionStatus): void {
        if (!this.bot?.isEnabled()) {
            return
        }

        // 去抖
        const key = `status:${suggestion.id}:${newStatus}`
        if (this.debounceMap.has(key)) {
            return  // 相同状态变化不重复发送
        }

        this.debounceMap.set(key, setTimeout(() => {
            this.debounceMap.delete(key)
            this.doNotifyStatus(suggestion, newStatus).catch(error => {
                console.error('[AdvisorTelegram] Failed to notify status change:', error)
            })
        }, 1000))  // 状态变化用更短的去抖
    }

    private async doNotifySuggestion(suggestion: StoredAgentSuggestion): Promise<void> {
        if (!this.bot) {
            return
        }

        const chatIds = this.bot.getBoundChatIds(suggestion.namespace)
        if (chatIds.length === 0) {
            return
        }

        const text = this.formatSuggestionText(suggestion)

        for (const chatId of chatIds) {
            try {
                await this.bot.sendMessage(chatId, text, {
                    parse_mode: 'HTML'
                })
            } catch (err) {
                console.error(`[AdvisorTelegram] Failed to send notification to ${chatId}:`, err)
            }
        }
    }

    private async doNotifyStatus(suggestion: StoredAgentSuggestion, newStatus: SuggestionStatus): Promise<void> {
        if (!this.bot) {
            return
        }

        const chatIds = this.bot.getBoundChatIds(suggestion.namespace)
        if (chatIds.length === 0) {
            return
        }

        const statusEmoji = {
            accepted: '✅',
            rejected: '❌',
            stale: '⏰',
            superseded: '🔄',
            pending: '⏳'
        }[newStatus] || '📋'

        const text = `${statusEmoji} <b>建议状态更新</b>\n\n` +
            `<b>${this.escapeHtml(suggestion.title)}</b>\n` +
            `状态: ${newStatus}`

        for (const chatId of chatIds) {
            try {
                await this.bot.sendMessage(chatId, text, { parse_mode: 'HTML' })
            } catch (err) {
                console.error(`[AdvisorTelegram] Failed to send status notification to ${chatId}:`, err)
            }
        }
    }

    private formatSuggestionText(suggestion: StoredAgentSuggestion): string {
        const severityEmoji = {
            critical: '🚨',
            high: '⚠️',
            medium: '💡',
            low: 'ℹ️'
        }[suggestion.severity] || '💡'

        const categoryLabels: Record<string, string> = {
            product: '产品',
            architecture: '架构',
            operation: '运营',
            strategy: '策略',
            collaboration: '协作'
        }
        const categoryLabel = (suggestion.category && categoryLabels[suggestion.category]) || suggestion.category || '通用'

        let text = `${severityEmoji} <b>Advisor 建议</b>\n\n` +
            `<b>类别：</b>${categoryLabel}\n` +
            `<b>标题：</b>${this.escapeHtml(suggestion.title)}\n` +
            `<b>严重度：</b>${suggestion.severity}\n` +
            `<b>置信度：</b>${Math.round(suggestion.confidence * 100)}%\n`

        if (suggestion.detail) {
            const detail = suggestion.detail.length > 500
                ? suggestion.detail.slice(0, 500) + '...'
                : suggestion.detail
            text += `\n<b>详情：</b>\n${this.escapeHtml(detail)}`
        }

        return text
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    }
}

/**
 * 创建 Telegram 通知器实例
 */
export function createAdvisorTelegramNotifier(): AdvisorTelegramNotifierImpl {
    return new AdvisorTelegramNotifierImpl()
}
