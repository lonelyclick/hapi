import { Hono } from 'hono'
import { z } from 'zod'
import type { WebAppEnv } from '../middleware/auth'
import type { Store, AgentGroupType, AgentGroupStatus, GroupMemberRole, GroupSenderType, GroupMessageType } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'

// Zod schemas
const groupTypeSchema = z.enum(['collaboration', 'debate', 'review'])
const groupStatusSchema = z.enum(['active', 'paused', 'completed'])
const memberRoleSchema = z.enum(['owner', 'moderator', 'member'])
const senderTypeSchema = z.enum(['agent', 'user', 'system'])
const messageTypeSchema = z.enum(['chat', 'task', 'feedback', 'decision'])

const createGroupSchema = z.object({
    name: z.string().min(1).max(100),
    type: groupTypeSchema.optional().default('collaboration'),
    description: z.string().max(500).optional()
})

const updateGroupSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    status: groupStatusSchema.optional()
})

const addMemberSchema = z.object({
    sessionId: z.string().uuid(),
    role: memberRoleSchema.optional().default('member'),
    agentType: z.string().max(50).optional()
})

const sendMessageSchema = z.object({
    content: z.string().min(1).max(50000),
    sourceSessionId: z.string().uuid().optional(),
    senderType: senderTypeSchema.optional().default('agent'),
    messageType: messageTypeSchema.optional().default('chat')
})

const messagesQuerySchema = z.object({
    limit: z.coerce.number().min(1).max(500).optional(),
    beforeId: z.string().uuid().optional()
})

