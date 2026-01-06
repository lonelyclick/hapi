/**
 * Claude Code 多账号管理服务
 *
 * 功能:
 * - 账号 CRUD 操作
 * - 活跃账号切换
 * - 使用量跟踪
 * - 自动轮换
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import {
    type ClaudeAccount,
    type ClaudeAccountsConfig,
    type ClaudeAccountUsage,
    type AddAccountInput,
    type UpdateAccountInput,
    type AccountSwitchEvent,
    DEFAULT_ACCOUNTS_CONFIG,
} from './types'

const ACCOUNTS_CONFIG_FILE = 'claude-accounts.json'
const CLAUDE_ACCOUNTS_BASE_DIR = join(homedir(), '.hapi', 'claude-accounts')

let cachedConfig: ClaudeAccountsConfig | null = null
let dataDir: string = join(homedir(), '.hapi')

/**
 * 初始化账号服务
 */
export function initAccountsService(dir: string): void {
    dataDir = dir
}

/**
 * 获取配置文件路径
 */
function getConfigFilePath(): string {
    return join(dataDir, ACCOUNTS_CONFIG_FILE)
}

/**
 * 读取账号配置
 */
export async function readAccountsConfig(): Promise<ClaudeAccountsConfig> {
    if (cachedConfig) {
        return cachedConfig
    }

    const configFile = getConfigFilePath()
    if (!existsSync(configFile)) {
        cachedConfig = { ...DEFAULT_ACCOUNTS_CONFIG }
        return cachedConfig
    }

    try {
        const content = await readFile(configFile, 'utf8')
        cachedConfig = JSON.parse(content)
        return cachedConfig!
    } catch (error) {
        console.error(`[ClaudeAccounts] Failed to parse ${configFile}:`, error)
        cachedConfig = { ...DEFAULT_ACCOUNTS_CONFIG }
        return cachedConfig
    }
}

/**
 * 写入账号配置
 */
async function writeAccountsConfig(config: ClaudeAccountsConfig): Promise<void> {
    const configFile = getConfigFilePath()
    const dir = dirname(configFile)

    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true, mode: 0o700 })
    }

    const tmpFile = configFile + '.tmp'
    await writeFile(tmpFile, JSON.stringify(config, null, 2))
    await rename(tmpFile, configFile)
    cachedConfig = config
}

/**
 * 获取所有账号
 */
export async function getAccounts(): Promise<ClaudeAccount[]> {
    const config = await readAccountsConfig()
    return config.accounts
}

/**
 * 获取当前活跃账号
 */
export async function getActiveAccount(): Promise<ClaudeAccount | null> {
    const config = await readAccountsConfig()
    if (!config.activeAccountId) {
        return config.accounts[0] || null
    }
    return config.accounts.find(a => a.id === config.activeAccountId) || null
}

/**
 * 获取账号的配置目录
 */
export function getAccountConfigDir(accountId: string): string {
    return join(CLAUDE_ACCOUNTS_BASE_DIR, accountId)
}

/**
 * 检查账号凭证是否有效
 */
export async function validateAccountCredentials(configDir: string): Promise<boolean> {
    const credentialsFile = join(configDir, '.credentials.json')
    if (!existsSync(credentialsFile)) {
        return false
    }

    try {
        const content = await readFile(credentialsFile, 'utf8')
        const credentials = JSON.parse(content)
        // 检查必要的字段
        return !!(credentials.claudeAiOauth?.accessToken)
    } catch {
        return false
    }
}

/**
 * 添加新账号
 */
export async function addAccount(input: AddAccountInput): Promise<ClaudeAccount> {
    const config = await readAccountsConfig()

    // 生成唯一 ID
    const id = input.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36)

    // 确定配置目录
    const configDir = input.configDir || getAccountConfigDir(id)

    // 验证凭证
    const isValid = await validateAccountCredentials(configDir)
    if (!isValid) {
        throw new Error(`Invalid credentials in ${configDir}. Please login first using: CLAUDE_CONFIG_DIR=${configDir} claude login`)
    }

    const account: ClaudeAccount = {
        id,
        name: input.name,
        configDir,
        isActive: config.accounts.length === 0, // 第一个账号默认活跃
        autoRotate: input.autoRotate ?? true,
        usageThreshold: input.usageThreshold ?? config.defaultThreshold,
        createdAt: Date.now(),
    }

    config.accounts.push(account)
    if (account.isActive) {
        config.activeAccountId = account.id
    }

    await writeAccountsConfig(config)
    console.log(`[ClaudeAccounts] Added account: ${account.name} (${account.id})`)

    return account
}

/**
 * 更新账号配置
 */
export async function updateAccount(id: string, input: UpdateAccountInput): Promise<ClaudeAccount> {
    const config = await readAccountsConfig()
    const account = config.accounts.find(a => a.id === id)

    if (!account) {
        throw new Error(`Account not found: ${id}`)
    }

    if (input.name !== undefined) {
        account.name = input.name
    }
    if (input.autoRotate !== undefined) {
        account.autoRotate = input.autoRotate
    }
    if (input.usageThreshold !== undefined) {
        account.usageThreshold = input.usageThreshold
    }

    await writeAccountsConfig(config)
    return account
}

