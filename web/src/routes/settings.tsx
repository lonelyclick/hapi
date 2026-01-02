import { useCallback, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { Spinner } from '@/components/Spinner'
import { getClientId, getDeviceType, getStoredEmail } from '@/lib/client-identity'
import type { Project, UserRole } from '@/types/api'

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

    const projects = projectsData?.projects ?? []
    const users = usersData?.users ?? []

    // 判断当前用户是否为 Developer（有权限管理用户）
    // 如果用户列表为空，默认所有人都有权限；否则根据邮箱查找角色
    const currentUserRole = useMemo(() => {
        if (users.length === 0) return 'developer' // 无用户配置时，允许所有
        const currentEmail = currentSession.email.toLowerCase()
        const user = users.find(u => u.email.toLowerCase() === currentEmail)
        return user?.role ?? 'developer' // 未找到时默认 developer（兼容性）
    }, [users, currentSession.email])

    const canManageUsers = currentUserRole === 'developer'

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

                </div>
            </div>
        </div>
    )
}