export function createGroupRoutes(
    store: Store,
    syncEngine: SyncEngine | null
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // GET /groups - 获取群组列表
    app.get('/groups', (c) => {
        const namespace = c.get('namespace') || 'default'
        const groups = store.getAgentGroups(namespace)
        return c.json({ groups })
    })

    // POST /groups - 创建群组
    app.post('/groups', async (c) => {
        const namespace = c.get('namespace') || 'default'
        const json = await c.req.json().catch(() => null)
        const parsed = createGroupSchema.safeParse(json)

        if (!parsed.success) {
            return c.json({ error: 'Invalid group data', details: parsed.error.issues }, 400)
        }

        try {
            const group = store.createAgentGroup(
                namespace,
                parsed.data.name,
                parsed.data.type as AgentGroupType,
                parsed.data.description
            )
            return c.json({ ok: true, group })
        } catch (error) {
            return c.json({ error: 'Failed to create group' }, 500)
        }
    })

    // GET /groups/:id - 获取群组详情（含成员）
    app.get('/groups/:id', (c) => {
        const id = c.req.param('id')
        const group = store.getAgentGroup(id)

        if (!group) {
            return c.json({ error: 'Group not found' }, 404)
        }

        const members = store.getGroupMembers(id)
        const membersWithDetails = members.map(m => {
            const session = syncEngine?.getSession(m.sessionId)
            return {
                ...m,
                sessionName: session?.metadata?.name || `Session ${m.sessionId.slice(0, 8)}`,
                sessionActive: session?.active || false,
                agentType: m.agentType || session?.metadata?.agent || 'unknown'
            }
        })
        return c.json({ group, members: membersWithDetails })
    })

    // PUT /groups/:id - 更新群组
    app.put('/groups/:id', async (c) => {
        const id = c.req.param('id')
        const group = store.getAgentGroup(id)

        if (!group) {
            return c.json({ error: 'Group not found' }, 404)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = updateGroupSchema.safeParse(json)

        if (!parsed.success) {
            return c.json({ error: 'Invalid group data', details: parsed.error.issues }, 400)
        }

        // Update status if provided
        if (parsed.data.status) {
            store.updateAgentGroupStatus(id, parsed.data.status as AgentGroupStatus)
        }

        // Note: name and description updates would require additional store methods
        // For now, only status update is supported

        const updatedGroup = store.getAgentGroup(id)
        return c.json({ ok: true, group: updatedGroup })
    })

    // DELETE /groups/:id - 删除群组
    app.delete('/groups/:id', (c) => {
        const id = c.req.param('id')
        const group = store.getAgentGroup(id)

        if (!group) {
            return c.json({ error: 'Group not found' }, 404)
        }

        store.deleteAgentGroup(id)
        return c.json({ ok: true })
    })

    // POST /groups/:id/members - 添加成员
    app.post('/groups/:id/members', async (c) => {
        const groupId = c.req.param('id')
        const group = store.getAgentGroup(groupId)

        if (!group) {
            return c.json({ error: 'Group not found' }, 404)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = addMemberSchema.safeParse(json)

        if (!parsed.success) {
            return c.json({ error: 'Invalid member data', details: parsed.error.issues }, 400)
        }

        try {
            store.addGroupMember(
                groupId,
                parsed.data.sessionId,
                parsed.data.role as GroupMemberRole,
                parsed.data.agentType
            )

            const members = store.getGroupMembers(groupId)
            return c.json({ ok: true, members })
        } catch (error) {
            return c.json({ error: 'Failed to add member' }, 500)
        }
    })

    // DELETE /groups/:id/members/:sessionId - 移除成员
    app.delete('/groups/:id/members/:sessionId', (c) => {
        const groupId = c.req.param('id')
        const sessionId = c.req.param('sessionId')
        const group = store.getAgentGroup(groupId)

        if (!group) {
            return c.json({ error: 'Group not found' }, 404)
        }

        store.removeGroupMember(groupId, sessionId)
        const members = store.getGroupMembers(groupId)
        return c.json({ ok: true, members })
    })

    // GET /groups/:id/messages - 获取群组消息
    app.get('/groups/:id/messages', (c) => {
        const groupId = c.req.param('id')
        const group = store.getAgentGroup(groupId)

        if (!group) {
            return c.json({ error: 'Group not found' }, 404)
        }

        const query = c.req.query()
        const parsed = messagesQuerySchema.safeParse(query)

        const limit = parsed.success ? parsed.data.limit : undefined
        const beforeId = parsed.success ? parsed.data.beforeId : undefined

        const messages = store.getGroupMessages(groupId, limit, beforeId)
        return c.json({ messages })
    })

    // POST /groups/:id/messages - 发送群组消息
    app.post('/groups/:id/messages', async (c) => {
        const groupId = c.req.param('id')
        const group = store.getAgentGroup(groupId)

        if (!group) {
            return c.json({ error: 'Group not found' }, 404)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = sendMessageSchema.safeParse(json)

        if (!parsed.success) {
            return c.json({ error: 'Invalid message data', details: parsed.error.issues }, 400)
        }

        try {
            const message = store.addGroupMessage(
                groupId,
                parsed.data.sourceSessionId ?? null,
                parsed.data.content,
                parsed.data.senderType as GroupSenderType,
                parsed.data.messageType as GroupMessageType
            )
            return c.json({ ok: true, message })
        } catch (error) {
            return c.json({ error: 'Failed to send message' }, 500)
        }
    })

    // POST /groups/:id/broadcast - 广播消息给所有群组成员
    app.post('/groups/:id/broadcast', async (c) => {
        const groupId = c.req.param('id')
        const group = store.getAgentGroup(groupId)

        if (!group) {
            return c.json({ error: 'Group not found' }, 404)
        }

        if (group.status !== 'active') {
            return c.json({ error: 'Group is not active' }, 409)
        }

        if (!syncEngine) {
            return c.json({ error: 'Sync engine not available' }, 503)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = sendMessageSchema.safeParse(json)

        if (!parsed.success) {
            return c.json({ error: 'Invalid message data', details: parsed.error.issues }, 400)
        }

        // Store the message first
        const message = store.addGroupMessage(
            groupId,
            parsed.data.sourceSessionId ?? null,
            parsed.data.content,
            parsed.data.senderType as GroupSenderType,
            parsed.data.messageType as GroupMessageType
        )

        // Get all members and broadcast
        const members = store.getGroupMembers(groupId)
        const results: { sessionId: string; success: boolean; error?: string }[] = []

        for (const member of members) {
            // Skip the source session (don't echo back)
            if (member.sessionId === parsed.data.sourceSessionId) {
                continue
            }

            const session = syncEngine.getSession(member.sessionId)
            if (!session?.active) {
                results.push({ sessionId: member.sessionId, success: false, error: 'Session not active' })
                continue
            }

            try {
                // Get sender name for metadata
                const senderName = parsed.data.sourceSessionId
                    ? syncEngine.getSession(parsed.data.sourceSessionId)?.metadata?.name ?? parsed.data.sourceSessionId
                    : 'System'

                await syncEngine.sendMessage(member.sessionId, {
                    text: parsed.data.content,
                    sentFrom: 'webapp',
                    meta: {
                        groupId: groupId,
                        groupName: group.name,
                        senderName: senderName,
                        messageType: parsed.data.messageType,
                        isGroupMessage: true
                    }
                })
                results.push({ sessionId: member.sessionId, success: true })
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Failed to send'
                results.push({ sessionId: member.sessionId, success: false, error: errorMessage })
            }
        }

        return c.json({
            ok: true,
            message,
            broadcast: {
                total: members.length,
                sent: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                results
            }
        })
    })

    return app
}
