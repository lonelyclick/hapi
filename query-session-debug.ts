#!/usr/bin/env -S /home/guang/.bun/bin/bun
import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dbPath = join(homedir(), '.hapi', 'hapi.db')
const db = new Database(dbPath)

const targetSessionId = '4f05d6a0-d51b-4699-a640-6c263b2870bd'

// 查询session详情
const session = db.query('SELECT * FROM sessions WHERE id = ?').get(targetSessionId)
if (!session) {
  console.log('❌ Session not found:', targetSessionId)
  process.exit(1)
}

console.log('📋 Session Details:')
console.log('ID:', session.id)
console.log('Namespace:', session.namespace)
console.log('Active:', session.active === 1 ? '✅ YES' : '❌ NO')
console.log('Active At:', session.active_at ? new Date(session.active_at).toISOString() : 'N/A')
console.log('Created At:', new Date(session.created_at).toISOString())
console.log('Updated At:', new Date(session.updated_at).toISOString())

// 解析metadata
let metadata = null
try {
  metadata = JSON.parse(session.metadata || '{}')
  console.log('\n📝 Metadata:')
  console.log('Path:', metadata.path || 'N/A')
  console.log('Flavor:', metadata.flavor || 'N/A')
  console.log('Machine ID:', metadata.machineId || 'N/A')
  console.log('Lifecycle State:', metadata.lifecycleState || 'N/A')
  console.log('Runtime Agent:', metadata.runtimeAgent || 'N/A')
  console.log('Runtime Model:', metadata.runtimeModel || 'N/A')
} catch (e) {
  console.log('Metadata:', session.metadata)
}

// 查询agent_state
console.log('\n🤖 Agent State:')
if (session.agent_state) {
  try {
    const agentState = JSON.parse(session.agent_state)
    console.log('Has Requests:', agentState.requests ? Object.keys(agentState.requests).length : 0)
    if (agentState.requests && Object.keys(agentState.requests).length > 0) {
      console.log('Pending Requests:', JSON.stringify(agentState.requests, null, 2))
    }
    console.log('Raw Agent State:', JSON.stringify(agentState, null, 2))
  } catch (e) {
    console.log('Raw:', session.agent_state)
  }
} else {
  console.log('No agent state')
}

// 查询最近的消息
console.log('\n📨 Recent Messages (last 10):')
const messages = db.query('SELECT * FROM messages WHERE session_id = ? ORDER BY seq DESC LIMIT 10').all(targetSessionId)
console.log(`Total messages: ${messages.length}`)

for (const msg of messages.reverse()) {
  console.log('\n---')
  console.log('Seq:', msg.seq)
  console.log('Created:', new Date(msg.created_at).toISOString())

  try {
    const content = JSON.parse(msg.content)
    console.log('Role:', content.role || 'unknown')

    if (content.role === 'user') {
      const text = typeof content.content === 'string' ? content.content : JSON.stringify(content.content)
      console.log('Content:', text.slice(0, 200))
    } else if (content.role === 'agent') {
      if (content.content?.data) {
        const data = content.content.data
        if (typeof data === 'string') {
          console.log('Agent message:', data.slice(0, 200))
        } else if (data.type === 'message') {
          console.log('Agent message:', data.message?.slice(0, 200) || 'N/A')
        } else if (data.type === 'tool-use') {
          console.log('Tool use:', data.tool?.name || 'unknown')
        } else {
          console.log('Agent data type:', data.type || 'unknown')
        }
      }
    }
  } catch (e) {
    console.log('Raw content:', msg.content.slice(0, 200))
  }
}

db.close()
