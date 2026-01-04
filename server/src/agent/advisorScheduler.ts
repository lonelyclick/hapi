/**
 * AdvisorScheduler - 保证 Advisor 会话常驻
 */

import { randomUUID } from 'node:crypto'
import type { SyncEngine, Machine, Session } from '../sync/syncEngine'
import type { Store } from '../store'
import { buildAdvisorInitPrompt } from './advisorPrompt'

export interface AdvisorSchedulerConfig {
    namespace: string
    restartDelayMs?: number
    initPromptSent?: Set<string>  // 跟踪已发送 init prompt 的 sessionId
}

export class AdvisorScheduler {
    private syncEngine: SyncEngine
    private store: Store
    private namespace: string
    private advisorSessionId: string | null = null
    private restartTimer: NodeJS.Timeout | null = null
    private restartDelayMs: number
    private initPromptSent: Set<string>
    private isStarting = false
    private unsubscribe: (() => void) | null = null

    constructor(
        syncEngine: SyncEngine,
        store: Store,
        config: AdvisorSchedulerConfig
    ) {
        this.syncEngine = syncEngine
        this.store = store
        this.namespace = config.namespace
        this.restartDelayMs = config.restartDelayMs ?? 5000
        this.initPromptSent = config.initPromptSent ?? new Set()
    }

    async start(): Promise<void> {
        if (this.isStarting) {
            console.log('[AdvisorScheduler] Already starting, skip')
            return
        }

        this.isStarting = true

        try {
            // 1. 从 agent_state 读取或生成 advisor_session_id
            const state = this.store.getAdvisorState(this.namespace)
            this.advisorSessionId = state?.advisorSessionId || `advisor-${randomUUID().slice(0, 8)}`

            // 2. 选择在线机器
            const machine = this.selectMachine()
            if (!machine) {
                console.log('[AdvisorScheduler] No online machine found, scheduling retry')
                this.scheduleRestart()
                return
            }

            // 3. 检查是否已有运行中的 Advisor 会话
            const existingSession = this.syncEngine.getSession(this.advisorSessionId)
            if (existingSession?.active) {
                console.log(`[AdvisorScheduler] Advisor session ${this.advisorSessionId} already running`)
                // 更新状态
                this.store.upsertAdvisorState(this.namespace, {
                    advisorSessionId: this.advisorSessionId,
                    machineId: machine.id,
                    status: 'running',
                    lastSeen: Date.now()
                })
                return
            }

            // 4. 获取 advisorWorkingDir
            const workingDir = (machine.metadata as Record<string, unknown>)?.advisorWorkingDir as string
                || '/home/guang/softwares/hapi'

            console.log(`[AdvisorScheduler] Spawning advisor session on machine ${machine.id}, workingDir: ${workingDir}`)

            // 5. Spawn 新会话
            const spawnResult = await this.syncEngine.spawnSession(
                machine.id,
                workingDir,
                'claude',
                false,  // yolo
                'simple',  // sessionType
                undefined,  // worktreeName
                {
                    sessionId: this.advisorSessionId,
                    claudeAgent: 'advisor',
                    permissionMode: 'acceptEdits'
                }
            )

            if (spawnResult.type !== 'success') {
                console.error('[AdvisorScheduler] Failed to spawn advisor session:', spawnResult.message)
                this.store.upsertAdvisorState(this.namespace, {
                    advisorSessionId: this.advisorSessionId,
                    machineId: machine.id,
                    status: 'error'
                })
                this.scheduleRestart()
                return
            }

            // 使用实际返回的 sessionId（可能与请求的不同）
            this.advisorSessionId = spawnResult.sessionId
            console.log(`[AdvisorScheduler] Advisor session spawned: ${this.advisorSessionId}`)

            // 6. 发送 init prompt（仅在首次）
            // 等待 CLI 完全连接（CLI 可能需要一点时间来加入 Socket.IO room）
            if (!this.initPromptSent.has(this.advisorSessionId)) {
                await new Promise(resolve => setTimeout(resolve, 2000))
                await this.sendInitPrompt(workingDir)
                this.initPromptSent.add(this.advisorSessionId)
            }

            // 7. 更新 agent_state
            this.store.upsertAdvisorState(this.namespace, {
                advisorSessionId: this.advisorSessionId,
                machineId: machine.id,
                status: 'running',
                lastSeen: Date.now()
            })

            // 8. 订阅会话结束事件
            this.subscribeToSessionEnd()

        } finally {
            this.isStarting = false
        }
    }

    stop(): void {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer)
            this.restartTimer = null
        }
        if (this.unsubscribe) {
            this.unsubscribe()
            this.unsubscribe = null
        }
    }

    getAdvisorSessionId(): string | null {
        return this.advisorSessionId
    }

    isAdvisorSession(sessionId: string): boolean {
        if (sessionId === this.advisorSessionId) {
            return true
        }
        // 也检查会话 metadata
        const session = this.syncEngine.getSession(sessionId)
        const metadata = session?.metadata as Record<string, unknown> | null
        return metadata?.claudeAgent === 'advisor' || metadata?.isAdvisor === true
    }

    private selectMachine(): Machine | null {
        const machines = this.syncEngine.getOnlineMachinesByNamespace(this.namespace)
        if (machines.length === 0) {
            return null
        }
        // 当前只有一台机器，直接返回第一个
        return machines[0]
    }

    private async sendInitPrompt(workingDir: string): Promise<void> {
        if (!this.advisorSessionId) {
            return
        }

        try {
            const activeSessionCount = this.syncEngine.getActiveSessions()
                .filter(s => s.namespace === this.namespace && !this.isAdvisorSession(s.id))
                .length

            const prompt = await buildAdvisorInitPrompt({
                namespace: this.namespace,
                workingDir,
                activeSessionCount
            })

            await this.syncEngine.sendMessage(this.advisorSessionId, {
                text: prompt,
                sentFrom: 'webapp'
            })

            console.log('[AdvisorScheduler] Init prompt sent to advisor session')
        } catch (error) {
            console.error('[AdvisorScheduler] Failed to send init prompt:', error)
        }
    }

    private subscribeToSessionEnd(): void {
        if (this.unsubscribe) {
            return  // 已经订阅
        }

        this.unsubscribe = this.syncEngine.subscribe((event) => {
            if (event.type === 'session-updated' && event.sessionId === this.advisorSessionId) {
                const session = this.syncEngine.getSession(this.advisorSessionId!)
                if (session && !session.active) {
                    console.log('[AdvisorScheduler] Advisor session went offline, scheduling restart')
                    this.onSessionEnd(this.advisorSessionId!)
                }
            }
        })
    }

    onSessionEnd(sessionId: string): void {
        if (sessionId === this.advisorSessionId) {
            console.log(`[AdvisorScheduler] Advisor session ${sessionId} ended, scheduling restart`)
            this.store.upsertAdvisorState(this.namespace, {
                status: 'idle',
                lastSeen: Date.now()
            })
            this.scheduleRestart()
        }
    }

    private scheduleRestart(): void {
        if (this.restartTimer) {
            return  // 已经有计划的重启
        }

        this.restartTimer = setTimeout(() => {
            this.restartTimer = null
            this.start().catch(error => {
                console.error('[AdvisorScheduler] Restart failed:', error)
                this.scheduleRestart()
            })
        }, this.restartDelayMs)
    }
}
