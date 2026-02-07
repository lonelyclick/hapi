/**
 * Brain Review Worker - Detached 独立进程
 *
 * 由 server 通过 spawn({ detached: true }) 启动，独立于 server 进程运行。
 * 即使 server 重启，worker 和它 spawn 的 claude 子进程也不受影响。
 *
 * 输入：process.argv[2] = JSON 配置
 * 输出：进度和结果直接写 DB，完成后通过 HTTP 回调通知 server
 */

import { Pool } from 'pg'
import { BrainStore } from '../store'
import { executeBrainQuery } from '../sdkAdapter'

interface WorkerConfig {
    executionId: string
    brainSessionId: string
    mainSessionId: string
    prompt: string
    projectPath: string
    model: string
    systemPrompt: string
    serverCallbackUrl: string
    serverToken: string
    phase?: 'review' | 'refine'
    refineSentFrom?: 'webapp' | 'brain-review'
}

// 解析配置
const configJson = process.argv[2]
if (!configJson) {
    console.error('[BrainWorker] Missing config argument')
    process.exit(1)
}

let config: WorkerConfig
try {
    config = JSON.parse(configJson)
} catch (e) {
    console.error('[BrainWorker] Invalid config JSON:', e)
    process.exit(1)
}

const phase = config.phase || 'review'
console.log(`[BrainWorker] Starting worker PID=${process.pid} phase=${phase} for execution=${config.executionId}`)

// 连接 PostgreSQL（从环境变量读取，spawn 时继承自 server）
const pool = new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'hapi',
    ssl: process.env.PG_SSL === 'true'
})

const brainStore = new BrainStore(pool)

// 中止控制器
const abortController = new AbortController()

// 心跳定时器
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

// SIGTERM 优雅退出
process.on('SIGTERM', () => {
    console.log('[BrainWorker] Received SIGTERM, aborting...')
    abortController.abort()
})

// 通知 server 的 HTTP 回调（带重试）
async function notifyServer(body: Record<string, unknown>): Promise<void> {
    const delays = [1000, 3000, 10000]
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
            const res = await fetch(`${config.serverCallbackUrl}/api/brain/worker-callback`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Worker-Secret': config.serverToken
                },
                body: JSON.stringify(body)
            })
            if (res.ok) {
                console.log('[BrainWorker] Server callback succeeded')
                return
            }
            console.warn(`[BrainWorker] Server callback HTTP ${res.status}`)
        } catch (err) {
            console.warn(`[BrainWorker] Server callback attempt ${attempt + 1} failed:`, (err as Error).message)
        }
        if (attempt < delays.length) {
            await new Promise(r => setTimeout(r, delays[attempt]))
        }
    }
    console.error('[BrainWorker] All server callback attempts failed (data is in DB)')
}

