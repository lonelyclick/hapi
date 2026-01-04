/**
 * Web Push Service
 *
 * Handles sending push notifications to subscribed clients using the Web Push Protocol.
 * Supports iOS Safari (16.4+), Chrome, Firefox, and other modern browsers.
 */

import webPush from 'web-push'
import type { Store, StoredPushSubscription } from '../store'

export interface WebPushConfig {
    vapidPublicKey: string
    vapidPrivateKey: string
    vapidSubject: string
}

export interface PushNotificationPayload {
    title: string
    body: string
    icon?: string
    badge?: string
    tag?: string
    data?: Record<string, unknown>
    actions?: Array<{
        action: string
        title: string
        icon?: string
    }>
}

export interface SendResult {
    success: number
    failed: number
    removed: number
}

export class WebPushService {
    private store: Store
    private config: WebPushConfig | null = null
    private initialized = false

    constructor(store: Store) {
        this.store = store
    }

    /**
     * Initialize the service with VAPID credentials
     */
    initialize(config: WebPushConfig): void {
        this.config = config
        webPush.setVapidDetails(
            config.vapidSubject,
            config.vapidPublicKey,
            config.vapidPrivateKey
        )
        this.initialized = true
        console.log('[webpush] initialized with VAPID subject:', config.vapidSubject)
    }

    /**
     * Check if the service is properly configured
     */
    isConfigured(): boolean {
        return this.initialized && this.config !== null
    }

    /**
     * Get the public VAPID key (needed by clients to subscribe)
     */
    getVapidPublicKey(): string | null {
        return this.config?.vapidPublicKey ?? null
    }

    /**
     * Send a push notification to all subscriptions in a namespace
     */
    async sendToNamespace(
        namespace: string,
        payload: PushNotificationPayload
    ): Promise<SendResult> {
        if (!this.isConfigured()) {
            console.warn('[webpush] not configured, skipping notification')
            return { success: 0, failed: 0, removed: 0 }
        }

        const subscriptions = this.store.getPushSubscriptions(namespace)
        if (subscriptions.length === 0) {
            console.log('[webpush] no subscriptions for namespace:', namespace)
            return { success: 0, failed: 0, removed: 0 }
        }

        console.log('[webpush] sending to', subscriptions.length, 'subscriptions in namespace:', namespace)

        const results = await Promise.allSettled(
            subscriptions.map(sub => this.sendToSubscription(sub, payload))
        )

        let success = 0
        let failed = 0
        let removed = 0

        for (let i = 0; i < results.length; i++) {
            const result = results[i]
            const sub = subscriptions[i]

            if (result.status === 'fulfilled') {
                if (result.value.success) {
                    success++
                } else if (result.value.shouldRemove) {
                    // Subscription is no longer valid, remove it
                    this.store.removePushSubscriptionById(sub.id)
                    removed++
                } else {
                    failed++
                }
            } else {
                failed++
                console.error('[webpush] unexpected error:', result.reason)
            }
        }

        console.log('[webpush] sent:', { success, failed, removed })
        return { success, failed, removed }
    }

    /**
     * Send a push notification to subscriptions for a specific client
     */
    async sendToClient(
        namespace: string,
        clientId: string,
        payload: PushNotificationPayload
    ): Promise<SendResult> {
        console.log('[webpush] sendToClient called:', { namespace, clientId })
        if (!this.isConfigured()) {
            console.warn('[webpush] not configured, skipping notification')
            return { success: 0, failed: 0, removed: 0 }
        }

        const subscriptions = this.store.getPushSubscriptionsByClientId(namespace, clientId)
        console.log('[webpush] found subscriptions for client:', clientId, subscriptions.map(s => ({
            id: s.id,
            endpoint: s.endpoint.slice(0, 60) + '...',
            userAgent: s.userAgent?.slice(0, 50)
        })))
        if (subscriptions.length === 0) {
            console.log('[webpush] no subscriptions for client:', clientId)
            return { success: 0, failed: 0, removed: 0 }
        }

        console.log('[webpush] sending to', subscriptions.length, 'subscriptions for client:', clientId)

        const results = await Promise.allSettled(
            subscriptions.map(sub => this.sendToSubscription(sub, payload))
        )

        let success = 0
        let failed = 0
        let removed = 0

        for (let i = 0; i < results.length; i++) {
            const result = results[i]
            const sub = subscriptions[i]

            if (result.status === 'fulfilled') {
                if (result.value.success) {
                    success++
                } else if (result.value.shouldRemove) {
                    this.store.removePushSubscriptionById(sub.id)
                    removed++
                } else {
                    failed++
                }
            } else {
                failed++
                console.error('[webpush] unexpected error:', result.reason)
            }
        }

        console.log('[webpush] sent to client:', { clientId, success, failed, removed })
        return { success, failed, removed }
    }

