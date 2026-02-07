/**
 * Brain 模块入口
 *
 * 这是一个试验性功能，用于多 Session 协作 Brain 模式
 */

export { BrainStore } from './store'
export { createBrainRoutes } from './routes'
export { AutoBrainService } from './autoBrain'
export { buildBrainSystemPrompt, buildReviewPrompt, buildRefineSystemPrompt } from './brainSdkService'
export type {
    StoredBrainSession,
    BrainSessionStatus,
    CreateBrainSessionParams,
    IBrainStore
} from './types'
