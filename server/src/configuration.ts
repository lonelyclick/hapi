/**
 * Configuration for hapi-server (Direct Connect)
 *
 * Configuration is loaded with priority: environment variable > settings.json > default
 * When values are read from environment variables and not present in settings.json,
 * they are automatically saved for future use.
 *
 * Optional environment variables:
 * - CLI_API_TOKEN: Shared secret for hapi CLI authentication (auto-generated if not set)
 * - TELEGRAM_BOT_TOKEN: Telegram Bot API token from @BotFather
 * - WEBAPP_PORT: Port for Mini App HTTP server (default: 3006)
 * - WEBAPP_URL: Public URL for Telegram Mini App
 * - CORS_ORIGINS: Comma-separated CORS origins
 * - FEISHU_APP_ID: Feishu/Lark app ID for speech-to-text
 * - FEISHU_APP_SECRET: Feishu/Lark app secret for speech-to-text
 * - FEISHU_BASE_URL: Feishu/Lark OpenAPI base URL (default: https://open.feishu.cn)
 * - HAPI_HOME: Data directory (default: ~/.hapi)
 * - DB_PATH: SQLite database path (default: {HAPI_HOME}/hapi.db)
 * - STORE_TYPE: Database backend type: 'sqlite' | 'postgres' (default: sqlite)
 * - PG_HOST: PostgreSQL host
 * - PG_PORT: PostgreSQL port (default: 5432)
 * - PG_USER: PostgreSQL user
 * - PG_PASSWORD: PostgreSQL password
 * - PG_DATABASE: PostgreSQL database name
 * - PG_SSL: PostgreSQL SSL mode (default: false)
 */

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadServerSettings, type ServerSettings, type ServerSettingsResult } from './serverSettings'
import { getOrCreateCliApiToken } from './web/cliApiToken'
import type { StoreConfig, PostgresConfig } from './store/types'

export type ConfigSource = 'env' | 'file' | 'default'
export type StoreType = 'sqlite' | 'postgres'

export interface ConfigSources {
    telegramBotToken: ConfigSource
    webappPort: ConfigSource
    webappUrl: ConfigSource
    corsOrigins: ConfigSource
    feishuAppId: ConfigSource
    feishuAppSecret: ConfigSource
    feishuBaseUrl: ConfigSource
    geminiApiKey: ConfigSource
    webPushVapidPublicKey?: ConfigSource
    webPushVapidPrivateKey?: ConfigSource
    webPushVapidSubject?: ConfigSource
    cliApiToken: 'env' | 'file' | 'generated'
}

class Configuration {
    /** Telegram Bot API token */
    public readonly telegramBotToken: string | null

    /** Telegram bot enabled status (token present) */
    public readonly telegramEnabled: boolean

    /** CLI auth token (shared secret) */
    public cliApiToken: string

    /** Source of CLI API token */
    public cliApiTokenSource: 'env' | 'file' | 'generated' | ''

    /** Whether CLI API token was newly generated (for first-run display) */
    public cliApiTokenIsNew: boolean

    /** Path to settings.json file */
    public readonly settingsFile: string

    /** Data directory for credentials and state */
    public readonly dataDir: string

    /** SQLite DB path */
    public readonly dbPath: string

    /** Port for the Mini App HTTP server */
    public readonly webappPort: number

    /** Public HTTPS URL for the Telegram Mini App (used in WebApp buttons) */
    public readonly miniAppUrl: string

    /** Allowed CORS origins for Mini App + Socket.IO (comma-separated env override) */
    public readonly corsOrigins: string[]

    /** Feishu/Lark app ID (speech-to-text) */
    public readonly feishuAppId: string | null

    /** Feishu/Lark app secret (speech-to-text) */
    public readonly feishuAppSecret: string | null

    /** Feishu/Lark OpenAPI base URL */
    public readonly feishuBaseUrl: string

    /** Gemini API key (text optimization) */
    public readonly geminiApiKey: string | null

    /** Web Push VAPID public key */
    public readonly webPushVapidPublicKey: string | null

    /** Web Push VAPID private key */
    public readonly webPushVapidPrivateKey: string | null

    /** Web Push VAPID subject (mailto: or https: URL) */
    public readonly webPushVapidSubject: string | null

    /** Store type: 'sqlite' or 'postgres' */
    public readonly storeType: StoreType

    /** PostgreSQL configuration (when storeType is 'postgres') */
    public readonly postgresConfig: PostgresConfig | null

    /** Sources of each configuration value */
    public readonly sources: ConfigSources