/**
 * 删除账号
 */
export async function removeAccount(id: string): Promise<void> {
    const config = await readAccountsConfig()
    const index = config.accounts.findIndex(a => a.id === id)

    if (index === -1) {
        throw new Error(`Account not found: ${id}`)
    }

    const account = config.accounts[index]
    config.accounts.splice(index, 1)

    // 如果删除的是活跃账号，切换到第一个可用账号
    if (config.activeAccountId === id) {
        config.activeAccountId = config.accounts[0]?.id || ''
        if (config.accounts[0]) {
            config.accounts[0].isActive = true
        }
    }

    await writeAccountsConfig(config)
    console.log(`[ClaudeAccounts] Removed account: ${account.name} (${id})`)
}

/**
 * 切换活跃账号
 */
export async function setActiveAccount(
    id: string,
    reason: AccountSwitchEvent['reason'] = 'manual'
): Promise<AccountSwitchEvent> {
    const config = await readAccountsConfig()
    const account = config.accounts.find(a => a.id === id)

    if (!account) {
        throw new Error(`Account not found: ${id}`)
    }

    const previousAccountId = config.activeAccountId

    // 更新活跃状态
    for (const acc of config.accounts) {
        acc.isActive = acc.id === id
    }
    config.activeAccountId = id
    account.lastActiveAt = Date.now()

    await writeAccountsConfig(config)

    const event: AccountSwitchEvent = {
        previousAccountId,
        newAccountId: id,
        reason,
        timestamp: Date.now(),
    }

    console.log(`[ClaudeAccounts] Switched to account: ${account.name} (${id}), reason: ${reason}`)
    return event
}

/**
 * 更新账号使用量
 */
export async function updateAccountUsage(id: string, usage: ClaudeAccountUsage): Promise<void> {
    const config = await readAccountsConfig()
    const account = config.accounts.find(a => a.id === id)

    if (!account) {
        throw new Error(`Account not found: ${id}`)
    }

    account.lastUsage = usage
    await writeAccountsConfig(config)
}

/**
 * 检查是否需要自动轮换
 */
export async function checkAndRotate(): Promise<AccountSwitchEvent | null> {
    const config = await readAccountsConfig()

    if (!config.autoRotateEnabled) {
        return null
    }

    const activeAccount = config.accounts.find(a => a.isActive)
    if (!activeAccount || !activeAccount.autoRotate) {
        return null
    }

    // 检查使用量
    if (!activeAccount.lastUsage) {
        return null
    }

    const { percentage } = activeAccount.lastUsage
    if (percentage < activeAccount.usageThreshold) {
        return null
    }

    // 找到使用量最低的可轮换账号
    const candidates = config.accounts
        .filter(a => a.autoRotate && !a.isActive)
        .sort((a, b) => (a.lastUsage?.percentage || 0) - (b.lastUsage?.percentage || 0))

    if (candidates.length === 0) {
        console.warn('[ClaudeAccounts] No available accounts for rotation')
        return null
    }

    const nextAccount = candidates[0]
    console.log(
        `[ClaudeAccounts] Auto-rotating from ${activeAccount.name} (${percentage}%) to ${nextAccount.name} (${nextAccount.lastUsage?.percentage || 0}%)`
    )

    return setActiveAccount(nextAccount.id, 'auto_rotate')
}

/**
 * 设置自动轮换开关
 */
export async function setAutoRotateEnabled(enabled: boolean): Promise<void> {
    const config = await readAccountsConfig()
    config.autoRotateEnabled = enabled
    await writeAccountsConfig(config)
}

/**
 * 设置默认阈值
 */
export async function setDefaultThreshold(threshold: number): Promise<void> {
    if (threshold < 0 || threshold > 100) {
        throw new Error('Threshold must be between 0 and 100')
    }
    const config = await readAccountsConfig()
    config.defaultThreshold = threshold
    await writeAccountsConfig(config)
}

/**
 * 获取完整配置
 */
export async function getAccountsConfig(): Promise<ClaudeAccountsConfig> {
    return readAccountsConfig()
}

/**
 * 迁移现有的 Claude 配置到账号系统
 * 如果没有任何账号，将默认的 ~/.claude 配置迁移为 primary 账号
 */
export async function migrateDefaultAccount(): Promise<ClaudeAccount | null> {
    const config = await readAccountsConfig()

    // 如果已有账号，不需要迁移
    if (config.accounts.length > 0) {
        return null
    }

    const defaultClaudeDir = join(homedir(), '.claude')
    const isValid = await validateAccountCredentials(defaultClaudeDir)

    if (!isValid) {
        return null
    }

    // 创建 primary 账号，使用默认的 ~/.claude 目录
    const account: ClaudeAccount = {
        id: 'primary',
        name: '主账号',
        configDir: defaultClaudeDir,
        isActive: true,
        autoRotate: true,
        usageThreshold: config.defaultThreshold,
        createdAt: Date.now(),
    }

    config.accounts.push(account)
    config.activeAccountId = account.id

    await writeAccountsConfig(config)
    console.log('[ClaudeAccounts] Migrated default Claude config to primary account')

    return account
}
