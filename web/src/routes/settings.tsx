import { useCallback, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { Spinner } from '@/components/Spinner'
import { getClientId, getDeviceType, getStoredEmail } from '@/lib/client-identity'
import type { Project } from '@/types/api'

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
    const [newEmail, setNewEmail] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [projectError, setProjectError] = useState<string | null>(null)
    const [showAddProject, setShowAddProject] = useState(false)
    const [editingProject, setEditingProject] = useState<Project | null>(null)

    // 当前会话信息
    const currentSession = useMemo(() => ({
        email: getStoredEmail() || '-',
        clientId: getClientId(),
        deviceType: getDeviceType()
    }), [])

    // Allowed Emails
    const { data: emailsData, isLoading: emailsLoading } = useQuery({
        queryKey: ['allowed-emails'],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getAllowedEmails()
        },
        enabled: Boolean(api)
    })

    const addEmailMutation = useMutation({
        mutationFn: async (email: string) => {
            if (!api) throw new Error('API unavailable')
            return await api.addAllowedEmail(email)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['allowed-emails'], { emails: result.emails })
            setNewEmail('')
            setError(null)
        },
        onError: (err) => {
            setError(err instanceof Error ? err.message : 'Failed to add email')
        }
    })

    const removeEmailMutation = useMutation({
        mutationFn: async (email: string) => {
            if (!api) throw new Error('API unavailable')
            return await api.removeAllowedEmail(email)
        },
        onSuccess: (result) => {
            queryClient.setQueryData(['allowed-emails'], { emails: result.emails })
        },
        onError: (err) => {
            setError(err instanceof Error ? err.message : 'Failed to remove email')
        }
    })

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

    const handleAddEmail = useCallback((e: React.FormEvent) => {
        e.preventDefault()
        const trimmedEmail = newEmail.trim().toLowerCase()
        if (!trimmedEmail) return
        addEmailMutation.mutate(trimmedEmail)
    }, [newEmail, addEmailMutation])

    const handleRemoveEmail = useCallback((email: string) => {
        removeEmailMutation.mutate(email)
    }, [removeEmailMutation])

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

    const emails = emailsData?.emails ?? []
    const projects = projectsData?.projects ?? []

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

            <div className="flex-1 overflow-y-auto">
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
                                <span className="text-sm text-[var(--app-hint)]">Device</span>
                                <span className="text-sm font-mono">{currentSession.deviceType}</span>
                            </div>
                            <div className="px-3 py-2 flex items-center justify-between gap-2">
                                <span className="text-sm text-[var(--app-hint)]">Client ID</span>
                                <span className="text-sm font-mono">{currentSession.clientId}</span>
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

                    {/* Allowed Emails Section */}
                    <div className="rounded-lg bg-[var(--app-subtle-bg)] overflow-hidden">
                        <div className="px-3 py-2 border-b border-[var(--app-divider)]">
                            <h2 className="text-sm font-medium">Allowed Emails</h2>
                            <p className="text-[11px] text-[var(--app-hint)] mt-0.5">
                                Only these emails can login. Leave empty to allow all.
                            </p>
                        </div>

                        {/* Add Email Form */}
                        <form onSubmit={handleAddEmail} className="px-3 py-2 border-b border-[var(--app-divider)] flex gap-2">
                            <input
                                type="email"
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                                placeholder="email@company.com"
                                className="flex-1 px-2 py-1.5 text-sm rounded border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-1 focus:ring-[var(--app-button)]"
                                disabled={addEmailMutation.isPending}
                            />
                            <button
                                type="submit"
                                disabled={addEmailMutation.isPending || !newEmail.trim()}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50 hover:opacity-90 transition-opacity"
                            >
                                {addEmailMutation.isPending ? (
                                    <Spinner size="sm" label={null} />
                                ) : (
                                    <PlusIcon />
                                )}
                                Add
                            </button>
                        </form>

                        {error && (
                            <div className="px-3 py-2 text-sm text-red-500 border-b border-[var(--app-divider)]">
                                {error}
                            </div>
                        )}

                        {/* Email List */}
                        {emailsLoading ? (
                            <div className="px-3 py-4 flex justify-center">
                                <Spinner size="sm" label="Loading..." />
                            </div>
                        ) : emails.length === 0 ? (
                            <div className="px-3 py-4 text-center text-sm text-[var(--app-hint)]">
                                No emails configured. All emails are allowed.
                            </div>
                        ) : (
                            <div className="divide-y divide-[var(--app-divider)]">
                                {emails.map((email) => (
                                    <div
                                        key={email}
                                        className="px-3 py-2 flex items-center justify-between gap-2"
                                    >
                                        <span className="text-sm truncate">{email}</span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveEmail(email)}
                                            disabled={removeEmailMutation.isPending}
                                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--app-hint)] hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                            title="Remove email"
                                        >
                                            <TrashIcon />
                                        </button>
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
