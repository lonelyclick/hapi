#!/usr/bin/env bun
/**
 * 直接从运行中的 server 获取内存中的 session 状态
 * 通过 Socket.IO 连接
 */
import { io } from '../../cli/node_modules/socket.io-client'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 读取配置
const settingsPath = join(homedir(), '.hapi', 'settings.json')
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
const token = settings.cliApiToken
const port = settings.webappPort || 3006

console.log(`Connecting to localhost:${port}...`)

const socket = io(`http://localhost:${port}/cli`, {
    auth: { token: `${token}:default` },
    transports: ['websocket']
})

socket.on('connect', () => {
    console.log('Connected!\n')

    // 请求 session 列表
    socket.emit('list-sessions', {}, (response: unknown) => {
        console.log('Sessions from SyncEngine:')
        console.log(JSON.stringify(response, null, 2))
        socket.disconnect()
        process.exit(0)
    })
})

socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message)
    process.exit(1)
})

// 超时
setTimeout(() => {
    console.error('Timeout waiting for response')
    socket.disconnect()
    process.exit(1)
}, 5000)
