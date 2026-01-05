/**
 * Telegram Bot for HAPI
 *
 * Simplified bot that only handles notifications (permission requests and ready events).
 * All interactive features are handled by the Telegram Mini App.
 */

import { Bot, Context, InlineKeyboard } from 'grammy'
import { SyncEngine, SyncEvent, Session } from '../sync/syncEngine'
import { handleCallback, CallbackContext } from './callbacks'
import { formatSessionNotification, createNotificationKeyboard } from './sessionView'
import type { Store } from '../store'

export interface BotContext extends Context {
    // Extended context for future use
}

export interface HappyBotConfig {
    syncEngine: SyncEngine
    botToken: string
    miniAppUrl: string
    store: Store
}

// 自主模式控制器接口（由 AdvisorService 实现）
export interface AutonomousController {
    enableAutonomousMode(): void
    disableAutonomousMode(): void
    isAutonomousModeEnabled(): boolean
}

/**
 * HAPI Telegram Bot - Notification-only mode
 */
export class HappyBot {
    private bot: Bot<BotContext>
    private syncEngine: SyncEngine | null = null
    private isRunning = false
    private readonly miniAppUrl: string
    private readonly store: Store

    // Track last known permission requests per session to detect new ones
    private lastKnownRequests: Map<string, Set<string>> = new Map()

    // Debounce timers for notifications
    private notificationDebounce: Map<string, NodeJS.Timeout> = new Map()

    // Track ready notifications to avoid spam
    private lastReadyNotificationAt: Map<string, number> = new Map()

    // Unsubscribe function for sync events
    private unsubscribeSyncEvents: (() => void) | null = null

    // 自主模式控制器
    private autonomousController: AutonomousController | null = null

    constructor(config: HappyBotConfig) {
        this.syncEngine = config.syncEngine
        this.miniAppUrl = config.miniAppUrl
        this.store = config.store

        this.bot = new Bot<BotContext>(config.botToken)
        this.setupMiddleware()
        this.setupCommands()
        this.setupCallbacks()

        // Subscribe to sync events immediately if engine is available
        if (this.syncEngine) {
            this.setSyncEngine(this.syncEngine)
        }
    }

    /**
     * Update the sync engine reference (after auth)
     */
    setSyncEngine(engine: SyncEngine): void {
        // Unsubscribe from old engine
        if (this.unsubscribeSyncEvents) {
            this.unsubscribeSyncEvents()
            this.unsubscribeSyncEvents = null
        }

        this.syncEngine = engine

        // Subscribe to events for notifications
        this.unsubscribeSyncEvents = engine.subscribe((event) => {
            this.handleSyncEvent(event)
        })
    }

    /**
     * Get the underlying bot instance
     */
    getBot(): Bot<BotContext> {
        return this.bot
    }

    /**
     * Start the bot
     */
    async start(): Promise<void> {
        if (this.isRunning) return

        console.log('[HAPIBot] Starting Telegram bot...')
        this.isRunning = true

        // Start polling
        this.bot.start({
            onStart: (botInfo) => {
                console.log(`[HAPIBot] Bot @${botInfo.username} started`)
            }
        })
    }

    /**
     * Stop the bot
     */
    async stop(): Promise<void> {
        if (!this.isRunning) return

        console.log('[HAPIBot] Stopping Telegram bot...')

        // Unsubscribe from sync events
        if (this.unsubscribeSyncEvents) {
            this.unsubscribeSyncEvents()
            this.unsubscribeSyncEvents = null
        }

        // Clear notification debounce timers
        for (const timer of this.notificationDebounce.values()) {
            clearTimeout(timer)
        }
        this.notificationDebounce.clear()

        await this.bot.stop()
        this.isRunning = false
    }

    /**
     * Setup middleware
     */
    private setupMiddleware(): void {
        // Error handling middleware
        this.bot.catch((err) => {
            console.error('[HAPIBot] Error:', err.message)
        })
    }

