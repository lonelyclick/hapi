import { Database } from 'bun:sqlite';

const db = new Database('/home/guang/.hapi/hapi.db');

// 查找类似的 session ID
const sessions = db.query("SELECT id FROM sessions WHERE id LIKE '%2280%' LIMIT 5").all() as { id: string }[];
console.log('Sessions matching 2280:', sessions);

// 查看最近活跃的 sessions
const recentSessions = db.query("SELECT id, name FROM sessions ORDER BY updated_at DESC LIMIT 5").all();
console.log('Recent sessions:', recentSessions);

// 查看消息最多的 sessions
const msgCounts = db.query("SELECT session_id, COUNT(*) as cnt FROM messages GROUP BY session_id ORDER BY cnt DESC LIMIT 5").all();
console.log('Sessions with most messages:', msgCounts);
