/**
 * 自动迭代 Telegram 命令
 */

import type { Bot, Context, InlineKeyboard } from 'grammy'
import type { AutoIterationService } from '../agent/autoIteration'
import type { ActionRequest, AutoIterationLog, ExecutionPolicy } from '../agent/autoIteration/types'
import { DEFAULT_POLICY, POLICY_DESCRIPTIONS, ACTION_RISK_LEVELS } from '../agent/autoIteration/config'

export interface AutoIterCommandsConfig {
    bot: Bot<Context>
    autoIterationService: AutoIterationService
    getNamespaceForChatId: (chatId: number | null | undefined) => string | null
}

/**
 * 获取状态 emoji
 */
function getStatusEmoji(status: string): string {
    const emojis: Record<string, string> = {
        pending: '⏳',
        approved: '✅',
        executing: '⚙️',
        completed: '✅',
        failed: '❌',
        rejected: '🚫',
        cancelled: '⛔',
        timeout: '⏰'
    }
    return emojis[status] ?? '❓'
}

/**
 * 获取策略 emoji
 */
function getPolicyEmoji(policy: ExecutionPolicy): string {
    const emojis: Record<ExecutionPolicy, string> = {
        auto_execute: '🟢',
        notify_then_execute: '🟡',
        require_confirm: '🟠',
        always_manual: '🔴',
        disabled: '⚫'
    }
    return emojis[policy] ?? '❓'
}

/**
 * 注册自动迭代 Telegram 命令
 */
