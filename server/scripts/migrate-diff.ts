/**
 * SQLite to PostgreSQL Incremental Migration Script
 *
 * Usage:
 *   bun run scripts/migrate-diff.ts
 *
 * This script migrates only NEW data from SQLite to PostgreSQL.
 * It compares timestamps and IDs to avoid duplicates.
 */

import { Store } from '../src/store/index'
import { PostgresStore } from '../src/store/postgres'
import { homedir } from 'node:os'
import { join } from 'node:path'

// PostgreSQL configuration
const pgConfig = {
    host: process.env.PG_HOST || '101.100.174.21',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'guang',
    password: process.env.PG_PASSWORD || 'Root,./000000',
    database: process.env.PG_DATABASE || 'yoho_remote',
    ssl: process.env.PG_SSL === 'true'
}

// SQLite path
const sqlitePath = process.env.DB_PATH || join(homedir(), '.hapi', 'hapi.db')

async function migrateDiff() {
    console.log('='.repeat(60))
    console.log('SQLite to PostgreSQL Incremental Migration')
    console.log('='.repeat(60))
    console.log(`SQLite: ${sqlitePath}`)
    console.log(`PostgreSQL: ${pgConfig.host}/${pgConfig.database}`)
    console.log('='.repeat(60))

    // Initialize stores
    console.log('\n[1/4] Initializing stores...')
    const sqlite = new Store(sqlitePath)
    const pg = await PostgresStore.create(pgConfig)
    console.log('  ✓ Both stores initialized')

    // Get existing IDs from PostgreSQL
    console.log('\n[2/4] Fetching existing data from PostgreSQL...')
    const pgSessions = await pg.getSessions()
    const pgSessionIds = new Set(pgSessions.map(s => s.id))
    console.log(`  PostgreSQL sessions: ${pgSessions.length}`)

    const pgMachines = await pg.getMachines()
    const pgMachineIds = new Set(pgMachines.map(m => m.id))
    console.log(`  PostgreSQL machines: ${pgMachines.length}`)

    // Get message counts per session
    const pgMessageCounts = new Map<string, number>()
    for (const session of pgSessions) {
        const count = await pg.getMessageCount(session.id)
        pgMessageCounts.set(session.id, count)
    }

    // Get SQLite data
    console.log('\n[3/4] Reading data from SQLite...')
    const sqliteSessions = sqlite.getSessions()
    const sqliteMachines = sqlite.getMachines()
    console.log(`  SQLite sessions: ${sqliteSessions.length}`)
    console.log(`  SQLite machines: ${sqliteMachines.length}`)

    // Find new sessions
    const newSessions = sqliteSessions.filter(s => !pgSessionIds.has(s.id))
    console.log(`  New sessions to migrate: ${newSessions.length}`)

    // Find new machines
    const newMachines = sqliteMachines.filter(m => !pgMachineIds.has(m.id))
    console.log(`  New machines to migrate: ${newMachines.length}`)

    // Collect messages - both from new sessions and new messages in existing sessions
    const messagesToMigrate: Array<{ sessionId: string, messages: any[] }> = []
    let totalNewMessages = 0

    for (const session of sqliteSessions) {
        const sqliteMessages = sqlite.getMessages(session.id, 100000)

        if (!pgSessionIds.has(session.id)) {
            // New session - migrate all messages
            messagesToMigrate.push({ sessionId: session.id, messages: sqliteMessages })
            totalNewMessages += sqliteMessages.length
        } else {
            // Existing session - find new messages by comparing counts
            const pgCount = pgMessageCounts.get(session.id) || 0
            if (sqliteMessages.length > pgCount) {
                // Get only the new messages (by seq number)
                const newMessages = sqliteMessages.slice(pgCount)
                if (newMessages.length > 0) {
                    messagesToMigrate.push({ sessionId: session.id, messages: newMessages })
                    totalNewMessages += newMessages.length
                }
            }
        }
    }
    console.log(`  New messages to migrate: ${totalNewMessages}`)

    // Migration
    console.log('\n[4/4] Migrating new data to PostgreSQL...')

    // Migrate new sessions
    if (newSessions.length > 0) {
        console.log('  Migrating new sessions...')
        let sessionCount = 0
        for (const session of newSessions) {
            try {
                await pg.insertSessionRaw(session)
                sessionCount++
            } catch (e) {
                console.log(`    ! Session ${session.id} error: ${(e as Error).message}`)
            }
        }
        console.log(`    ✓ ${sessionCount}/${newSessions.length} sessions`)
    } else {
        console.log('  No new sessions to migrate')
    }

    // Migrate new machines
    if (newMachines.length > 0) {
        console.log('  Migrating new machines...')
        let machineCount = 0
        for (const machine of newMachines) {
            try {
                await pg.insertMachineRaw(machine)
                machineCount++
            } catch (e) {
                console.log(`    ! Machine ${machine.id} error: ${(e as Error).message}`)
            }
        }
        console.log(`    ✓ ${machineCount}/${newMachines.length} machines`)
    } else {
        console.log('  No new machines to migrate')
    }

    // Migrate new messages
    if (totalNewMessages > 0) {
        console.log('  Migrating new messages...')
        let msgCount = 0
        let msgErrors = 0
        for (const { sessionId, messages } of messagesToMigrate) {
            for (const msg of messages) {
                try {
                    await pg.insertMessageRaw(msg)
                    msgCount++
                } catch (e) {
                    msgErrors++
                }
            }
        }
        console.log(`    ✓ ${msgCount}/${totalNewMessages} messages${msgErrors > 0 ? ` (${msgErrors} errors)` : ''}`)
    } else {
        console.log('  No new messages to migrate')
    }

    // Also check for other tables that might have new data
    await migrateOtherTables(sqlite, pg)

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('Incremental migration complete!')
    console.log('='.repeat(60))

    // Cleanup
    await pg.close()
}

