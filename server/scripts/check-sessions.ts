#!/usr/bin/env bun
import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dbPath = join(homedir(), '.hapi', 'hapi.db')
const db = new Database(dbPath)

// 查找日志中提到的 session IDs
const sessionIds = [
    '28abf4db-5d0e-4a66-bc81-b203038e2144',
    '9f304642-7a7b-46bb-a66c-f11938468994',
    '2d739b47-54fd-4e77-b3c0-643d46245982'
]

console.log('Checking specific session IDs from daemon log:')
for (const id of sessionIds) {
    const session = db.query<{ id: string; tag: string | null }, [string]>('SELECT id, tag FROM sessions WHERE id = ?').get(id)
    const messageCount = db.query<{ cnt: number }, [string]>('SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?').get(id)
    console.log(`  ${id.slice(0, 8)}: exists=${!!session}, messages=${messageCount?.cnt ?? 0}`)
}

// 查看所有 sessions 的 tag
console.log('\nAll sessions in database:')
const allSessions = db.query<{ id: string; tag: string | null }, []>('SELECT id, tag FROM sessions').all()
for (const s of allSessions) {
    console.log(`  ${s.id} | tag: ${s.tag}`)
}

// 对比 messages 表中的 session_ids
console.log('\nAll unique session_ids in messages table:')
const messageSessionIds = db.query<{ session_id: string; cnt: number }, []>('SELECT session_id, COUNT(*) as cnt FROM messages GROUP BY session_id ORDER BY cnt DESC').all()
for (const m of messageSessionIds) {
    const existsInSessions = allSessions.some(s => s.id === m.session_id)
    console.log(`  ${m.session_id} | ${m.cnt} msgs | in sessions: ${existsInSessions}`)
}

db.close()