export function registerAutoIterCommands(config: AutoIterCommandsConfig): void {
    const { bot, autoIterationService, getNamespaceForChatId } = config

    // /auto_iter - 显示状态
    bot.command('auto_iter', async (ctx) => {
        const namespace = getNamespaceForChatId(ctx.from?.id)
        if (!namespace) {
            await ctx.reply('❌ Telegram 账号未绑定')
            return
        }

        const serviceConfig = autoIterationService.getConfig()
        const stats = autoIterationService.getStats()
        const status = serviceConfig.enabled ? '✅ 已启用' : '❌ 已禁用'

        const message = `🤖 *自动迭代状态*

${status}

*统计信息:*
• 总操作: ${stats.total}
• 待处理: ${stats.pending}
• 已完成: ${stats.completed}
• 失败: ${stats.failed}
• 已拒绝: ${stats.rejected}

*配置:*
• 项目白名单: ${serviceConfig.allowedProjects.length === 0 ? '全部项目' : serviceConfig.allowedProjects.length + ' 个项目'}
• 通知级别: ${serviceConfig.notificationLevel}
• 日志保留: ${serviceConfig.keepLogsDays} 天

使用 /auto\\_iter\\_on 启用
使用 /auto\\_iter\\_off 禁用
使用 /auto\\_iter\\_logs 查看日志
使用 /auto\\_iter\\_policy 查看策略`

        await ctx.reply(message, { parse_mode: 'Markdown' })
    })

    // /auto_iter_on - 启用
    bot.command('auto_iter_on', async (ctx) => {
        const namespace = getNamespaceForChatId(ctx.from?.id)
        if (!namespace) {
            await ctx.reply('❌ Telegram 账号未绑定')
            return
        }

        const userId = ctx.from?.id ? String(ctx.from.id) : undefined
        await autoIterationService.enable(userId)
        await ctx.reply('✅ 自动迭代已启用\n\nAI Advisor 现在可以根据策略自动执行操作。')
    })

    // /auto_iter_off - 禁用
    bot.command('auto_iter_off', async (ctx) => {
        const namespace = getNamespaceForChatId(ctx.from?.id)
        if (!namespace) {
            await ctx.reply('❌ Telegram 账号未绑定')
            return
        }

        const userId = ctx.from?.id ? String(ctx.from.id) : undefined
        await autoIterationService.disable(userId)
        await ctx.reply('❌ 自动迭代已禁用\n\nAI Advisor 将不再自动执行任何操作。')
    })

    // /auto_iter_logs - 查看日志
    bot.command('auto_iter_logs', async (ctx) => {
        const namespace = getNamespaceForChatId(ctx.from?.id)
        if (!namespace) {
            await ctx.reply('❌ Telegram 账号未绑定')
            return
        }

        const logs = autoIterationService.getLogs({ limit: 10 })

        if (logs.length === 0) {
            await ctx.reply('📋 暂无执行日志')
            return
        }

        const lines = logs.map(log => {
            const status = getStatusEmoji(log.executionStatus)
            const time = new Date(log.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
            const reason = log.reason ? log.reason.slice(0, 30) : 'N/A'
            return `${status} \\[${log.actionType}\\] ${reason}${log.reason && log.reason.length > 30 ? '...' : ''}\n   _${time}_`
        })

        const message = `📋 *最近执行日志*\n\n${lines.join('\n\n')}`

        await ctx.reply(message, { parse_mode: 'Markdown' })
    })

    // /auto_iter_policy - 查看策略
    bot.command('auto_iter_policy', async (ctx) => {
        const namespace = getNamespaceForChatId(ctx.from?.id)
        if (!namespace) {
            await ctx.reply('❌ Telegram 账号未绑定')
            return
        }

        const serviceConfig = autoIterationService.getConfig()
        const policySummary = autoIterationService.getPolicySummary()

        const lines = Object.entries(policySummary).map(([action, info]) => {
            const emoji = getPolicyEmoji(info.policy)
            const custom = info.isCustom ? ' _(自定义)_' : ''
            const desc = POLICY_DESCRIPTIONS[info.policy] ?? info.policy
            return `${emoji} \`${action}\`: ${desc}${custom}`
        })

        const message = `📋 *执行策略*\n\n${lines.join('\n')}\n\n*图例:*\n🟢 自动执行\n🟡 通知后执行\n🟠 需要确认\n🔴 永远手动\n⚫ 禁用`

        await ctx.reply(message, { parse_mode: 'Markdown' })
    })
}

/**
 * 注册自动迭代回调处理
 */
export function registerAutoIterCallbacks(
    bot: Bot<Context>,
    autoIterationService: AutoIterationService,
    getNamespaceForChatId: (chatId: number | null | undefined) => string | null
): void {
    // 处理审批回调
    bot.callbackQuery(/^ai_(approve|reject):(.+)$/, async (ctx) => {
        const namespace = getNamespaceForChatId(ctx.from?.id)
        if (!namespace) {
            await ctx.answerCallbackQuery('❌ Telegram 账号未绑定')
            return
        }

        const match = ctx.callbackQuery.data.match(/^ai_(approve|reject):(.+)$/)
        if (!match) {
            await ctx.answerCallbackQuery('❌ 无效的操作')
            return
        }

        const [, action, logId] = match
        const approved = action === 'approve'
        const userId = ctx.from?.id ? String(ctx.from.id) : undefined

        const success = autoIterationService.handleApproval(logId, approved, userId)

        if (success) {
            await ctx.answerCallbackQuery(approved ? '✅ 已批准' : '❌ 已拒绝')

            // 更新消息
            try {
                const log = autoIterationService.getLog(logId)
                if (log) {
                    const status = approved ? '已批准' : '已拒绝'
                    await ctx.editMessageText(
                        `${approved ? '✅' : '❌'} 操作已${status}\n\n` +
                        `操作: ${log.actionType}\n` +
                        `原因: ${log.reason ?? 'N/A'}`
                    )
                }
            } catch {
                // 忽略编辑失败
            }
        } else {
            await ctx.answerCallbackQuery('❌ 操作无效或已处理')
        }
    })
}

/**
 * 创建自动迭代通知回调
 */
export function createAutoIterNotificationCallback(
    bot: Bot<Context>,
    getChatIdsForNamespace: (namespace: string) => number[]
) {
    return async (
        request: ActionRequest,
        log: AutoIterationLog,
        options: {
            type: 'notify_then_execute' | 'require_confirm'
            timeoutSeconds?: number
            message: string
        }
    ): Promise<void> => {
        const chatIds = getChatIdsForNamespace(log.namespace)

        if (chatIds.length === 0) {
            console.log('[AutoIteration] No chat IDs found for namespace:', log.namespace)
            return
        }

        const icon = options.type === 'require_confirm' ? '⚠️' : '🤖'
        const riskIcon = request.riskLevel === 'high' ? '🔴' : request.riskLevel === 'medium' ? '🟡' : '🟢'
        const riskInfo = ACTION_RISK_LEVELS[request.actionType]

        const message = `${icon} *自动迭代请求*

*操作类型:* \`${request.actionType}\`
*项目:* ${request.targetProject ?? 'N/A'}
*原因:* ${request.reason}
*预期结果:* ${request.expectedOutcome}

*风险等级:* ${riskIcon} ${request.riskLevel}
*可回滚:* ${request.reversible ? '是' : '否'}
*置信度:* ${(request.confidence * 100).toFixed(0)}%

${options.message}`

        // 创建按钮
        const { InlineKeyboard } = await import('grammy')
        const keyboard = new InlineKeyboard()

        if (options.type === 'require_confirm') {
            keyboard
                .text('✅ 批准', `ai_approve:${log.id}`)
                .text('❌ 拒绝', `ai_reject:${log.id}`)
        } else {
            keyboard.text('⛔ 取消', `ai_reject:${log.id}`)
        }

        // 发送到所有绑定的聊天
        for (const chatId of chatIds) {
            try {
                await bot.api.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                })
            } catch (error) {
                console.error(`[AutoIteration] Failed to send notification to chat ${chatId}:`, error)
            }
        }
    }
}

/**
 * 发送执行结果通知
 */
export async function sendAutoIterResultNotification(
    bot: Bot<Context>,
    getChatIdsForNamespace: (namespace: string) => number[],
    log: AutoIterationLog,
    status: string,
    message?: string
): Promise<void> {
    const chatIds = getChatIdsForNamespace(log.namespace)

    if (chatIds.length === 0) {
        return
    }

    const statusEmoji = getStatusEmoji(status)
    const statusText = status === 'completed' ? '执行成功' :
                       status === 'failed' ? '执行失败' :
                       status === 'rejected' ? '已拒绝' :
                       status === 'cancelled' ? '已取消' :
                       status

    const notificationMessage = `${statusEmoji} *自动迭代${statusText}*

*操作:* \`${log.actionType}\`
*原因:* ${log.reason ?? 'N/A'}
${message ? `\n*详情:* ${message}` : ''}`

    for (const chatId of chatIds) {
        try {
            await bot.api.sendMessage(chatId, notificationMessage, {
                parse_mode: 'Markdown'
            })
        } catch (error) {
            console.error(`[AutoIteration] Failed to send result notification to chat ${chatId}:`, error)
        }
    }
}
