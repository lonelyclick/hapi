/**
 * Claude Code 多账号管理类型定义
 */

export interface ClaudeAccountUsage {
  usedTokens: number;
  totalTokens: number;
  percentage: number;
  updatedAt: number;
}

export interface ClaudeAccount {
  /** 唯一标识 (如 'primary', 'secondary') */
  id: string;
  /** 显示名称 */
  name: string;
  /** 配置目录路径 (存储 .credentials.json) */
  configDir: string;
  /** 是否为当前活跃账号 */
  isActive: boolean;
  /** 是否参与自动轮换 */
  autoRotate: boolean;
  /** 使用量阈值 (0-100)，超过此值触发轮换 */
  usageThreshold: number;
  /** 最近的使用量信息 */
  lastUsage?: ClaudeAccountUsage;
  /** 创建时间 */
  createdAt: number;
  /** 最后活跃时间 */
  lastActiveAt?: number;
}

export interface ClaudeAccountsConfig {
  /** 账号列表 */
  accounts: ClaudeAccount[];
  /** 当前活跃账号 ID */
  activeAccountId: string;
  /** 是否启用自动轮换 */
  autoRotateEnabled: boolean;
  /** 默认使用量阈值 */
  defaultThreshold: number;
}

export interface AddAccountInput {
  name: string;
  configDir: string;
  autoRotate?: boolean;
  usageThreshold?: number;
}

export interface UpdateAccountInput {
  name?: string;
  autoRotate?: boolean;
  usageThreshold?: number;
}

/** 账号切换事件 */
export interface AccountSwitchEvent {
  previousAccountId: string;
  newAccountId: string;
  reason: 'manual' | 'auto_rotate' | 'usage_limit' | 'load_balance';
  timestamp: number;
}

/** 默认配置 */
export const DEFAULT_ACCOUNTS_CONFIG: ClaudeAccountsConfig = {
  accounts: [],
  activeAccountId: '',
  autoRotateEnabled: true,
  defaultThreshold: 80,
};

/** 账号配置目录基础路径 */
export const CLAUDE_ACCOUNTS_BASE_DIR = '~/.hapi/claude-accounts';

/** Anthropic API 返回的实时 usage 数据（缓存在内存中） */
export interface AnthropicUsageData {
  fiveHour: { utilization: number; resetsAt: string } | null;
  sevenDay: { utilization: number; resetsAt: string } | null;
  error?: string;
  /** 缓存时间戳 */
  fetchedAt: number;
}

/** selectBestAccount 的返回结果 */
export interface AccountSelectionResult {
  account: ClaudeAccount;
  usage: AnthropicUsageData | null;
  reason: 'lowest_five_hour' | 'lowest_seven_day_tiebreak' | 'fallback_lowest' | 'only_candidate';
}