    /**
     * Setup command handlers
     */
    private setupCommands(): void {
        // /app - Open Telegram Mini App (primary entry point)
        this.bot.command('app', async (ctx) => {
            const keyboard = new InlineKeyboard().webApp('Open App', this.miniAppUrl)
            await ctx.reply('Open HAPI Mini App:', { reply_markup: keyboard })
        })

        // /start - Simple welcome with Mini App link
        this.bot.command('start', async (ctx) => {
            const keyboard = new InlineKeyboard().webApp('Open App', this.miniAppUrl)
            await ctx.reply(
                'Welcome to HAPI Bot!\n\n' +
                'Use the Mini App for full session management.',
                { reply_markup: keyboard }
            )
        })

        // /autonomous - 自主模式控制
        this.bot.command('autonomous', async (ctx) => {
            const namespace = this.getNamespaceForChatId(ctx.from?.id ?? null)
            if (!namespace) {
                await ctx.reply('❌ Telegram account is not bound to any namespace')
                return
            }

            if (!this.autonomousController) {
                await ctx.reply('❌ Autonomous mode is not available')
                return
            }

            const args = ctx.message?.text?.split(' ').slice(1) ?? []
            const subcommand = args[0]?.toLowerCase()

            switch (subcommand) {
                case 'on':
                    this.autonomousController.enableAutonomousMode()
                    await ctx.reply('✅ Autonomous mode enabled\n\nAI will now proactively discover and execute tasks.')
                    break
                case 'off':
                    this.autonomousController.disableAutonomousMode()
                    await ctx.reply('⏹️ Autonomous mode disabled\n\nAI will only respond to direct requests.')
                    break
                case 'status':
                default:
                    const enabled = this.autonomousController.isAutonomousModeEnabled()
                    await ctx.reply(
                        `🤖 <b>Autonomous Mode</b>\n\n` +
                        `Status: ${enabled ? '✅ Enabled' : '⏹️ Disabled'}\n\n` +
                        `Commands:\n` +
                        `/autonomous on - Enable autonomous mode\n` +
                        `/autonomous off - Disable autonomous mode\n` +
                        `/autonomous status - Show current status`,
                        { parse_mode: 'HTML' }
                    )
                    break
            }
        })
    }

    /**
     * 设置自主模式控制器
     */
    setAutonomousController(controller: AutonomousController): void {
        this.autonomousController = controller
        console.log('[HAPIBot] Autonomous controller connected')
    }

    /**
     * Setup callback query handlers for notification buttons
     */
    private setupCallbacks(): void {
        this.bot.on('callback_query:data', async (ctx) => {
            if (!this.syncEngine) {
                await ctx.answerCallbackQuery('Not connected')
                return
            }

            const namespace = this.getNamespaceForChatId(ctx.from?.id ?? null)
            if (!namespace) {
                await ctx.answerCallbackQuery('Telegram account is not bound')
                return
            }

            const data = ctx.callbackQuery.data

            const callbackContext: CallbackContext = {
                syncEngine: this.syncEngine,
                namespace,
                answerCallback: async (text?: string) => {
                    await ctx.answerCallbackQuery(text)
                },
                editMessage: async (text, keyboard) => {
                    await ctx.editMessageText(text, {
                        reply_markup: keyboard
                    })
                }
            }

            await handleCallback(data, callbackContext)
        })
    }

    /**
     * Handle sync engine events for notifications
     */
    private handleSyncEvent(event: SyncEvent): void {
        if (event.type === 'session-updated' && event.sessionId) {
            const session = this.syncEngine?.getSession(event.sessionId)
            if (session) {
                this.checkForPermissionNotification(session)
            }
        }

        if (event.type === 'message-received' && event.sessionId) {
            const message = (event.message?.content ?? event.data) as any
            const messageContent = message?.content
            const eventType = messageContent?.type === 'event' ? messageContent?.data?.type : null

            if (eventType === 'ready') {
                this.sendReadyNotification(event.sessionId).catch((error) => {
                    console.error('[HAPIBot] Failed to send ready notification:', error)
                })
            }
        }
    }

    private getNotifiableSession(sessionId: string): Session | null {
        const session = this.syncEngine?.getSession(sessionId)
        if (!session || !session.active) {
            return null
        }
        return session
    }

