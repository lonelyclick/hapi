import { useCallback, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useGroupSSE } from '@/hooks/useGroupSSE'
import { GroupChatHeader } from '@/components/GroupChat/GroupChatHeader'
import { GroupMessageList } from '@/components/GroupChat/GroupMessageList'
import { GroupComposer } from '@/components/GroupChat/GroupComposer'
import { GroupMembersSheet } from '@/components/GroupChat/GroupMembersSheet'
import { AddMemberSheet } from '@/components/GroupChat/AddMemberSheet'
import { Spinner } from '@/components/Spinner'

export default function GroupChatPage() {
    const { api, token, baseUrl } = useAppContext()
    const goBack = useAppGoBack()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { groupId } = useParams({ from: '/groups/$groupId/chat' })
    const [isSending, setIsSending] = useState(false)
    const [membersSheetOpen, setMembersSheetOpen] = useState(false)
    const [addMemberSheetOpen, setAddMemberSheetOpen] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    // 使用 SSE 实时接收群组消息
    useGroupSSE({
        enabled: Boolean(api && groupId && token && baseUrl),
        groupId,
        token: token || '',
        baseUrl: baseUrl || ''
    })

    // Fetch group details
    const {
        data: groupData,
        isLoading: groupLoading,
        error: groupError
    } = useQuery({
        queryKey: ['group', groupId],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getGroup(groupId)
        },
        enabled: Boolean(api && groupId),
        refetchInterval: 10000 // 改为每10秒刷新成员状态
    })

    // Fetch group messages - 初始加载一次，后续靠 SSE
    const {
        data: messagesData,
        isLoading: messagesLoading
    } = useQuery({
        queryKey: ['group-messages', groupId],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getGroupMessages(groupId, 100)
        },
        enabled: Boolean(api && groupId),
        staleTime: 30000 // 30秒内不重新请求
    })

    const group = groupData?.group
    const members = groupData?.members ?? []
    const messages = messagesData?.messages ?? []

    // Redirect if group not found
    useEffect(() => {
        if (groupError) {
            navigate({ to: '/groups', replace: true })
        }
    }, [groupError, navigate])

    // Send message mutation
    const sendMessageMutation = useMutation({
        mutationFn: async ({ content, mentions }: { content: string; mentions?: string[] }) => {
            if (!api) throw new Error('API unavailable')
            return await api.broadcastToGroup(groupId, content, undefined, 'user', 'chat', mentions)
        }
        // 不需要在 onSuccess 中刷新了，SSE 会处理
    })

    // Delete group mutation
    const deleteGroupMutation = useMutation({
        mutationFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.deleteGroup(groupId)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['groups'] })
            navigate({ to: '/groups', replace: true })
        }
    })

    const handleSend = useCallback(async (content: string, mentions?: string[]) => {
        setIsSending(true)
        try {
            await sendMessageMutation.mutateAsync({ content, mentions })
        } catch (error) {
            console.error('Failed to send message:', error)
        } finally {
            setIsSending(false)
        }
    }, [sendMessageMutation])

    const handleBack = useCallback(() => {
        goBack()
    }, [goBack])

    const handleMembersClick = useCallback(() => {
        setMembersSheetOpen(true)
    }, [])

    const handleAddMemberClick = useCallback(() => {
        setMembersSheetOpen(false)
        setAddMemberSheetOpen(true)
    }, [])

    const handleRemoveMember = useCallback(async (sessionId: string) => {
        if (!api) return
        await api.removeGroupMember(groupId, sessionId)
        void queryClient.invalidateQueries({ queryKey: ['group', groupId] })
    }, [api, groupId, queryClient])

    const handleAddMembers = useCallback(async (sessions: Array<{ sessionId: string; agentType?: string }>) => {
        if (!api) return
        for (const session of sessions) {
            await api.addGroupMember(groupId, session.sessionId, 'member', session.agentType)
        }
        void queryClient.invalidateQueries({ queryKey: ['group', groupId] })
    }, [api, groupId, queryClient])

    const handleDeleteGroup = useCallback(async () => {
        if (!confirm('确定要删除此群组吗？所有消息将被永久删除。')) return
        setIsDeleting(true)
        try {
            await deleteGroupMutation.mutateAsync()
        } catch (error) {
            console.error('Failed to delete group:', error)
            alert('删除失败')
        } finally {
            setIsDeleting(false)
        }
    }, [deleteGroupMutation])

    if (groupLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Spinner className="w-8 h-8" />
            </div>
        )
    }

    if (!group) {
        return (
            <div className="flex h-full flex-col items-center justify-center text-[var(--app-hint)]">
                <p>群组不存在</p>
                <button
                    onClick={() => navigate({ to: '/groups' })}
                    className="mt-2 text-sm text-[var(--app-link)] hover:underline"
                >
                    返回群组列表
                </button>
            </div>
        )
    }

    return (
        <div className="flex h-full flex-col">
            <GroupChatHeader
                group={group}
                members={members}
                onBack={handleBack}
                onMembersClick={handleMembersClick}
                onDeleteClick={handleDeleteGroup}
                isDeleting={isDeleting}
            />

            <GroupMessageList
                messages={messages}
                isLoading={messagesLoading}
            />

            <GroupComposer
                disabled={group.status !== 'active'}
                isSending={isSending}
                onSend={handleSend}
                placeholder={group.status === 'active' ? '发送消息给群组...' : '群组已暂停'}
                members={members}
            />

            {/* Members Management Sheet */}
            <GroupMembersSheet
                open={membersSheetOpen}
                onOpenChange={setMembersSheetOpen}
                group={group}
                members={members}
                onRemoveMember={handleRemoveMember}
                onAddMemberClick={handleAddMemberClick}
            />

            {/* Add Member Sheet */}
            <AddMemberSheet
                open={addMemberSheetOpen}
                onOpenChange={setAddMemberSheetOpen}
                groupId={groupId}
                existingMembers={members}
                onAddMembers={handleAddMembers}
                onSpawnMember={() => {
                    void queryClient.invalidateQueries({ queryKey: ['group', groupId] })
                }}
            />
        </div>
    )
}
