#!/usr/bin/env bun
import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { statSync } from 'node:fs'

const dbPath = join(homedir(), '.hapi', 'hapi.db')

// 显示数据库文件大小
const stat = statSync(dbPath)
console.log(`Database: ${dbPath}`)
console.log(`Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB\n`)

const db = new Database(dbPath)

// 查询表结构和统计
const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'").all()
console.log('Tables:', tables.map(t => t.name).join(', '))

const sessionCount = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM sessions').get()
const messageCount = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM messages').get()
console.log(`Sessions: ${sessionCount?.count}, Messages: ${messageCount?.count}\n`)

// 查询 messages 按 session_id 分组
const messageBySessions = db.query<{ session_id: string; cnt: number }, []>(`
    SELECT session_id, COUNT(*) as cnt FROM messages GROUP BY session_id ORDER BY cnt DESC
`).all()
console.log(`Distinct session_ids in messages: ${messageBySessions.length}`)
console.log('Top session_ids by message count:')
for (const m of messageBySessions.slice(0, 10)) {
    console.log(`  ${m.session_id.slice(0, 12)}... : ${m.cnt} messages`)
}

// 查找孤儿消息（messages 中存在但 sessions 中不存在的 session_id）
const orphanMessages = db.query<{ session_id: string; cnt: number }, []>(`
    SELECT m.session_id, COUNT(*) as cnt
    FROM messages m
    LEFT JOIN sessions s ON m.session_id = s.id
    WHERE s.id IS NULL
    GROUP BY m.session_id
    ORDER BY cnt DESC
`).all()
console.log(`\nOrphan session_ids (in messages but not in sessions): ${orphanMessages.length}`)
if (orphanMessages.length > 0) {
    const totalOrphanMessages = orphanMessages.reduce((acc, m) => acc + m.cnt, 0)
    console.log(`Total orphan messages: ${totalOrphanMessages}`)
}

// 查询所有 namespaces
const namespaces = db.query<{ namespace: string; cnt: number }, []>(`
    SELECT namespace, COUNT(*) as cnt FROM sessions GROUP BY namespace
`).all()
console.log('Namespaces:', namespaces.map(n => `${n.namespace}(${n.cnt})`).join(', '))

type SessionRow = {
    id: string
    tag: string | null
    active: number
    active_at: number | null
    updated_at: number
    created_at: number
    metadata: string | null
    namespace: string
}

// 查询所有 session
const sessions = db.query<SessionRow, []>(`
    SELECT
        id,
        tag,
        active,
        active_at,
        updated_at,
        created_at,
        metadata,
        namespace
    FROM sessions
    ORDER BY active DESC, updated_at DESC
`).all()

console.log(`\nTotal sessions: ${sessions.length}`)

const activeSessions = sessions.filter(s => s.active === 1)
const inactiveSessions = sessions.filter(s => s.active === 0)

console.log(`\n=== Active Sessions (${activeSessions.length}) ===`)
for (const s of activeSessions.slice(0, 20)) {
    let path = ''
    let lifecycleState = ''
    try {
        const meta = JSON.parse(s.metadata || '{}')
        path = meta.path || ''
        lifecycleState = meta.lifecycleState || ''
    } catch {}
    const activeAgo = s.active_at ? Math.round((Date.now() - s.active_at) / 1000) : 'N/A'
    const shortId = s.id.slice(0, 8)
    const shortPath = path.length > 50 ? '...' + path.slice(-47) : path.padStart(50)
    console.log(`  ${shortId} | ns:${s.namespace.padEnd(10)} | ${shortPath} | ${activeAgo}s ago | ${lifecycleState}`)
}
if (activeSessions.length > 20) {
    console.log(`  ... and ${activeSessions.length - 20} more`)
}

console.log(`\n=== Inactive Sessions (${inactiveSessions.length}) ===`)
for (const s of inactiveSessions.slice(0, 30)) {
    let path = ''
    let lifecycleState = ''
    try {
        const meta = JSON.parse(s.metadata || '{}')
        path = meta.path || ''
        lifecycleState = meta.lifecycleState || ''
    } catch {}
    const updatedAgo = Math.round((Date.now() - s.updated_at) / 1000 / 60)
    const shortId = s.id.slice(0, 8)
    const shortPath = path.length > 50 ? '...' + path.slice(-47) : path.padStart(50)
    console.log(`  ${shortId} | ns:${s.namespace.padEnd(10)} | ${shortPath} | ${updatedAgo}min ago | ${lifecycleState}`)
}
if (inactiveSessions.length > 30) {
    console.log(`  ... and ${inactiveSessions.length - 30} more`)
}

db.close()
