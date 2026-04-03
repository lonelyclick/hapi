/**
 * Project MCP Tools
 *
 * Provides project CRUD tools for all sessions (brain and non-brain).
 * Projects are scoped to the session's organization via server-side orgId resolution.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ApiClient } from '@/api/api'
import { logger } from '@/ui/logger'

interface ProjectToolsOptions {
    apiClient: ApiClient
    sessionId: string
    machineId?: string
}

export function registerProjectTools(
    mcp: McpServer,
    toolNames: string[],
    options: ProjectToolsOptions
): void {
    const { apiClient: api, sessionId, machineId } = options

    // ===== 1. project_list =====
    const listSchema: z.ZodTypeAny = z.object({
        machineId: z.string().optional().describe('Filter by machine ID. If omitted, returns projects for the current machine and global projects.'),
    })

    mcp.registerTool<any, any>('project_list', {
        title: 'List Projects',
        description: 'List all projects. Returns projects associated with the current organization. Can filter by machineId.',
        inputSchema: listSchema,
    }, async (args: { machineId?: string }) => {
        try {
            const projects = await api.getProjects(sessionId, args.machineId ?? machineId)
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(projects, null, 2) }],
            }
        } catch (error: any) {
            logger.debug('[projectTools] project_list error:', error.message)
            return {
                content: [{ type: 'text' as const, text: `Failed to list projects: ${error.response?.data?.error ?? error.message}` }],
                isError: true,
            }
        }
    })
    toolNames.push('project_list')

    // ===== 2. project_create =====
    const createSchema: z.ZodTypeAny = z.object({
        name: z.string().describe('Project name (max 100 chars)'),
        path: z.string().describe('Absolute path to the project directory'),
        description: z.string().optional().describe('Project description (max 500 chars)'),
        machineId: z.string().nullable().optional().describe('Associated machine ID. Null for global projects.'),
    })

    mcp.registerTool<any, any>('project_create', {
        title: 'Create Project',
        description: 'Create a new project. The project is associated with the current organization.',
        inputSchema: createSchema,
    }, async (args: { name: string; path: string; description?: string; machineId?: string | null }) => {
        try {
            const project = await api.addProject(sessionId, {
                name: args.name,
                path: args.path,
                description: args.description,
                machineId: args.machineId,
            })
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(project, null, 2) }],
            }
        } catch (error: any) {
            logger.debug('[projectTools] project_create error:', error.message)
            return {
                content: [{ type: 'text' as const, text: `Failed to create project: ${error.response?.data?.error ?? error.message}` }],
                isError: true,
            }
        }
    })
    toolNames.push('project_create')

    // ===== 3. project_update =====
    const updateSchema: z.ZodTypeAny = z.object({
        id: z.string().describe('Project ID to update'),
        name: z.string().describe('New project name (max 100 chars)'),
        path: z.string().describe('New absolute path'),
        description: z.string().optional().describe('New description (max 500 chars)'),
        machineId: z.string().nullable().optional().describe('New machine ID. Null for global projects.'),
    })

    mcp.registerTool<any, any>('project_update', {
        title: 'Update Project',
        description: 'Update an existing project.',
        inputSchema: updateSchema,
    }, async (args: { id: string; name: string; path: string; description?: string; machineId?: string | null }) => {
        try {
            const project = await api.updateProject(sessionId, args.id, {
                name: args.name,
                path: args.path,
                description: args.description,
                machineId: args.machineId,
            })
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(project, null, 2) }],
            }
        } catch (error: any) {
            logger.debug('[projectTools] project_update error:', error.message)
            return {
                content: [{ type: 'text' as const, text: `Failed to update project: ${error.response?.data?.error ?? error.message}` }],
                isError: true,
            }
        }
    })
    toolNames.push('project_update')

    // ===== 4. project_delete =====
    const deleteSchema: z.ZodTypeAny = z.object({
        id: z.string().describe('Project ID to delete'),
    })

    mcp.registerTool<any, any>('project_delete', {
        title: 'Delete Project',
        description: 'Delete a project by ID.',
        inputSchema: deleteSchema,
    }, async (args: { id: string }) => {
        try {
            const success = await api.removeProject(sessionId, args.id)
            if (success) {
                return {
                    content: [{ type: 'text' as const, text: 'Project deleted successfully.' }],
                }
            }
            return {
                content: [{ type: 'text' as const, text: 'Failed to delete project.' }],
                isError: true,
            }
        } catch (error: any) {
            logger.debug('[projectTools] project_delete error:', error.message)
            return {
                content: [{ type: 'text' as const, text: `Failed to delete project: ${error.response?.data?.error ?? error.message}` }],
                isError: true,
            }
        }
    })
    toolNames.push('project_delete')
}
