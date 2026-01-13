/**
 * Review 模块类型定义
 *
 * 这是一个试验性功能，用于多 Session 协作 Review 模式
 */

// Review Session 状态
export type ReviewSessionStatus = 'pending' | 'active' | 'completed' | 'cancelled'

// Review Session 关联记录
export type StoredReviewSession = {
    id: string
    namespace: string

    // 主 Session（被 review 的）
    mainSessionId: string

    // Review Session（执行 review 的）
    reviewSessionId: string

    // Review 使用的模型
    reviewModel: string           // claude, codex, gemini 等
    reviewModelVariant?: string   // opus, sonnet 等

    // 状态
    status: ReviewSessionStatus

    // 传递给 reviewer 的上下文摘要
    contextSummary: string

    // Review 结果（reviewer 的输出）
    reviewResult?: string

    createdAt: number
    updatedAt: number
    completedAt?: number
}

// 创建 Review Session 的请求参数
export type CreateReviewSessionParams = {
    mainSessionId: string
    reviewModel: string
    reviewModelVariant?: string
}

// Review Session Store 接口
export interface IReviewStore {
    // 初始化表结构
    initSchema(): Promise<void>

    // 创建 Review Session 记录
    createReviewSession(data: {
        namespace: string
        mainSessionId: string
        reviewSessionId: string
        reviewModel: string
        reviewModelVariant?: string
        contextSummary: string
    }): Promise<StoredReviewSession>

    // 获取 Review Session
    getReviewSession(id: string): Promise<StoredReviewSession | null>

    // 获取主 Session 的所有 Review Sessions
    getReviewSessionsByMainSession(mainSessionId: string): Promise<StoredReviewSession[]>

    // 获取最新的活跃 Review Session
    getActiveReviewSession(mainSessionId: string): Promise<StoredReviewSession | null>

    // 更新 Review Session 状态
    updateReviewSessionStatus(id: string, status: ReviewSessionStatus): Promise<boolean>

    // 更新 Review 结果
    updateReviewResult(id: string, result: string): Promise<boolean>

    // 完成 Review Session
    completeReviewSession(id: string, result: string): Promise<boolean>

    // 删除 Review Session
    deleteReviewSession(id: string): Promise<boolean>

    // 删除主 Session 的所有 Review Sessions
    deleteReviewSessionsByMainSession(mainSessionId: string): Promise<number>
}