    private getNamespaceForChatId(chatId: number | null | undefined): string | null {
        if (!chatId) {
            return null
        }
        const stored = this.store.getUser('telegram', String(chatId))
        return stored?.namespace ?? null
    }

    /**
     * Send a push notification when agent is ready for input.
     * 只通知 session 的 owner（创建者）和订阅者，不再广播给所有人
     */
    private async sendReadyNotification(sessionId: string): Promise<void> {
        const session = this.getNotifiableSession(sessionId)
        if (!session) {
            return
        }

        // Skip notifications for Advisor sessions
        if (session.metadata?.runtimeAgent === 'advisor') {
            return
        }

        const now = Date.now()
        const last = this.lastReadyNotificationAt.get(sessionId) ?? 0
        if (now - last < 5000) {
            return
        }
        this.lastReadyNotificationAt.set(sessionId, now)

        // Get agent name from flavor
        const flavor = session.metadata?.flavor
        const agentName = flavor === 'claude' ? 'Claude'
                        : flavor === 'codex' ? 'Codex'
                        : flavor === 'gemini' ? 'Gemini'
                        : 'Agent'

        // 获取 session 名字用于通知
        const sessionName = session.metadata?.name || 'Unknown session'

        const url = buildMiniAppDeepLink(this.miniAppUrl, `session_${sessionId}`)
        const keyboard = new InlineKeyboard()
            .webApp('Open Session', url)

        // 只通知 owner 和订阅者，不再广播给所有人
        const recipientChatIds = this.store.getSessionNotificationRecipients(sessionId)
        if (recipientChatIds.length === 0) {
            return
        }

        for (const chatIdStr of recipientChatIds) {
            const chatId = Number(chatIdStr)
            if (!Number.isFinite(chatId)) continue

            try {
                await this.bot.api.sendMessage(
                    chatId,
                    `✅ <b>${this.escapeHtml(sessionName)}</b>\n\n${agentName} is ready for your command`,
                    { reply_markup: keyboard, parse_mode: 'HTML' }
                )
            } catch (error) {
                console.error(`[HAPIBot] Failed to send ready notification to chat ${chatId}:`, error)
            }
        }
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    }

    /**
     * Check if session has new permission requests and auto-approve them
     *
     * 修改说明：
     * - 自动批准所有权限请求，不再发送通知等待用户审批
     * - 只发送 Telegram 通知告知已自动批准
     */
    private checkForPermissionNotification(session: Session): void {
        const currentSession = this.getNotifiableSession(session.id)
        if (!currentSession) {
            return
        }

        // Skip notifications for Advisor sessions
        if (currentSession.metadata?.runtimeAgent === 'advisor') {
            return
        }

        const requests = currentSession.agentState?.requests

        // If requests field is undefined/null, skip - don't clear tracked state on partial updates
        if (requests == null) {
            return
        }

        const newRequestIds = new Set(Object.keys(requests))

        // Get previously known requests for this session
        const oldRequestIds = this.lastKnownRequests.get(session.id) || new Set()

        // Find NEW requests (in new but not in old)
        const newRequests: string[] = []
        for (const requestId of newRequestIds) {
            if (!oldRequestIds.has(requestId)) {
                newRequests.push(requestId)
            }
        }

        // Update tracked state for this session
        this.lastKnownRequests.set(session.id, newRequestIds)

        if (newRequests.length === 0) {
            return
        }

        // 自动批准所有新的权限请求
        this.autoApprovePermissions(currentSession.id, newRequests, requests).catch(err => {
            console.error('[HAPIBot] Failed to auto-approve permissions:', err)
        })
    }

