/**
 * Brain 模块类型定义
 *
 * 这是一个试验性功能，用于多 Session 协作 Brain 模式
 */

// Brain Session 状态
export type BrainSessionStatus = 'pending' | 'active' | 'completed' | 'cancelled'

// Brain Session 关联记录
export type StoredBrainSession = {
    id: string
    namespace: string

    // 主 Session（被 brain 的）
    mainSessionId: string

    // Brain Session（执行 brain 的）
    brainSessionId: string

    // Brain 使用的模型
    brainModel: string           // claude, codex, gemini 等
    brainModelVariant?: string   // opus, sonnet 等

    // 状态
    status: BrainSessionStatus

    // 传递给 brain 的上下文摘要
    contextSummary: string

    // Brain 结果（brain 的输出）
    brainResult?: string

    // 状态机
    currentState: BrainMachineState
    stateContext: BrainStateContext

    createdAt: number
    updatedAt: number
    completedAt?: number
}

// 创建 Brain Session 的请求参数
export type CreateBrainSessionParams = {
    mainSessionId: string
    brainModel: string
    brainModelVariant?: string
}

// ============ 状态机相关类型 ============

/** Brain 状态机 - 状态定义 */
export type BrainMachineState =
    | 'idle'
    | 'developing'
    | 'reviewing'
    | 'linting'
    | 'testing'
    | 'committing'
    | 'deploying'
    | 'done'

/** Brain 状态机 - 信号（LLM 返回的判断结果） */
export type BrainSignal =
    | 'ai_reply_done'
    | 'has_issue'
    | 'no_issue'
    | 'ai_question'
    | 'lint_pass'
    | 'lint_fail'
    | 'test_pass'
    | 'test_fail'
    | 'commit_ok'
    | 'commit_fail'
    | 'deploy_ok'
    | 'dev_complete'
    | 'deploy_fail'
    | 'waiting'
    | 'user_message'

/** 状态机上下文（持久化到 DB） */
export type BrainStateContext = {
    retries: {
        developing: number
        reviewing: number
        linting: number
        testing: number
        committing: number
        deploying: number
    }
    lastSignal?: BrainSignal
    lastSignalDetail?: string
}

/** 默认状态上下文 */
export const DEFAULT_STATE_CONTEXT: BrainStateContext = {
    retries: {
        developing: 0,
        reviewing: 0,
        linting: 0,
        testing: 0,
        committing: 0,
        deploying: 0,
    }
}

// Brain Session Store 接口
export interface IBrainStore {
    // 初始化表结构
    initSchema(): Promise<void>

    // 创建 Brain Session 记录
    createBrainSession(data: {
        namespace: string
        mainSessionId: string
        brainSessionId: string
        brainModel: string
        brainModelVariant?: string
        contextSummary: string
    }): Promise<StoredBrainSession>

    // 获取 Brain Session
    getBrainSession(id: string): Promise<StoredBrainSession | null>

    // 获取主 Session 的所有 Brain Sessions
    getBrainSessionsByMainSession(mainSessionId: string): Promise<StoredBrainSession[]>

    // 获取最新的活跃 Brain Session
    getActiveBrainSession(mainSessionId: string): Promise<StoredBrainSession | null>

    // 更新 Brain Session 状态
    updateBrainSessionStatus(id: string, status: BrainSessionStatus): Promise<boolean>

    // 更新 Brain 结果
    updateBrainResult(id: string, result: string): Promise<boolean>

    // 完成 Brain Session
    completeBrainSession(id: string, result: string): Promise<boolean>

    // 删除 Brain Session
    deleteBrainSession(id: string): Promise<boolean>

    // 删除主 Session 的所有 Brain Sessions
    deleteBrainSessionsByMainSession(mainSessionId: string): Promise<number>
}
