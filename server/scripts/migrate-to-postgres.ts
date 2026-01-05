/**
 * SQLite to PostgreSQL Migration Script
 *
 * Usage:
 *   STORE_TYPE=postgres PG_HOST=... PG_USER=... PG_PASSWORD=... PG_DATABASE=... \
 *   bun run scripts/migrate-to-postgres.ts
 *
 * This script reads all data from SQLite and migrates it to PostgreSQL.
 */

// Import the original Store class directly (bun:sqlite based)
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

async function migrate() {
    console.log('='.repeat(60))
    console.log('SQLite to PostgreSQL Migration')
    console.log('='.repeat(60))
    console.log(`SQLite: ${sqlitePath}`)
    console.log(`PostgreSQL: ${pgConfig.host}/${pgConfig.database}`)
    console.log('='.repeat(60))

    // Initialize stores
    console.log('\n[1/3] Initializing stores...')
    const sqlite = new Store(sqlitePath)
    const pg = await PostgresStore.create(pgConfig)
    console.log('  ✓ Both stores initialized')

    // Get all tables/data from SQLite
    console.log('\n[2/3] Reading data from SQLite...')

    // Session
    const sessions = sqlite.getSessions()
    console.log(`  Sessions: ${sessions.length}`)

    // Machines
    const machines = sqlite.getMachines()
    console.log(`  Machines: ${machines.length}`)

    // Messages - need to collect from all sessions
    let totalMessages = 0
    const sessionMessages: Map<string, any[]> = new Map()
    for (const session of sessions) {
        const msgs = sqlite.getMessages(session.id, 10000)
        sessionMessages.set(session.id, msgs)
        totalMessages += msgs.length
    }
    console.log(`  Messages: ${totalMessages}`)

    // Users
    const users = sqlite.getUsersByPlatform('telegram')
    console.log(`  Users: ${users.length}`)

    // Allowed emails
    const allowedUsers = sqlite.getAllowedUsers()
    console.log(`  Allowed emails: ${allowedUsers.length}`)

    // Projects
    const projects = sqlite.getProjects()
    console.log(`  Projects: ${projects.length}`)

    // Role prompts
    const rolePrompts = sqlite.getAllRolePrompts()
    console.log(`  Role prompts: ${rolePrompts.length}`)

    // Input presets
    const inputPresets = sqlite.getAllInputPresets()
    console.log(`  Input presets: ${inputPresets.length}`)

    // Push subscriptions - collect by namespace
    const pushSubs = sqlite.getPushSubscriptions('default')
    console.log(`  Push subscriptions: ${pushSubs.length}`)

    // Agent groups
    const agentGroups = sqlite.getAgentGroups('default')
    console.log(`  Agent groups: ${agentGroups.length}`)

    // AI Profiles
    const aiProfiles = sqlite.getAIProfiles('default')
    console.log(`  AI profiles: ${aiProfiles.length}`)

    // AI Teams
    const aiTeams = sqlite.getAITeams('default')
    console.log(`  AI teams: ${aiTeams.length}`)

    // Migration
    console.log('\n[3/3] Migrating data to PostgreSQL...')

    // Migrate sessions (use raw insert to preserve IDs)
    console.log('  Migrating sessions...')
    let sessionCount = 0
    for (const session of sessions) {
        try {
            await pg.insertSessionRaw(session)
            sessionCount++
        } catch (e) {
            console.log(`    ! Session ${session.id} error: ${(e as Error).message}`)
        }
    }
    console.log(`    ✓ ${sessionCount}/${sessions.length} sessions`)

    // Migrate machines (use raw insert to preserve IDs)
    console.log('  Migrating machines...')
    let machineCount = 0
    for (const machine of machines) {
        try {
            await pg.insertMachineRaw(machine)
            machineCount++
        } catch (e) {
            console.log(`    ! Machine ${machine.id} error: ${(e as Error).message}`)
        }
    }
    console.log(`    ✓ ${machineCount}/${machines.length} machines`)

    // Migrate users
    console.log('  Migrating users...')
    let userCount = 0
    for (const user of users) {
        try {
            await pg.addUser(user.platform, user.platformUserId, user.namespace, user.role)
            userCount++
        } catch (e) {
            console.log(`    ! User ${user.platformUserId} error: ${(e as Error).message}`)
        }
    }
    console.log(`    ✓ ${userCount}/${users.length} users`)

    // Migrate allowed emails
    console.log('  Migrating allowed emails...')
    let emailCount = 0
    for (const email of allowedUsers) {
        try {
            await pg.addAllowedEmail(email.email, email.role)
            emailCount++
        } catch (e) {
            console.log(`    ! Email ${email.email} error: ${(e as Error).message}`)
        }
    }
    console.log(`    ✓ ${emailCount}/${allowedUsers.length} allowed emails`)

    // Migrate projects
    console.log('  Migrating projects...')
    let projectCount = 0
    for (const project of projects) {
        try {
            await pg.addProject(project.name, project.path, project.description ?? undefined)
            projectCount++
        } catch (e) {
            console.log(`    ! Project ${project.name} error: ${(e as Error).message}`)
        }
    }
    console.log(`    ✓ ${projectCount}/${projects.length} projects`)

    // Migrate role prompts
    console.log('  Migrating role prompts...')
    let promptCount = 0
    for (const prompt of rolePrompts) {
        try {
            await pg.setRolePrompt(prompt.role, prompt.prompt)
            promptCount++
        } catch (e) {
            console.log(`    ! Role prompt ${prompt.role} error: ${(e as Error).message}`)
        }
    }
    console.log(`    ✓ ${promptCount}/${rolePrompts.length} role prompts`)

    // Migrate input presets
    console.log('  Migrating input presets...')
    let presetCount = 0
    for (const preset of inputPresets) {
        try {
            await pg.addInputPreset(preset.trigger, preset.title, preset.prompt)
            presetCount++
        } catch (e) {
            console.log(`    ! Input preset ${preset.trigger} error: ${(e as Error).message}`)
        }
    }
    console.log(`    ✓ ${presetCount}/${inputPresets.length} input presets`)

    // Migrate push subscriptions
    console.log('  Migrating push subscriptions...')
    let pushCount = 0
    for (const sub of pushSubs) {
        try {
            await pg.addOrUpdatePushSubscription({
                namespace: sub.namespace,
                endpoint: sub.endpoint,
                keys: sub.keys,
                userAgent: sub.userAgent ?? undefined,
                clientId: sub.clientId ?? undefined,
                chatId: sub.chatId ?? undefined
            })
            pushCount++
        } catch (e) {
            console.log(`    ! Push sub error: ${(e as Error).message}`)
        }
    }
    console.log(`    ✓ ${pushCount}/${pushSubs.length} push subscriptions`)

    // Migrate messages (use raw insert to preserve IDs and session refs)
    console.log('  Migrating messages...')
    let msgCount = 0
    let msgErrors = 0
    for (const [sessionId, messages] of sessionMessages) {
        for (const msg of messages) {
            try {
                await pg.insertMessageRaw(msg)
                msgCount++
            } catch (e) {
                msgErrors++
                // Skip errors for messages - they might have session FK issues
            }
        }
    }
    console.log(`    ✓ ${msgCount}/${totalMessages} messages${msgErrors > 0 ? ` (${msgErrors} errors)` : ''}`)

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('Migration complete!')
    console.log('='.repeat(60))

    // Cleanup
    await pg.close()
}

// Run migration
migrate().catch(err => {
    console.error('Migration failed:', err)
    process.exit(1)
})