    /**
     * 自动批准权限请求
     */
    private async autoApprovePermissions(
        sessionId: string,
        requestIds: string[],
        requests: Record<string, { tool: string; arguments: unknown }>
    ): Promise<void> {
        if (!this.syncEngine) return

        const session = this.getNotifiableSession(sessionId)
        if (!session) return

        const sessionName = session.metadata?.name || 'Unknown session'

        for (const requestId of requestIds) {
            const request = requests[requestId]
            if (!request) continue

            try {
                // 自动批准权限请求
                await this.syncEngine.approvePermission(sessionId, requestId, undefined, undefined, 'approved')
                console.log(`[HAPIBot] Auto-approved permission request ${requestId} for tool ${request.tool}`)
            } catch (error) {
                console.error(`[HAPIBot] Failed to auto-approve permission ${requestId}:`, error)
            }
        }

        // 发送 Telegram 通知（告知已自动批准）
        const recipientChatIds = this.store.getSessionNotificationRecipients(sessionId)
        if (recipientChatIds.length === 0) return

        const toolNames = requestIds.map(id => requests[id]?.tool).filter(Boolean).join(', ')
        const text = `🤖 <b>${this.escapeHtml(sessionName)}</b>\n\n` +
            `已自动批准 ${requestIds.length} 个权限请求\n` +
            `工具: ${this.escapeHtml(toolNames)}`

        for (const chatIdStr of recipientChatIds) {
            const chatId = Number(chatIdStr)
            if (!Number.isFinite(chatId)) continue

            try {
                await this.bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' })
            } catch (error) {
                console.error(`[HAPIBot] Failed to send auto-approve notification to chat ${chatId}:`, error)
            }
        }
    }

    // ========== Public API for Advisor ==========

    /**
     * Check if bot is enabled and running
     */
    isEnabled(): boolean {
        return this.isRunning
    }

    /**
     * Get bound chat IDs for a namespace
     */
    getBoundChatIds(namespace: string): number[] {
        return this.getBoundChatIdsInternal(namespace)
    }

    /**
     * Get internal bound chat IDs
     */
    private getBoundChatIdsInternal(namespace: string): number[] {
        const users = this.store.getUsersByPlatformAndNamespace('telegram', namespace)
        const ids = new Set<number>()
        for (const user of users) {
            const chatId = Number(user.platformUserId)
            if (Number.isFinite(chatId)) {
                ids.add(chatId)
            }
        }
        return Array.from(ids)
    }

    /**
     * Send a message to a chat
     */
    async sendMessageToChat(chatId: number, text: string, options?: { parse_mode?: string; reply_markup?: unknown }): Promise<void> {
        await this.bot.api.sendMessage(chatId, text, options as Parameters<typeof this.bot.api.sendMessage>[2])
    }

    /**
     * Build Mini App deep link
     */
    buildMiniAppDeepLink(startParam: string): string {
        return buildMiniAppDeepLink(this.miniAppUrl, startParam)
    }

    /**
     * Get session name by session ID
     */
    getSessionName(sessionId: string): string | null {
        const session = this.syncEngine?.getSession(sessionId)
        return session?.metadata?.name ?? null
    }

    /**
     * Send permission notification to session owner and subscribers
     * 只通知 owner 和订阅者，不再广播给所有人
     */
    private async sendPermissionNotification(sessionId: string): Promise<void> {
        const session = this.getNotifiableSession(sessionId)
        if (!session) {
            return
        }

        const text = formatSessionNotification(session)
        const keyboard = createNotificationKeyboard(session, this.miniAppUrl)

        // 只通知 owner 和订阅者
        const recipientChatIds = this.store.getSessionNotificationRecipients(sessionId)
        if (recipientChatIds.length === 0) {
            return
        }

        for (const chatIdStr of recipientChatIds) {
            const chatId = Number(chatIdStr)
            if (!Number.isFinite(chatId)) continue

            try {
                await this.bot.api.sendMessage(chatId, text, {
                    reply_markup: keyboard
                })
            } catch (error) {
                console.error(`[HAPIBot] Failed to send notification to chat ${chatId}:`, error)
            }
        }
    }
}

function buildMiniAppDeepLink(baseUrl: string, startParam: string): string {
    try {
        const url = new URL(baseUrl)
        url.searchParams.set('startapp', startParam)
        return url.toString()
    } catch {
        const separator = baseUrl.includes('?') ? '&' : '?'
        return `${baseUrl}${separator}startapp=${encodeURIComponent(startParam)}`
    }
}