async function run(): Promise<void> {
    const isRefine = phase === 'refine'
    console.log(`[BrainWorker] run() phase=${phase} model=${config.model} cwd=${config.projectPath} promptLen=${config.prompt.length} executionId=${config.executionId}`)

    // refine 阶段不需要 execution 记录
    if (!isRefine) {
        await brainStore.updateExecutionWorkerPid(config.executionId, process.pid)
        heartbeatTimer = setInterval(() => {
            brainStore.updateExecutionHeartbeat(config.executionId).catch(() => {})
        }, 30_000)
    }

    // refine 阶段设置 60 秒超时，防止 SDK 启动慢导致卡死
    if (isRefine) {
        setTimeout(() => {
            if (!abortController.signal.aborted) {
                console.error('[BrainWorker] Refine timeout (60s), aborting...')
                abortController.abort()
            }
        }, 60_000)
    }

    // 收集输出
    const outputChunks: string[] = []
    let lastToolEntryId: string | null = null

    try {
        await executeBrainQuery(
            config.prompt,
            {
                cwd: config.projectPath,
                model: config.model,
                systemPrompt: config.systemPrompt,
                maxTurns: isRefine ? 3 : 30,
                tools: ['Read', 'Grep', 'Glob'],
                allowedTools: ['Read', 'Grep', 'Glob'],
                disallowedTools: ['Bash', 'Edit', 'Write', 'Task'],
                permissionMode: 'dontAsk',
                abortController
            },
            {
                onAssistantMessage: (message) => {
                    outputChunks.push(message.content)
                    if (!isRefine) {
                        const entry = {
                            id: `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            type: 'assistant-message',
                            content: message.content,
                            timestamp: Date.now()
                        }
                        brainStore.appendProgressLog(config.executionId, entry).catch(err => {
                            console.error('[BrainWorker] Failed to append progress log:', err.message)
                        })
                    }
                },
                onToolUse: (toolName, input) => {
                    lastToolEntryId = `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
                    if (!isRefine) {
                        const entry = {
                            id: lastToolEntryId,
                            type: 'tool-use',
                            content: toolName,
                            toolName,
                            toolInput: input,
                            timestamp: Date.now()
                        }
                        brainStore.appendProgressLog(config.executionId, entry).catch(err => {
                            console.error('[BrainWorker] Failed to append progress log:', err.message)
                        })
                    }
                },
                onToolResult: (_toolName, result) => {
                    if (result === undefined || !lastToolEntryId) return
                    if (!isRefine) {
                        const entry = {
                            id: `${lastToolEntryId}-result`,
                            type: 'tool-result',
                            content: typeof result === 'string' ? result : JSON.stringify(result),
                            toolEntryId: lastToolEntryId,
                            timestamp: Date.now()
                        }
                        brainStore.appendProgressLog(config.executionId, entry).catch(err => {
                            console.error('[BrainWorker] Failed to append progress log:', err.message)
                        })
                    }
                },
                onProgress: () => {
                    if (!isRefine) {
                        brainStore.updateExecutionHeartbeat(config.executionId).catch(() => {})
                    }
                }
            }
        )

        // 完成
        const output = outputChunks.join('\n\n')
        console.log(`[BrainWorker] ${phase} completed, output length:`, output.length)

        if (!isRefine) {
            await brainStore.appendProgressLog(config.executionId, {
                id: `sdk-${Date.now()}-done`,
                type: 'done',
                content: '',
                timestamp: Date.now()
            }).catch(() => {})
            await brainStore.completeBrainExecution(config.executionId, output)
        }

        // 通知 server
        await notifyServer({
            executionId: config.executionId,
            brainSessionId: config.brainSessionId,
            mainSessionId: config.mainSessionId,
            status: 'completed',
            output,
            phase,
            ...(config.refineSentFrom ? { refineSentFrom: config.refineSentFrom } : {})
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const stack = error instanceof Error ? error.stack : ''
        const isAbort = (error as Error).name === 'AbortError' || message === 'Aborted by user'

        console.error(`[BrainWorker] ${phase} FAILED: ${message}`)
        if (stack) console.error(`[BrainWorker] Stack: ${stack}`)

        if (!isRefine) {
            await brainStore.failBrainExecution(
                config.executionId,
                isAbort ? 'Aborted' : message
            )
        }

        await notifyServer({
            executionId: config.executionId,
            brainSessionId: config.brainSessionId,
            mainSessionId: config.mainSessionId,
            status: 'failed',
            error: isAbort ? 'Aborted' : message,
            phase,
            ...(config.refineSentFrom ? { refineSentFrom: config.refineSentFrom } : {}),
            ...(phase === 'refine' ? { originalPrompt: config.prompt } : {})
        })
    }
}

run()
    .catch(err => {
        console.error('[BrainWorker] Fatal error:', err)
    })
    .finally(() => {
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        pool.end().catch(() => {})
        // 延迟退出，确保日志刷新
        setTimeout(() => process.exit(0), 500)
    })
