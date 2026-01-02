import type { SyncEvent, OnlineUser } from '../sync/syncEngine'

export type SSESubscription = {
    id: string
    namespace: string
    all: boolean
    sessionId: string | null
    machineId: string | null
    email?: string
    clientId?: string
    deviceType?: string
}

type SSEConnection = SSESubscription & {
    send: (event: SyncEvent) => void | Promise<void>
    sendHeartbeat: () => void | Promise<void>
}

export class SSEManager {
    private readonly connections: Map<string, SSEConnection> = new Map()
    private heartbeatTimer: NodeJS.Timeout | null = null
    private readonly heartbeatMs: number

    constructor(heartbeatMs = 30_000) {
        this.heartbeatMs = heartbeatMs
    }

    subscribe(options: {
        id: string
        namespace: string
        all?: boolean
        sessionId?: string | null
        machineId?: string | null
        email?: string
        clientId?: string
        deviceType?: string
        send: (event: SyncEvent) => void | Promise<void>
        sendHeartbeat: () => void | Promise<void>
    }): SSESubscription {
        const subscription: SSEConnection = {
            id: options.id,
            namespace: options.namespace,
            all: Boolean(options.all),
            sessionId: options.sessionId ?? null,
            machineId: options.machineId ?? null,
            email: options.email,
            clientId: options.clientId,
            deviceType: options.deviceType,
            send: options.send,
            sendHeartbeat: options.sendHeartbeat
        }

        this.connections.set(subscription.id, subscription)
        this.ensureHeartbeat()

        // 广播在线用户更新
        this.broadcastOnlineUsers(options.namespace)

        return {
            id: subscription.id,
            namespace: subscription.namespace,
            all: subscription.all,
            sessionId: subscription.sessionId,
            machineId: subscription.machineId,
            email: subscription.email,
            clientId: subscription.clientId,
            deviceType: subscription.deviceType
        }
    }

    unsubscribe(id: string): void {
        const connection = this.connections.get(id)
        const namespace = connection?.namespace
        this.connections.delete(id)
        if (this.connections.size === 0) {
            this.stopHeartbeat()
        }
        // 广播在线用户更新
        if (namespace) {
            this.broadcastOnlineUsers(namespace)
        }
    }

    broadcast(event: SyncEvent): void {
        for (const connection of this.connections.values()) {
            if (!this.shouldSend(connection, event)) {
                continue
            }

            void Promise.resolve(connection.send(event)).catch(() => {
                this.unsubscribe(connection.id)
            })
        }
    }

    stop(): void {
        this.stopHeartbeat()
        this.connections.clear()
    }

    private ensureHeartbeat(): void {
        if (this.heartbeatTimer || this.heartbeatMs <= 0) {
            return
        }

        this.heartbeatTimer = setInterval(() => {
            for (const connection of this.connections.values()) {
                void Promise.resolve(connection.sendHeartbeat()).catch(() => {
                    this.unsubscribe(connection.id)
                })
            }
        }, this.heartbeatMs)
    }

    private stopHeartbeat(): void {
        if (!this.heartbeatTimer) {
            return
        }

        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
    }

    private shouldSend(connection: SSEConnection, event: SyncEvent): boolean {
        if (event.type !== 'connection-changed') {
            const eventNamespace = event.namespace
            if (!eventNamespace || eventNamespace !== connection.namespace) {
                return false
            }
        }

        if (event.type === 'message-received') {
            return Boolean(event.sessionId && connection.sessionId === event.sessionId)
        }

        if (event.type === 'connection-changed') {
            return true
        }

        if (connection.all) {
            return true
        }

        if (event.sessionId && connection.sessionId === event.sessionId) {
            return true
        }

        if (event.machineId && connection.machineId === event.machineId) {
            return true
        }

        return false
    }

    /**
     * 获取指定 namespace 的所有在线用户
     */
    getOnlineUsers(namespace: string): OnlineUser[] {
        const usersMap = new Map<string, OnlineUser>()  // 用 clientId 去重

        for (const conn of this.connections.values()) {
            if (conn.namespace !== namespace) continue
            if (!conn.email || !conn.clientId) continue

            // 用 clientId 作为 key，如果有多个连接（如多个 tab），取最新的
            usersMap.set(conn.clientId, {
                email: conn.email,
                clientId: conn.clientId,
                deviceType: conn.deviceType,
                sessionId: conn.sessionId
            })
        }

        return Array.from(usersMap.values())
    }

    /**
     * 获取指定 session 的所有查看者
     */
    getSessionViewers(namespace: string, sessionId: string): OnlineUser[] {
        const usersMap = new Map<string, OnlineUser>()

        for (const conn of this.connections.values()) {
            if (conn.namespace !== namespace) continue
            if (conn.sessionId !== sessionId) continue
            if (!conn.email || !conn.clientId) continue

            usersMap.set(conn.clientId, {
                email: conn.email,
                clientId: conn.clientId,
                deviceType: conn.deviceType,
                sessionId: conn.sessionId
            })
        }

        return Array.from(usersMap.values())
    }

    /**
     * 广播在线用户更新事件
     */
    private broadcastOnlineUsers(namespace: string): void {
        const onlineUsers = this.getOnlineUsers(namespace)
        const event: SyncEvent = {
            type: 'online-users-changed',
            namespace,
            users: onlineUsers
        }

        for (const connection of this.connections.values()) {
            if (connection.namespace !== namespace) continue
            if (!connection.all) continue  // 只给订阅 all 的连接发送

            void Promise.resolve(connection.send(event)).catch(() => {
                this.unsubscribe(connection.id)
            })
        }
    }
}
