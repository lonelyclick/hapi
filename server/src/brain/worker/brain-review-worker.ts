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

console.log(`[BrainWorker] Starting worker PID=${process.pid} for execution=${config.executionId}`)

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
    // 注册 PID 和初始心跳
    await brainStore.updateExecutionWorkerPid(config.executionId, process.pid)

    // 心跳定时器：每 30 秒更新
    heartbeatTimer = setInterval(() => {
        brainStore.updateExecutionHeartbeat(config.executionId).catch(() => {})
    }, 30_000)

    // 收集输出
    const outputChunks: string[] = []

    try {
        await executeBrainQuery(
            config.prompt,
            {
                cwd: config.projectPath,
                model: config.model,
                systemPrompt: config.systemPrompt,
                maxTurns: 30,
                tools: ['Read', 'Grep', 'Glob'],
                allowedTools: ['Read', 'Grep', 'Glob'],
                disallowedTools: ['Bash', 'Edit', 'Write', 'Task'],
                permissionMode: 'dontAsk',
                abortController
            },
            {
                onAssistantMessage: (message) => {
                    outputChunks.push(message.content)
                    const entry = {
                        id: `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        type: 'assistant-message',
                        content: message.content,
                        timestamp: Date.now()
                    }
                    brainStore.appendProgressLog(config.executionId, entry).catch(err => {
                        console.error('[BrainWorker] Failed to append progress log:', err.message)
                    })
                },
                onToolUse: (toolName, input) => {
                    const entry = {
                        id: `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        type: 'tool-use',
                        content: toolName,
                        toolName,
                        toolInput: input,
                        timestamp: Date.now()
                    }
                    brainStore.appendProgressLog(config.executionId, entry).catch(err => {
                        console.error('[BrainWorker] Failed to append progress log:', err.message)
                    })
                },
                onProgress: () => {
                    // 更新心跳
                    brainStore.updateExecutionHeartbeat(config.executionId).catch(() => {})
                }
            }
        )

        // 完成
        const output = outputChunks.join('\n\n')
        console.log('[BrainWorker] Review completed, output length:', output.length)

        // 写 done 日志
        await brainStore.appendProgressLog(config.executionId, {
            id: `sdk-${Date.now()}-done`,
            type: 'done',
            content: '',
            timestamp: Date.now()
        }).catch(() => {})

        // 标记完成
        await brainStore.completeBrainExecution(config.executionId, output)

        // 通知 server
        await notifyServer({
            executionId: config.executionId,
            brainSessionId: config.brainSessionId,
            mainSessionId: config.mainSessionId,
            status: 'completed',
            output
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const isAbort = (error as Error).name === 'AbortError' || message === 'Aborted by user'

        console.error('[BrainWorker] Review failed:', message)

        await brainStore.failBrainExecution(
            config.executionId,
            isAbort ? 'Aborted' : message
        )

        await notifyServer({
            executionId: config.executionId,
            brainSessionId: config.brainSessionId,
            mainSessionId: config.mainSessionId,
            status: 'failed',
            error: isAbort ? 'Aborted' : message
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
