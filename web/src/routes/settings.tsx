import { useCallback, useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { Spinner } from '@/components/Spinner'
import { getClientId, getDeviceType, getStoredEmail } from '@/lib/client-identity'
import { useNotificationPermission, useWebPushSubscription } from '@/hooks/useNotification'
import type { InputPreset, Project, UserRole } from '@/types/api'
import type { ClaudeAccount, ClaudeAccountsConfig } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function TrashIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    )
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function EditIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
    )
}

type ProjectFormData = {
    name: string
    path: string
    description: string
}

type PresetFormData = {
    trigger: string
    title: string
    prompt: string
}

function PresetForm(props: {
    initial?: PresetFormData
    onSubmit: (data: PresetFormData) => void
    onCancel: () => void
    isPending: boolean
    submitLabel: string
}) {
    // Use key prop to reset form when editing different presets
    const [trigger, setTrigger] = useState(props.initial?.trigger ?? '')
    const [title, setTitle] = useState(props.initial?.title ?? '')
    const [prompt, setPrompt] = useState(props.initial?.prompt ?? '')

    // Reset form when initial values change (editing a different preset)
    const initialRef = useRef(props.initial)
    if (props.initial !== initialRef.current) {
        initialRef.current = props.initial
        setTrigger(props.initial?.trigger ?? '')
        setTitle(props.initial?.title ?? '')
        setPrompt(props.initial?.prompt ?? '')
    }

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault()
        if (!trigger.trim() || !title.trim() || !prompt.trim()) return
        props.onSubmit({ trigger: trigger.trim(), title: title.trim(), prompt: prompt.trim() })
    }, [trigger, title, prompt, props])

    return (
        <form onSubmit={handleSubmit} className="px-3 py-2 space-y-2 border-b border-[var(--app-divider)]">
            <input
                type="text"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                placeholder="Trigger (e.g. loopreview)"
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                disabled={props.isPending}
            />
            <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (short description)"
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                disabled={props.isPending}
            />
            <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Prompt content..."
                rows={4}
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)] resize-none"
                disabled={props.isPending}
            />
            <div className="flex justify-end gap-2 pt-1">
                <button
                    type="button"
                    onClick={props.onCancel}
                    disabled={props.isPending}
                    className="px-3 py-1.5 text-sm rounded border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={props.isPending || !trigger.trim() || !title.trim() || !prompt.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50 hover:opacity-90 transition-opacity"
                >
                    {props.isPending && <Spinner size="sm" label={null} />}
                    {props.submitLabel}
                </button>
            </div>
        </form>
    )
}

function ProjectForm(props: {
    initial?: ProjectFormData
    onSubmit: (data: ProjectFormData) => void
    onCancel: () => void
    isPending: boolean
    submitLabel: string
}) {
    const [name, setName] = useState(props.initial?.name ?? '')
    const [path, setPath] = useState(props.initial?.path ?? '')
    const [description, setDescription] = useState(props.initial?.description ?? '')

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim() || !path.trim()) return
        props.onSubmit({ name: name.trim(), path: path.trim(), description: description.trim() })
    }, [name, path, description, props])

    return (
        <form onSubmit={handleSubmit} className="px-3 py-2 space-y-2 border-b border-[var(--app-divider)]">
            <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                disabled={props.isPending}
            />
            <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="Absolute path (e.g. /home/user/projects/myapp)"
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                disabled={props.isPending}
            />
            <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                disabled={props.isPending}
            />
            <div className="flex justify-end gap-2 pt-1">
                <button
                    type="button"
                    onClick={props.onCancel}
                    disabled={props.isPending}
                    className="px-3 py-1.5 text-sm rounded border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={props.isPending || !name.trim() || !path.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50 hover:opacity-90 transition-opacity"
                >
                    {props.isPending && <Spinner size="sm" label={null} />}
                    {props.submitLabel}
                </button>
            </div>
        </form>
    )
}