    /** Private constructor - use createConfiguration() instead */
    private constructor(
        dataDir: string,
        dbPath: string,
        serverSettings: ServerSettings,
        sources: ServerSettingsResult['sources'],
        storeType: StoreType,
        postgresConfig: PostgresConfig | null
    ) {
        this.dataDir = dataDir
        this.dbPath = dbPath
        this.settingsFile = join(dataDir, 'settings.json')

        // Apply server settings
        this.telegramBotToken = serverSettings.telegramBotToken
        this.telegramEnabled = Boolean(this.telegramBotToken)
        this.webappPort = serverSettings.webappPort
        this.miniAppUrl = serverSettings.webappUrl
        this.corsOrigins = serverSettings.corsOrigins
        this.feishuAppId = serverSettings.feishuAppId
        this.feishuAppSecret = serverSettings.feishuAppSecret
        this.feishuBaseUrl = serverSettings.feishuBaseUrl
        this.geminiApiKey = serverSettings.geminiApiKey
        this.webPushVapidPublicKey = serverSettings.webPushVapidPublicKey
        this.webPushVapidPrivateKey = serverSettings.webPushVapidPrivateKey
        this.webPushVapidSubject = serverSettings.webPushVapidSubject

        // Store configuration
        this.storeType = storeType
        this.postgresConfig = postgresConfig

        // CLI API token - will be set by _setCliApiToken() before create() returns
        this.cliApiToken = ''
        this.cliApiTokenSource = ''
        this.cliApiTokenIsNew = false

        // Store sources for logging (cliApiToken will be set by _setCliApiToken)
        this.sources = {
            ...sources,
        } as ConfigSources

        // Ensure data directory exists
        if (!existsSync(this.dataDir)) {
            mkdirSync(this.dataDir, { recursive: true })
        }
    }

    /** Create configuration asynchronously */
    static async create(): Promise<Configuration> {
        // 1. Determine data directory (env only - not persisted)
        const dataDir = process.env.HAPI_HOME
            ? process.env.HAPI_HOME.replace(/^~/, homedir())
            : join(homedir(), '.hapi')

        // Ensure data directory exists before loading settings
        if (!existsSync(dataDir)) {
            mkdirSync(dataDir, { recursive: true })
        }

        // 2. Determine DB path (env only - not persisted)
        const dbPath = process.env.DB_PATH
            ? process.env.DB_PATH.replace(/^~/, homedir())
            : join(dataDir, 'hapi.db')

        // 3. Load server settings (with persistence)
        const settingsResult = await loadServerSettings(dataDir)

        if (settingsResult.savedToFile) {
            console.log(`[Server] Configuration saved to ${join(dataDir, 'settings.json')}`)
        }

        // 4. Determine store type and PostgreSQL config
        const storeTypeEnv = process.env.STORE_TYPE?.toLowerCase()
        const storeType: StoreType = storeTypeEnv === 'postgres' || storeTypeEnv === 'postgresql'
            ? 'postgres'
            : 'sqlite'

        let postgresConfig: PostgresConfig | null = null
        if (storeType === 'postgres') {
            const pgHost = process.env.PG_HOST
            const pgUser = process.env.PG_USER
            const pgPassword = process.env.PG_PASSWORD
            const pgDatabase = process.env.PG_DATABASE

            if (!pgHost || !pgUser || !pgPassword || !pgDatabase) {
                throw new Error(
                    'PostgreSQL configuration incomplete. Required environment variables: ' +
                    'PG_HOST, PG_USER, PG_PASSWORD, PG_DATABASE'
                )
            }

            postgresConfig = {
                host: pgHost,
                port: parseInt(process.env.PG_PORT || '5432', 10),
                user: pgUser,
                password: pgPassword,
                database: pgDatabase,
                ssl: process.env.PG_SSL === 'true' || process.env.PG_SSL === '1'
            }
        }

        // 5. Create configuration instance
        const config = new Configuration(
            dataDir,
            dbPath,
            settingsResult.settings,
            settingsResult.sources,
            storeType,
            postgresConfig
        )

        // 6. Load CLI API token
        const tokenResult = await getOrCreateCliApiToken(dataDir)
        config._setCliApiToken(tokenResult.token, tokenResult.source, tokenResult.isNew)

        return config
    }

    /** Get StoreConfig for store initialization */
    getStoreConfig(): StoreConfig {
        return {
            type: this.storeType,
            sqlitePath: this.dbPath,
            postgres: this.postgresConfig ?? undefined
        }
    }

    /** Set CLI API token (called during async initialization) */
    _setCliApiToken(token: string, source: 'env' | 'file' | 'generated', isNew: boolean): void {
        this.cliApiToken = token
        this.cliApiTokenSource = source
        this.cliApiTokenIsNew = isNew
        ;(this.sources as { cliApiToken: string }).cliApiToken = source
    }
}

// Singleton instance (set by createConfiguration)
let _configuration: Configuration | null = null

/**
 * Create and initialize configuration asynchronously.
 * Must be called once at startup before getConfiguration() can be used.
 */
export async function createConfiguration(): Promise<Configuration> {
    if (_configuration) {
        return _configuration
    }
    _configuration = await Configuration.create()
    return _configuration
}

/**
 * Get the initialized configuration.
 * Throws if createConfiguration() has not been called yet.
 */
export function getConfiguration(): Configuration {
    if (!_configuration) {
        throw new Error('Configuration not initialized. Call createConfiguration() first.')
    }
    return _configuration
}

// For compatibility - throws on access if not configured
export const configuration = new Proxy({} as Configuration, {
    get(_, prop) {
        return getConfiguration()[prop as keyof Configuration]
    }
})
