import { useCallback, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { GroupChatHeader } from '@/components/GroupChat/GroupChatHeader'
import { GroupMessageList } from '@/components/GroupChat/GroupMessageList'
import { GroupComposer } from '@/components/GroupChat/GroupComposer'
import { Spinner } from '@/components/Spinner'

export default function GroupChatPage() {
    const { api } = useAppContext()
    const goBack = useAppGoBack()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { groupId } = useParams({ from: '/groups/$groupId/chat' })
    const [isSending, setIsSending] = useState(false)

    // Fetch group details
    const {
        data: groupData,
        isLoading: groupLoading,
        error: groupError,
        refetch: refetchGroup
    } = useQuery({
        queryKey: ['group', groupId],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getGroup(groupId)
        },
        enabled: Boolean(api && groupId),
        refetchInterval: 5000 // Poll every 5 seconds to update member status
    })

    // Fetch group messages
    const {
        data: messagesData,
        isLoading: messagesLoading,
        refetch: refetchMessages
    } = useQuery({
        queryKey: ['group-messages', groupId],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getGroupMessages(groupId, 50)
        },
        enabled: Boolean(api && groupId),
        refetchInterval: 3000 // Poll every 3 seconds for new messages
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
        },
        onSuccess: () => {
            // Refetch messages after sending
            void queryClient.invalidateQueries({ queryKey: ['group-messages', groupId] })
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
        </div>
    )
}
