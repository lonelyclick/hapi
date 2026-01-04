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

        try {
            await webPush.sendNotification(
                pushSubscription,
                JSON.stringify(payload),
                {
                    TTL: 60 * 60 * 24, // 24 hours
                    urgency: 'high'
                }
            )
            return { success: true, shouldRemove: false }
        } catch (error: unknown) {
            const statusCode = (error as { statusCode?: number })?.statusCode
            const body = (error as { body?: string })?.body

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
        userAgent?: string
    ): StoredPushSubscription | null {
        return this.store.addOrUpdatePushSubscription(namespace, endpoint, keys, userAgent)
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