export default function SettingsPage() {
    const { api } = useAppContext()
    const goBack = useAppGoBack()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [projectError, setProjectError] = useState<string | null>(null)
    const [showAddProject, setShowAddProject] = useState(false)
    const [editingProject, setEditingProject] = useState<Project | null>(null)
    const [userError, setUserError] = useState<string | null>(null)
    const [showAddUser, setShowAddUser] = useState(false)
    const [newUserEmail, setNewUserEmail] = useState('')
    const [newUserRole, setNewUserRole] = useState<UserRole>('developer')
    // 当前会话信息
    const currentSession = useMemo(() => ({
        email: getStoredEmail() || '-',
        clientId: getClientId(),
        deviceType: getDeviceType()
    }), [])

    // Projects
    const { data: projectsData, isLoading: projectsLoading } = useQuery({
        queryKey: ['projects'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getProjects()
        },
        enabled: Boolean(api)
    })

    const addProjectMutation = useMutation({
        mutationFn: async (data: ProjectFormData) => {
            if (!api) throw new Error('API unavailable')
            return await api.addProject(data.name, data.path, data.description || undefined)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['projects'], { projects: result.projects })
            setShowAddProject(false)
            setProjectError(null)
        },
        onError: (err) => {
            setProjectError(err instanceof Error ? err.message : 'Failed to add project')
        }
    })

    const updateProjectMutation = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: ProjectFormData }) => {
            if (!api) throw new Error('API unavailable')
            return await api.updateProject(id, data.name, data.path, data.description || undefined)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['projects'], { projects: result.projects })
            setEditingProject(null)
            setProjectError(null)
        },
        onError: (err) => {
            setProjectError(err instanceof Error ? err.message : 'Failed to update project')
        }
    })

    const removeProjectMutation = useMutation({
        mutationFn: async (id: string) => {
            if (!api) throw new Error('API unavailable')
            return await api.removeProject(id)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['projects'], { projects: result.projects })
        },
        onError: (err) => {
            setProjectError(err instanceof Error ? err.message : 'Failed to remove project')
        }
    })

    const handleAddProject = useCallback((data: ProjectFormData) => {
        addProjectMutation.mutate(data)
    }, [addProjectMutation])

    const handleUpdateProject = useCallback((data: ProjectFormData) => {
        if (!editingProject) return
        updateProjectMutation.mutate({ id: editingProject.id, data })
    }, [editingProject, updateProjectMutation])

    const handleRemoveProject = useCallback((id: string) => {
        removeProjectMutation.mutate(id)
    }, [removeProjectMutation])

    // Users
    const { data: usersData, isLoading: usersLoading } = useQuery({
        queryKey: ['users'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getUsers()
        },
        enabled: Boolean(api)
    })

    const addUserMutation = useMutation({
        mutationFn: async ({ email, role }: { email: string; role: UserRole }) => {
            if (!api) throw new Error('API unavailable')
            return await api.addUser(email, role)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['users'], { users: result.users })
            setShowAddUser(false)
            setNewUserEmail('')
            setNewUserRole('developer')
            setUserError(null)
        },
        onError: (err) => {
            setUserError(err instanceof Error ? err.message : 'Failed to add user')
        }
    })

    const updateUserRoleMutation = useMutation({
        mutationFn: async ({ email, role }: { email: string; role: UserRole }) => {
            if (!api) throw new Error('API unavailable')
            return await api.updateUserRole(email, role)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['users'], { users: result.users })
        },
        onError: (err) => {
            setUserError(err instanceof Error ? err.message : 'Failed to update user role')
        }
    })

    const removeUserMutation = useMutation({
        mutationFn: async (email: string) => {
            if (!api) throw new Error('API unavailable')
            return await api.removeUser(email)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['users'], { users: result.users })
        },
        onError: (err) => {
            setUserError(err instanceof Error ? err.message : 'Failed to remove user')
        }
    })

    const handleAddUser = useCallback((e: React.FormEvent) => {
        e.preventDefault()
        const trimmedEmail = newUserEmail.trim().toLowerCase()
        if (!trimmedEmail) return
        addUserMutation.mutate({ email: trimmedEmail, role: newUserRole })
    }, [newUserEmail, newUserRole, addUserMutation])

    const handleUpdateUserRole = useCallback((email: string, role: UserRole) => {
        updateUserRoleMutation.mutate({ email, role })
    }, [updateUserRoleMutation])

    const handleRemoveUser = useCallback((email: string) => {
        removeUserMutation.mutate(email)
    }, [removeUserMutation])

    // Input Presets
    const [presetError, setPresetError] = useState<string | null>(null)
    const [showAddPreset, setShowAddPreset] = useState(false)
    const [editingPreset, setEditingPreset] = useState<InputPreset | null>(null)

    const { data: presetsData, isLoading: presetsLoading } = useQuery({
        queryKey: queryKeys.inputPresets(),
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getInputPresets()
        },
        enabled: Boolean(api)
    })

    const addPresetMutation = useMutation({
        mutationFn: async (data: PresetFormData) => {
            if (!api) throw new Error('API unavailable')
            return await api.addInputPreset(data.trigger, data.title, data.prompt)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(queryKeys.inputPresets(), { presets: result.presets })
            setShowAddPreset(false)
            setPresetError(null)
        },
        onError: (err) => {
            setPresetError(err instanceof Error ? err.message : 'Failed to add preset')
        }
    })

    const updatePresetMutation = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: PresetFormData }) => {
            if (!api) throw new Error('API unavailable')
            return await api.updateInputPreset(id, data.trigger, data.title, data.prompt)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(queryKeys.inputPresets(), { presets: result.presets })
            setEditingPreset(null)
            setPresetError(null)
        },
        onError: (err) => {
            setPresetError(err instanceof Error ? err.message : 'Failed to update preset')
        }
    })

    const removePresetMutation = useMutation({
        mutationFn: async (id: string) => {
            if (!api) throw new Error('API unavailable')
            return await api.removeInputPreset(id)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(queryKeys.inputPresets(), { presets: result.presets })
        },
        onError: (err) => {
            setPresetError(err instanceof Error ? err.message : 'Failed to remove preset')
        }
    })

    const handleAddPreset = useCallback((data: PresetFormData) => {
        addPresetMutation.mutate(data)
    }, [addPresetMutation])

    const handleUpdatePreset = useCallback((data: PresetFormData) => {
        if (!editingPreset) return
        updatePresetMutation.mutate({ id: editingPreset.id, data })
    }, [editingPreset, updatePresetMutation])

    const handleRemovePreset = useCallback((id: string) => {
        removePresetMutation.mutate(id)
    }, [removePresetMutation])

    const presets = Array.isArray(presetsData?.presets) ? presetsData.presets : []

    // Claude Accounts
    const [accountError, setAccountError] = useState<string | null>(null)
    const [showAddAccount, setShowAddAccount] = useState(false)
    const [newAccountName, setNewAccountName] = useState('')
    const [newAccountConfigDir, setNewAccountConfigDir] = useState('')
    const [showSetupGuide, setShowSetupGuide] = useState(false)

    const { data: accountsData, isLoading: accountsLoading, refetch: refetchAccounts } = useQuery({
        queryKey: ['claude-accounts'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getClaudeAccountsConfig()
        },
        enabled: Boolean(api)
    })

    const { data: setupGuideData } = useQuery({
        queryKey: ['claude-accounts-setup-guide'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getClaudeAccountSetupGuide()
        },
        enabled: Boolean(api) && showSetupGuide
    })

    const addAccountMutation = useMutation({
        mutationFn: async (data: { name: string; configDir?: string }) => {
            if (!api) throw new Error('API unavailable')
            return await api.addClaudeAccount(data)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['claude-accounts'], result.config)
            setShowAddAccount(false)
            setShowSetupGuide(false)
            setNewAccountName('')
            setNewAccountConfigDir('')
            setAccountError(null)
        },
        onError: (err) => {
            setAccountError(err instanceof Error ? err.message : 'Failed to add account')
        }
    })

    const activateAccountMutation = useMutation({
        mutationFn: async (id: string) => {
            if (!api) throw new Error('API unavailable')
            return await api.activateClaudeAccount(id)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['claude-accounts'], result.config)
        },
        onError: (err) => {
            setAccountError(err instanceof Error ? err.message : 'Failed to switch account')
        }
    })

    const removeAccountMutation = useMutation({
        mutationFn: async (id: string) => {
            if (!api) throw new Error('API unavailable')
            return await api.removeClaudeAccount(id)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['claude-accounts'], result.config)
        },
        onError: (err) => {
            setAccountError(err instanceof Error ? err.message : 'Failed to remove account')
        }
    })

    const updateAccountConfigMutation = useMutation({
        mutationFn: async (data: { autoRotateEnabled?: boolean; defaultThreshold?: number }) => {
            if (!api) throw new Error('API unavailable')
            return await api.updateClaudeAccountsGlobalConfig(data)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['claude-accounts'], result.config)
        },
        onError: (err) => {
            setAccountError(err instanceof Error ? err.message : 'Failed to update config')
        }
    })

    const migrateAccountMutation = useMutation({
        mutationFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.migrateDefaultClaudeAccount()
        },
        onSuccess: (result) => {
            if (result.config) {
                queryClient.setQueryData(['claude-accounts'], result.config)
            }
        },
        onError: (err) => {
            setAccountError(err instanceof Error ? err.message : 'Failed to migrate account')
        }
    })

    const handleAddAccount = useCallback((e: React.FormEvent) => {
        e.preventDefault()
        const trimmedName = newAccountName.trim()
        if (!trimmedName) return
        addAccountMutation.mutate({
            name: trimmedName,
            configDir: newAccountConfigDir.trim() || undefined
        })
    }, [newAccountName, newAccountConfigDir, addAccountMutation])

    const handleActivateAccount = useCallback((id: string) => {
        activateAccountMutation.mutate(id)
    }, [activateAccountMutation])

    const handleRemoveAccount = useCallback((id: string) => {
        removeAccountMutation.mutate(id)
    }, [removeAccountMutation])

    const handleToggleAutoRotate = useCallback((enabled: boolean) => {
        updateAccountConfigMutation.mutate({ autoRotateEnabled: enabled })
    }, [updateAccountConfigMutation])

    const accounts = accountsData?.accounts ?? []
    const activeAccountId = accountsData?.activeAccountId ?? ''
    const autoRotateEnabled = accountsData?.autoRotateEnabled ?? true

    const handleLogout = useCallback(async () => {
        // 清除 localStorage
        localStorage.clear()

        // 注销 PWA service worker
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations()
            for (const registration of registrations) {
                await registration.unregister()
            }
        }

        // 清除所有缓存
        if ('caches' in window) {
            const cacheNames = await caches.keys()
            for (const cacheName of cacheNames) {
                await caches.delete(cacheName)
            }
        }

        // 跳转到首页
        window.location.href = '/'
    }, [])

    const projects = Array.isArray(projectsData?.projects) ? projectsData.projects : []
    const users = Array.isArray(usersData?.users) ? usersData.users : []

    // 判断当前用户是否为 Developer（有权限管理用户）
    // 如果用户列表为空，默认所有人都有权限；否则根据邮箱查找角色
    const currentUserRole = useMemo(() => {
        if (users.length === 0) return 'developer' // 无用户配置时，允许所有
        const currentEmail = currentSession.email.toLowerCase()
        const user = users.find(u => u.email.toLowerCase() === currentEmail)
        return user?.role ?? 'developer' // 未找到时默认 developer（兼容性）
    }, [users, currentSession.email])

    const canManageUsers = currentUserRole === 'developer'

    // Notification settings
    const {
        permission: notificationPermission,
        enabled: notificationEnabled,
        setEnabled: setNotificationEnabled,
        requestPermission,
        isSupported: isNotificationSupported
    } = useNotificationPermission()

    // Web Push subscription
    const { subscribe: subscribePush, unsubscribe: unsubscribePush } = useWebPushSubscription(api)

    const handleNotificationToggle = useCallback(async () => {
        if (notificationPermission === 'default') {
            const result = await requestPermission()
            if (result === 'granted') {
                // 权限获取成功后立即订阅 Web Push
                await subscribePush()
            }
        } else if (notificationPermission === 'granted') {
            const newEnabled = !notificationEnabled
            setNotificationEnabled(newEnabled)
            if (newEnabled) {
                // 开启通知时订阅 Web Push
                await subscribePush()
            } else {
                // 关闭通知时取消订阅
                await unsubscribePush()
            }
        }
    }, [notificationPermission, notificationEnabled, requestPermission, setNotificationEnabled, subscribePush, unsubscribePush])

    return (
        <div className="flex h-full flex-col">
            <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 px-3 py-1.5">
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="flex-1 font-medium text-sm">Settings</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                <div className="mx-auto w-full max-w-content p-3 space-y-4">
                    {/* Current Session Section */}
                    <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                        <div className="px-3 py-2 border-b border-[var(--app-divider)]">
                            <h2 className="text-sm font-medium">Current Session</h2>
                        </div>
                        <div className="divide-y divide-[var(--app-divider)]">
                            <div className="px-3 py-2 flex items-center justify-between gap-2">
                                <span className="text-sm text-[var(--app-hint)]">Email</span>
                                <span className="text-sm font-mono truncate">{currentSession.email}</span>
                            </div>
                            <div className="px-3 py-2 flex items-center justify-between gap-2">
                                <span className="text-sm text-[var(--app-hint)]">Role</span>
                                <span className="text-sm">
                                    {currentUserRole === 'developer' ? 'Developer' : 'Operator'}
                                </span>
                            </div>
                            <div className="px-3 py-2 flex items-center justify-between gap-2">
                                <span className="text-sm text-[var(--app-hint)]">Device</span>
                                <span className="text-sm font-mono">{currentSession.deviceType}</span>
                            </div>
                            <div className="px-3 py-2 flex items-center justify-between gap-2">
                                <span className="text-sm text-[var(--app-hint)]">Client ID</span>
                                <span className="text-sm font-mono">{currentSession.clientId}</span>
                            </div>
                            <div className="px-3 py-2">
                                <button
                                    type="button"
                                    onClick={handleLogout}
                                    className="w-full px-3 py-2 text-sm font-medium rounded bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                                >
                                    Logout
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Quick Links Section */}
                    <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                        <div className="px-3 py-2 border-b border-[var(--app-divider)]">
                            <h2 className="text-sm font-medium">Agent Tools</h2>
                        </div>
                        <div className="divide-y divide-[var(--app-divider)]">
                            <button
                                type="button"
                                onClick={() => navigate({ to: '/groups' })}
                                className="w-full px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-[var(--app-secondary-bg)] transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="text-[var(--app-hint)]"
                                    >
                                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                        <circle cx="9" cy="7" r="4" />
                                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                    </svg>
                                    <div className="text-left">
                                        <div className="text-sm">Agent Groups</div>
                                        <div className="text-[11px] text-[var(--app-hint)]">
                                            Create groups for multi-agent collaboration
                                        </div>
                                    </div>
                                </div>
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="text-[var(--app-hint)]"
                                >
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Claude Accounts Section */}
                    <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                        <div className="px-3 py-2 border-b border-[var(--app-divider)] flex items-center justify-between">
                            <div>
                                <h2 className="text-sm font-medium">Claude Accounts</h2>
                                <p className="text-[11px] text-[var(--app-hint)] mt-0.5">
                                    Manage multiple Claude Pro/Max subscriptions.
                                </p>
                            </div>
                            {!showAddAccount && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowAddAccount(true)
                                        setShowSetupGuide(true)
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] hover:opacity-90 transition-opacity"
                                >
                                    <PlusIcon className="w-3 h-3" />
                                    Add
                                </button>
                            )}
                        </div>

                        {/* Add Account Form with Setup Guide */}
                        {showAddAccount && (
                            <div className="px-3 py-2 border-b border-[var(--app-divider)] space-y-3">
                                {showSetupGuide && setupGuideData && (
                                    <div className="bg-[var(--app-bg)] rounded p-2 space-y-2">
                                        <div className="text-xs font-medium text-[var(--app-fg)]">Setup Guide</div>
                                        {setupGuideData.steps.map((step) => (
                                            <div key={step.step} className="text-xs">
                                                <div className="font-medium text-[var(--app-fg)]">
                                                    {step.step}. {step.title}
                                                </div>
                                                {step.command && (
                                                    <code className="block mt-1 p-1.5 bg-[var(--app-secondary-bg)] rounded text-[10px] font-mono text-[var(--app-hint)] break-all select-all">
                                                        {step.command}
                                                    </code>
                                                )}
                                                <div className="text-[var(--app-hint)] mt-0.5">{step.description}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <form onSubmit={handleAddAccount} className="space-y-2">
                                    <input
                                        type="text"
                                        value={newAccountName}
                                        onChange={(e) => setNewAccountName(e.target.value)}
                                        placeholder="Account name (e.g. Pro Account 2)"
                                        className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                                        disabled={addAccountMutation.isPending}
                                    />
                                    <input
                                        type="text"
                                        value={newAccountConfigDir}
                                        onChange={(e) => setNewAccountConfigDir(e.target.value)}
                                        placeholder={setupGuideData?.configDir || 'Config directory (optional)'}
                                        className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)] font-mono text-xs"
                                        disabled={addAccountMutation.isPending}
                                    />
                                    <div className="flex justify-end gap-2 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowAddAccount(false)
                                                setShowSetupGuide(false)
                                                setNewAccountName('')
                                                setNewAccountConfigDir('')
                                                setAccountError(null)
                                            }}
                                            disabled={addAccountMutation.isPending}
                                            className="px-3 py-1.5 text-sm rounded border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors disabled:opacity-50"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={addAccountMutation.isPending || !newAccountName.trim()}
                                            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50 hover:opacity-90 transition-opacity"
                                        >
                                            {addAccountMutation.isPending && <Spinner size="sm" label={null} />}
                                            Add Account
                                        </button>
                                    </div>
                                </form>
                            </div>
                        )}

                        {accountError && (
                            <div className="px-3 py-2 text-sm text-red-500 border-b border-[var(--app-divider)]">
                                {accountError}
                            </div>
                        )}

                        {/* Auto Rotate Toggle */}
                        {accounts.length > 1 && (
                            <div className="px-3 py-2.5 flex items-center justify-between gap-3 border-b border-[var(--app-divider)]">
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm">Auto Rotate</div>
                                    <div className="text-[11px] text-[var(--app-hint)] mt-0.5">
                                        Automatically switch when usage exceeds threshold.
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleToggleAutoRotate(!autoRotateEnabled)}
                                    disabled={updateAccountConfigMutation.isPending}
                                    className={`
                                        relative w-11 h-6 rounded-full transition-colors duration-200
                                        ${autoRotateEnabled ? 'bg-emerald-500' : 'bg-[var(--app-border)]'}
                                        ${updateAccountConfigMutation.isPending ? 'opacity-50' : ''}
                                    `}
                                >
                                    <span
                                        className={`
                                            absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200
                                            ${autoRotateEnabled ? 'translate-x-5' : 'translate-x-0'}
                                        `}
                                    />
                                </button>
                            </div>
                        )}

                        {/* Account List */}
                        {accountsLoading ? (
                            <div className="px-3 py-4 flex justify-center">
                                <Spinner size="sm" label="Loading..." />
                            </div>
                        ) : accounts.length === 0 && !showAddAccount ? (
                            <div className="px-3 py-4 text-center space-y-2">
                                <div className="text-sm text-[var(--app-hint)]">
                                    No accounts configured.
                                </div>
                                <button
                                    type="button"
                                    onClick={() => migrateAccountMutation.mutate()}
                                    disabled={migrateAccountMutation.isPending}
                                    className="text-xs text-[var(--app-button)] hover:underline disabled:opacity-50"
                                >
                                    {migrateAccountMutation.isPending ? 'Migrating...' : 'Migrate existing Claude login'}
                                </button>
                            </div>
                        ) : (
                            <div className="divide-y divide-[var(--app-divider)]">
                                {accounts.map((account) => (
                                    <div
                                        key={account.id}
                                        className={`px-3 py-2 ${account.isActive ? 'bg-emerald-500/5' : ''}`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium truncate">{account.name}</span>
                                                    {account.isActive && (
                                                        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-500/20 text-emerald-600">
                                                            Active
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-[var(--app-hint)] font-mono truncate mt-0.5">
                                                    {account.configDir}
                                                </div>
                                                {account.lastUsage && (
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <div className="flex-1 h-1.5 bg-[var(--app-border)] rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all ${
                                                                    account.lastUsage.percentage >= 80
                                                                        ? 'bg-red-500'
                                                                        : account.lastUsage.percentage >= 50
                                                                        ? 'bg-yellow-500'
                                                                        : 'bg-emerald-500'
                                                                }`}
                                                                style={{ width: `${Math.min(100, account.lastUsage.percentage)}%` }}
                                                            />
                                                        </div>
                                                        <span className="text-[10px] text-[var(--app-hint)] tabular-nums">
                                                            {account.lastUsage.percentage.toFixed(0)}%
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                {!account.isActive && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleActivateAccount(account.id)}
                                                        disabled={activateAccountMutation.isPending}
                                                        className="px-2 py-1 text-xs font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] hover:opacity-90 transition-opacity disabled:opacity-50"
                                                    >
                                                        Use
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveAccount(account.id)}
                                                    disabled={removeAccountMutation.isPending || accounts.length === 1}
                                                    className="flex h-7 w-7 items-center justify-center rounded text-[var(--app-hint)] hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                                    title="Remove account"
                                                >
                                                    <TrashIcon />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Notifications Section */}
                    {isNotificationSupported && (
                        <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                            <div className="px-3 py-2 border-b border-[var(--app-divider)]">
                                <h2 className="text-sm font-medium">Notifications</h2>
                                <p className="text-[11px] text-[var(--app-hint)] mt-0.5">
                                    Get notified when AI tasks complete.
                                </p>
                            </div>
                            <div className="divide-y divide-[var(--app-divider)]">
                                <div className="px-3 py-2.5 flex items-center justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm">Push Notifications</div>
                                        <div className="text-[11px] text-[var(--app-hint)] mt-0.5">
                                            {notificationPermission === 'denied'
                                                ? 'Blocked by browser. Enable in system settings.'
                                                : notificationPermission === 'default'
                                                    ? 'Click to enable notifications.'
                                                    : 'Receive alerts when tasks finish.'}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleNotificationToggle}
                                        disabled={notificationPermission === 'denied'}
                                        className={`
                                            relative w-11 h-6 rounded-full transition-colors duration-200
                                            ${notificationPermission === 'denied'
                                                ? 'bg-[var(--app-border)] cursor-not-allowed opacity-50'
                                                : notificationPermission === 'granted' && notificationEnabled
                                                    ? 'bg-emerald-500'
                                                    : 'bg-[var(--app-border)]'
                                            }
                                        `}
                                    >
                                        <span
                                            className={`
                                                absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200
                                                ${notificationPermission === 'granted' && notificationEnabled ? 'translate-x-5' : 'translate-x-0'}
                                            `}
                                        />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Projects Section */}
                    <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                        <div className="px-3 py-2 border-b border-[var(--app-divider)] flex items-center justify-between">
                            <div>
                                <h2 className="text-sm font-medium">Projects</h2>
                                <p className="text-[11px] text-[var(--app-hint)] mt-0.5">
                                    Saved project paths for quick access.
                                </p>
                            </div>
                            {!showAddProject && !editingProject && (
                                <button
                                    type="button"
                                    onClick={() => setShowAddProject(true)}
                                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] hover:opacity-90 transition-opacity"
                                >
                                    <PlusIcon className="w-3 h-3" />
                                    Add
                                </button>
                            )}
                        </div>

                        {/* Add Project Form */}
                        {showAddProject && (
                            <ProjectForm
                                onSubmit={handleAddProject}
                                onCancel={() => {
                                    setShowAddProject(false)
                                    setProjectError(null)
                                }}
                                isPending={addProjectMutation.isPending}
                                submitLabel="Add Project"
                            />
                        )}

                        {projectError && (
                            <div className="px-3 py-2 text-sm text-red-500 border-b border-[var(--app-divider)]">
                                {projectError}
                            </div>
                        )}

                        {/* Project List */}
                        {projectsLoading ? (
                            <div className="px-3 py-4 flex justify-center">
                                <Spinner size="sm" label="Loading..." />
                            </div>
                        ) : projects.length === 0 && !showAddProject ? (
                            <div className="px-3 py-4 text-center text-sm text-[var(--app-hint)]">
                                No projects saved yet.
                            </div>
                        ) : (
                            <div className="divide-y divide-[var(--app-divider)]">
                                {projects.map((project) => (
                                    editingProject?.id === project.id ? (
                                        <ProjectForm
                                            key={project.id}
                                            initial={{
                                                name: project.name,
                                                path: project.path,
                                                description: project.description ?? ''
                                            }}
                                            onSubmit={handleUpdateProject}
                                            onCancel={() => {
                                                setEditingProject(null)
                                                setProjectError(null)
                                            }}
                                            isPending={updateProjectMutation.isPending}
                                            submitLabel="Save"
                                        />
                                    ) : (
                                        <div
                                            key={project.id}
                                            className="px-3 py-2"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm font-medium truncate">{project.name}</div>
                                                    <div className="text-xs text-[var(--app-hint)] font-mono truncate mt-0.5">{project.path}</div>
                                                    {project.description && (
                                                        <div className="text-xs text-[var(--app-hint)] mt-0.5 line-clamp-2">{project.description}</div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditingProject(project)}
                                                        disabled={removeProjectMutation.isPending}
                                                        className="flex h-7 w-7 items-center justify-center rounded text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors disabled:opacity-50"
                                                        title="Edit project"
                                                    >
                                                        <EditIcon />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveProject(project.id)}
                                                        disabled={removeProjectMutation.isPending}
                                                        className="flex h-7 w-7 items-center justify-center rounded text-[var(--app-hint)] hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                                        title="Remove project"
                                                    >
                                                        <TrashIcon />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Users Section */}
                    <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                        <div className="px-3 py-2 border-b border-[var(--app-divider)] flex items-center justify-between">
                            <div>
                                <h2 className="text-sm font-medium">Users</h2>
                                <p className="text-[11px] text-[var(--app-hint)] mt-0.5">
                                    Manage users and their roles. Leave empty to allow all.
                                </p>
                            </div>
                            {canManageUsers && !showAddUser && (
                                <button
                                    type="button"
                                    onClick={() => setShowAddUser(true)}
                                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] hover:opacity-90 transition-opacity"
                                >
                                    <PlusIcon className="w-3 h-3" />
                                    Add
                                </button>
                            )}
                        </div>

                        {/* Add User Form */}
                        {showAddUser && (
                            <form onSubmit={handleAddUser} className="px-3 py-2 border-b border-[var(--app-divider)] space-y-2">
                                <input
                                    type="email"
                                    value={newUserEmail}
                                    onChange={(e) => setNewUserEmail(e.target.value)}
                                    placeholder="email@company.com"
                                    className="w-full px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                                    disabled={addUserMutation.isPending}
                                />
                                <div className="flex items-center gap-2">
                                    <select
                                        value={newUserRole}
                                        onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                                        className="flex-1 px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                                        disabled={addUserMutation.isPending}
                                    >
                                        <option value="developer">Developer (full access)</option>
                                        <option value="operator">Operator (execute only)</option>
                                    </select>
                                </div>
                                <div className="flex justify-end gap-2 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowAddUser(false)
                                            setNewUserEmail('')
                                            setNewUserRole('developer')
                                            setUserError(null)
                                        }}
                                        disabled={addUserMutation.isPending}
                                        className="px-3 py-1.5 text-sm rounded border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={addUserMutation.isPending || !newUserEmail.trim()}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50 hover:opacity-90 transition-opacity"
                                    >
                                        {addUserMutation.isPending && <Spinner size="sm" label={null} />}
                                        Add User
                                    </button>
                                </div>
                            </form>
                        )}

                        {userError && (
                            <div className="px-3 py-2 text-sm text-red-500 border-b border-[var(--app-divider)]">
                                {userError}
                            </div>
                        )}

                        {/* User List */}
                        {usersLoading ? (
                            <div className="px-3 py-4 flex justify-center">
                                <Spinner size="sm" label="Loading..." />
                            </div>
                        ) : users.length === 0 && !showAddUser ? (
                            <div className="px-3 py-4 text-center text-sm text-[var(--app-hint)]">
                                No users configured. All emails are allowed.
                            </div>
                        ) : (
                            <div className="divide-y divide-[var(--app-divider)]">
                                {users.map((user) => (
                                    <div
                                        key={user.email}
                                        className="px-3 py-2 flex items-center justify-between gap-2"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm truncate">{user.email}</div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {canManageUsers ? (
                                                <>
                                                    <select
                                                        value={user.role}
                                                        onChange={(e) => handleUpdateUserRole(user.email, e.target.value as UserRole)}
                                                        disabled={updateUserRoleMutation.isPending}
                                                        className="px-2 py-1 text-xs rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)] disabled:opacity-50"
                                                    >
                                                        <option value="developer">Developer</option>
                                                        <option value="operator">Operator</option>
                                                    </select>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveUser(user.email)}
                                                        disabled={removeUserMutation.isPending}
                                                        className="flex h-7 w-7 items-center justify-center rounded text-[var(--app-hint)] hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                                        title="Remove user"
                                                    >
                                                        <TrashIcon />
                                                    </button>
                                                </>
                                            ) : (
                                                <span className="px-2 py-1 text-xs text-[var(--app-hint)]">
                                                    {user.role === 'developer' ? 'Developer' : 'Operator'}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Input Presets Section */}
                    <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                        <div className="px-3 py-2 border-b border-[var(--app-divider)] flex items-center justify-between">
                            <div>
                                <h2 className="text-sm font-medium">Input Presets</h2>
                                <p className="text-[11px] text-[var(--app-hint)] mt-0.5">
                                    Quick prompts triggered by /command.
                                </p>
                            </div>
                            {!showAddPreset && !editingPreset && (
                                <button
                                    type="button"
                                    onClick={() => setShowAddPreset(true)}
                                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] hover:opacity-90 transition-opacity"
                                >
                                    <PlusIcon className="w-3 h-3" />
                                    Add
                                </button>
                            )}
                        </div>

                        {/* Add Preset Form */}
                        {showAddPreset && (
                            <PresetForm
                                onSubmit={handleAddPreset}
                                onCancel={() => {
                                    setShowAddPreset(false)
                                    setPresetError(null)
                                }}
                                isPending={addPresetMutation.isPending}
                                submitLabel="Add Preset"
                            />
                        )}

                        {presetError && (
                            <div className="px-3 py-2 text-sm text-red-500 border-b border-[var(--app-divider)]">
                                {presetError}
                            </div>
                        )}

                        {/* Preset List */}
                        {presetsLoading ? (
                            <div className="px-3 py-4 flex justify-center">
                                <Spinner size="sm" label="Loading..." />
                            </div>
                        ) : presets.length === 0 && !showAddPreset ? (
                            <div className="px-3 py-4 text-center text-sm text-[var(--app-hint)]">
                                No presets saved yet.
                            </div>
                        ) : (
                            <div className="divide-y divide-[var(--app-divider)]">
                                {presets.map((preset) => (
                                    editingPreset?.id === preset.id ? (
                                        <PresetForm
                                            key={preset.id}
                                            initial={{
                                                trigger: preset.trigger,
                                                title: preset.title,
                                                prompt: preset.prompt
                                            }}
                                            onSubmit={handleUpdatePreset}
                                            onCancel={() => {
                                                setEditingPreset(null)
                                                setPresetError(null)
                                            }}
                                            isPending={updatePresetMutation.isPending}
                                            submitLabel="Save"
                                        />
                                    ) : (
                                        <div
                                            key={preset.id}
                                            className="px-3 py-2"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm font-medium truncate">/{preset.trigger}</div>
                                                    <div className="text-xs text-[var(--app-hint)] truncate mt-0.5">{preset.title}</div>
                                                    <div className="text-xs text-[var(--app-hint)] mt-1 line-clamp-2 font-mono bg-[var(--app-bg)] rounded px-1.5 py-1">
                                                        {preset.prompt.slice(0, 100)}{preset.prompt.length > 100 ? '...' : ''}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditingPreset(preset)}
                                                        disabled={removePresetMutation.isPending}
                                                        className="flex h-7 w-7 items-center justify-center rounded text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors disabled:opacity-50"
                                                        title="Edit preset"
                                                    >
                                                        <EditIcon />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemovePreset(preset.id)}
                                                        disabled={removePresetMutation.isPending}
                                                        className="flex h-7 w-7 items-center justify-center rounded text-[var(--app-hint)] hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                                        title="Remove preset"
                                                    >
                                                        <TrashIcon />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                ))}
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </div>
    )
}