async function migrateOtherTables(sqlite: Store, pg: PostgresStore) {
    // Users
    const sqliteUsers = sqlite.getUsersByPlatform('telegram')
    const pgUsers = await pg.getUsersByPlatform('telegram')
    const pgUserIds = new Set(pgUsers.map(u => `${u.platform}:${u.platformUserId}`))
    const newUsers = sqliteUsers.filter(u => !pgUserIds.has(`${u.platform}:${u.platformUserId}`))

    if (newUsers.length > 0) {
        console.log(`  Migrating ${newUsers.length} new users...`)
        for (const user of newUsers) {
            try {
                await pg.addUser(user.platform, user.platformUserId, user.namespace, user.role)
            } catch (e) {
                // Ignore duplicates
            }
        }
    }

    // Allowed emails
    const sqliteEmails = sqlite.getAllowedUsers()
    const pgEmails = await pg.getAllowedUsers()
    const pgEmailSet = new Set(pgEmails.map(e => e.email))
    const newEmails = sqliteEmails.filter(e => !pgEmailSet.has(e.email))

    if (newEmails.length > 0) {
        console.log(`  Migrating ${newEmails.length} new allowed emails...`)
        for (const email of newEmails) {
            try {
                await pg.addAllowedEmail(email.email, email.role)
            } catch (e) {
                // Ignore duplicates
            }
        }
    }

    // Projects
    const sqliteProjects = sqlite.getProjects()
    const pgProjects = await pg.getProjects()
    const pgProjectNames = new Set(pgProjects.map(p => p.name))
    const newProjects = sqliteProjects.filter(p => !pgProjectNames.has(p.name))

    if (newProjects.length > 0) {
        console.log(`  Migrating ${newProjects.length} new projects...`)
        for (const project of newProjects) {
            try {
                await pg.addProject(project.name, project.path, project.description ?? undefined)
            } catch (e) {
                // Ignore duplicates
            }
        }
    }

    // Role prompts - update existing ones too
    const sqlitePrompts = sqlite.getAllRolePrompts()
    if (sqlitePrompts.length > 0) {
        console.log(`  Syncing ${sqlitePrompts.length} role prompts...`)
        for (const prompt of sqlitePrompts) {
            try {
                await pg.setRolePrompt(prompt.role, prompt.prompt)
            } catch (e) {
                // Ignore errors
            }
        }
    }

    // Input presets
    const sqlitePresets = sqlite.getAllInputPresets()
    const pgPresets = await pg.getAllInputPresets()
    const pgPresetTriggers = new Set(pgPresets.map(p => p.trigger))
    const newPresets = sqlitePresets.filter(p => !pgPresetTriggers.has(p.trigger))

    if (newPresets.length > 0) {
        console.log(`  Migrating ${newPresets.length} new input presets...`)
        for (const preset of newPresets) {
            try {
                await pg.addInputPreset(preset.trigger, preset.title, preset.prompt)
            } catch (e) {
                // Ignore duplicates
            }
        }
    }

    // Push subscriptions - by endpoint
    const sqlitePushSubs = sqlite.getPushSubscriptions('default')
    const pgPushSubs = await pg.getPushSubscriptions('default')
    const pgEndpoints = new Set(pgPushSubs.map(s => s.endpoint))
    const newPushSubs = sqlitePushSubs.filter(s => !pgEndpoints.has(s.endpoint))

    if (newPushSubs.length > 0) {
        console.log(`  Migrating ${newPushSubs.length} new push subscriptions...`)
        for (const sub of newPushSubs) {
            try {
                await pg.addOrUpdatePushSubscription({
                    namespace: sub.namespace,
                    endpoint: sub.endpoint,
                    keys: sub.keys,
                    userAgent: sub.userAgent ?? undefined,
                    clientId: sub.clientId ?? undefined,
                    chatId: sub.chatId ?? undefined
                })
            } catch (e) {
                // Ignore duplicates
            }
        }
    }
}

// Run migration
migrateDiff().catch(err => {
    console.error('Migration failed:', err)
    process.exit(1)
})