    /**
     * Send a push notification to a specific subscription
     */
    async sendToSubscription(
        subscription: StoredPushSubscription,
        payload: PushNotificationPayload
    ): Promise<{ success: boolean; shouldRemove: boolean }> {
        const pushSubscription = {
            endpoint: subscription.endpoint,
            keys: subscription.keys
        }

        console.log('[webpush] sendToSubscription:', {
            subscriptionId: subscription.id,
            endpoint: subscription.endpoint.slice(0, 80) + '...',
            payload: { title: payload.title, body: payload.body?.slice(0, 50) }
        })

        try {
            const result = await webPush.sendNotification(
                pushSubscription,
                JSON.stringify(payload),
                {
                    TTL: 60 * 60 * 24, // 24 hours
                    urgency: 'high'
                }
            )
            console.log('[webpush] send success:', {
                subscriptionId: subscription.id,
                statusCode: result.statusCode,
                headers: result.headers
            })
            return { success: true, shouldRemove: false }
        } catch (error: unknown) {
            const statusCode = (error as { statusCode?: number })?.statusCode
            const body = (error as { body?: string })?.body
            const message = (error as Error)?.message

            console.error('[webpush] send error details:', {
                subscriptionId: subscription.id,
                endpoint: subscription.endpoint.slice(0, 50) + '...',
                statusCode,
                body,
                message
            })

            // 404 or 410: Subscription has expired or been unsubscribed
            if (statusCode === 404 || statusCode === 410) {
                console.log('[webpush] subscription expired, removing:', subscription.endpoint.slice(0, 50))
                return { success: false, shouldRemove: true }
            }

            // 429: Too many requests
            if (statusCode === 429) {
                console.warn('[webpush] rate limited:', subscription.endpoint.slice(0, 50))
                return { success: false, shouldRemove: false }
            }

            // Other errors
            console.error('[webpush] send error:', statusCode, body)
            return { success: false, shouldRemove: false }
        }
    }

    /**
     * Subscribe a client to push notifications
     */
    subscribe(
        namespace: string,
        endpoint: string,
        keys: { p256dh: string; auth: string },
        userAgent?: string,
        clientId?: string,
        chatId?: string
    ): StoredPushSubscription | null {
        return this.store.addOrUpdatePushSubscription(namespace, endpoint, keys, userAgent, clientId, chatId)
    }

    /**
     * Get subscriptions for a specific client
     */
    getSubscriptionsByClientId(namespace: string, clientId: string): StoredPushSubscription[] {
        return this.store.getPushSubscriptionsByClientId(namespace, clientId)
    }

    /**
     * Send push notifications to all subscriptions for specified chat IDs
     * Used for sending notifications to session owner/subscribers
     */
    async sendToChatIds(
        namespace: string,
        chatIds: string[],
        payload: PushNotificationPayload
    ): Promise<SendResult> {
        console.log('[webpush] sendToChatIds called:', { namespace, chatIds })
        if (!this.isConfigured()) {
            console.warn('[webpush] not configured, skipping notification')
            return { success: 0, failed: 0, removed: 0 }
        }

        if (chatIds.length === 0) {
            console.log('[webpush] no chatIds provided')
            return { success: 0, failed: 0, removed: 0 }
        }

        // Collect all subscriptions for all chatIds
        const allSubscriptions: StoredPushSubscription[] = []
        const seenEndpoints = new Set<string>()

        for (const chatId of chatIds) {
            const subs = this.store.getPushSubscriptionsByChatId(namespace, chatId)
            console.log('[webpush] subscriptions for chatId:', chatId, subs.length)
            for (const sub of subs) {
                if (!seenEndpoints.has(sub.endpoint)) {
                    seenEndpoints.add(sub.endpoint)
                    allSubscriptions.push(sub)
                }
            }
        }

        if (allSubscriptions.length === 0) {
            console.log('[webpush] no subscriptions for chatIds:', chatIds)
            return { success: 0, failed: 0, removed: 0 }
        }

        console.log('[webpush] sending to', allSubscriptions.length, 'subscriptions for chatIds:', chatIds)

        const results = await Promise.allSettled(
            allSubscriptions.map(sub => this.sendToSubscription(sub, payload))
        )

        let success = 0
        let failed = 0
        let removed = 0

        for (let i = 0; i < results.length; i++) {
            const result = results[i]
            const sub = allSubscriptions[i]

            if (result.status === 'fulfilled') {
                if (result.value.success) {
                    success++
                } else if (result.value.shouldRemove) {
                    this.store.removePushSubscriptionById(sub.id)
                    removed++
                } else {
                    failed++
                }
            } else {
                failed++
                console.error('[webpush] unexpected error:', result.reason)
            }
        }

        console.log('[webpush] sent to chatIds:', { chatIds, success, failed, removed })
        return { success, failed, removed }
    }

    /**
     * Unsubscribe a client from push notifications
     */
    unsubscribe(endpoint: string): boolean {
        return this.store.removePushSubscription(endpoint)
    }

    /**
     * Get all subscriptions for a namespace
     */
    getSubscriptions(namespace: string): StoredPushSubscription[] {
        return this.store.getPushSubscriptions(namespace)
    }
}

// Singleton instance
let instance: WebPushService | null = null

export function getWebPushService(): WebPushService | null {
    return instance
}

export function initWebPushService(store: Store, config: WebPushConfig | null): WebPushService {
    instance = new WebPushService(store)
    if (config) {
        instance.initialize(config)
    }
    return instance
}
