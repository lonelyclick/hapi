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
    type AnthropicUsageData,
    type AccountSelectionResult,
    DEFAULT_ACCOUNTS_CONFIG,
} from './types'
import { getClaudeUsage } from '../web/routes/usage'

const ACCOUNTS_CONFIG_FILE = 'claude-accounts.json'
const CLAUDE_ACCOUNTS_BASE_DIR = join(homedir(), '.hapi', 'claude-accounts')

let cachedConfig: ClaudeAccountsConfig | null = null
let dataDir: string = join(homedir(), '.hapi')

/** Per-account usage 缓存 (key: accountId) */
const usageCache = new Map<string, AnthropicUsageData>()
/** 缓存 TTL: 5 分钟 */
const USAGE_CACHE_TTL_MS = 5 * 60_000
/** 5 小时利用率"相近"的阈值: 5% */
const FIVE_HOUR_SIMILARITY_THRESHOLD = 0.05

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

/** 随机延迟 200-800ms，避免短时间内大量请求被风控 */
function randomDelay(): Promise<void> {
    const ms = 200 + Math.random() * 600
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 获取单个账号的 usage 数据（带缓存）
 * 缓存未过期直接返回，否则从 Anthropic API 拉取
 */
export async function getAccountUsageCached(
    accountId: string,
    configDir: string
): Promise<AnthropicUsageData> {
    const cached = usageCache.get(accountId)
    if (cached && (Date.now() - cached.fetchedAt) < USAGE_CACHE_TTL_MS) {
        return cached
    }

    const usage = await getClaudeUsage(configDir)
    const data: AnthropicUsageData = {
        fiveHour: usage.fiveHour,
        sevenDay: usage.sevenDay,
        error: usage.error,
        fetchedAt: Date.now()
    }
    usageCache.set(accountId, data)
    return data
}

/**
 * 串行刷新所有账号的 usage 数据（带随机延迟，避免并发请求触发风控）
 */
export async function refreshAllAccountsUsage(): Promise<Map<string, AnthropicUsageData>> {
    const config = await readAccountsConfig()
    const map = new Map<string, AnthropicUsageData>()

    for (const account of config.accounts) {
        const usage = await getAccountUsageCached(account.id, account.configDir)
        map.set(account.id, usage)
        // 如果是实际发起了 API 请求（非缓存），加延迟
        if (config.accounts.length > 1) {
            await randomDelay()
        }
    }

    return map
}

/**
 * 清除 usage 缓存（单个账号或全部）
 */
export function invalidateUsageCache(accountId?: string): void {
    if (accountId) {
        usageCache.delete(accountId)
    } else {
        usageCache.clear()
    }
}

/**
 * 智能选择最优账号（负载平衡）
 *
 * 排序逻辑：
 * 1. 只从 autoRotate: true 的账号中选择
 * 2. 优先按 fiveHour.utilization 升序
 * 3. 如果两个账号 fiveHour 差值 < 5%，按 sevenDay.utilization 排序
 * 4. 排除已超过阈值的账号（如果所有都超限，选最低的）
 * 5. 无 usage 数据的账号 utilization 视为 0.5
 */
export async function selectBestAccount(): Promise<AccountSelectionResult | null> {
    const config = await readAccountsConfig()

    const candidates = config.accounts.filter(a => a.autoRotate)
    if (candidates.length === 0) {
        const active = config.accounts.find(a => a.id === config.activeAccountId)
        if (active) {
            return { account: active, usage: null, reason: 'fallback_lowest' }
        }
        return null
    }

    if (candidates.length === 1) {
        const usage = await getAccountUsageCached(candidates[0].id, candidates[0].configDir)
        return { account: candidates[0], usage, reason: 'only_candidate' }
    }

    // 串行获取所有候选账号的 usage（带随机延迟，避免并发请求触发风控）
    const usageEntries: { account: ClaudeAccount; usage: AnthropicUsageData }[] = []
    for (const account of candidates) {
        const usage = await getAccountUsageCached(account.id, account.configDir)
        usageEntries.push({ account, usage })
    }

    const getFiveHour = (u: AnthropicUsageData | null): number =>
        u?.fiveHour?.utilization ?? 0.5

    const getSevenDay = (u: AnthropicUsageData | null): number =>
        u?.sevenDay?.utilization ?? 0.5

    // 先尝试排除超过阈值的账号
    const thresholdFiltered = usageEntries.filter(e => {
        const fiveHourUtil = getFiveHour(e.usage)
        return fiveHourUtil < (e.account.usageThreshold / 100)
    })

    // 如果所有账号都超限，使用全部候选
    const pool = thresholdFiltered.length > 0 ? thresholdFiltered : usageEntries

    // 综合排序：fiveHour 优先，相近时看 sevenDay
    pool.sort((a, b) => {
        const aFive = getFiveHour(a.usage)
        const bFive = getFiveHour(b.usage)
        const fiveDiff = Math.abs(aFive - bFive)

        if (fiveDiff < FIVE_HOUR_SIMILARITY_THRESHOLD) {
            return getSevenDay(a.usage) - getSevenDay(b.usage)
        }
        return aFive - bFive
    })

    const best = pool[0]
    const bestFive = getFiveHour(best.usage)
    const secondFive = pool.length > 1 ? getFiveHour(pool[1].usage) : -1
    const reason = (Math.abs(bestFive - secondFive) < FIVE_HOUR_SIMILARITY_THRESHOLD)
        ? 'lowest_seven_day_tiebreak'
        : 'lowest_five_hour'

    console.log(
        `[ClaudeAccounts] Selected account: ${best.account.name} (5h: ${(bestFive * 100).toFixed(1)}%, 7d: ${(getSevenDay(best.usage) * 100).toFixed(1)}%), reason: ${reason}`
    )

    return { account: best.account, usage: best.usage, reason }
}

/**
 * 检查是否需要自动轮换（使用 Anthropic API 实时 usage 数据）
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

    // 获取当前活跃账号的实时 usage
    const activeUsage = await getAccountUsageCached(activeAccount.id, activeAccount.configDir)
    const fiveHourUtil = activeUsage.fiveHour?.utilization ?? 0
    const threshold = activeAccount.usageThreshold / 100

    if (fiveHourUtil < threshold) {
        return null
    }

    // 需要轮换，选择最优账号
    const selection = await selectBestAccount()
    if (!selection || selection.account.id === activeAccount.id) {
        console.warn('[ClaudeAccounts] Current account over threshold but no better alternative found')
        return null
    }

    console.log(
        `[ClaudeAccounts] Auto-rotating from ${activeAccount.name} (5h: ${(fiveHourUtil * 100).toFixed(1)}%) ` +
        `to ${selection.account.name} (reason: ${selection.reason})`
    )

    return setActiveAccount(selection.account.id, 'auto_rotate')
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
