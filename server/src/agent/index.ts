/**
 * Advisor Agent 模块导出
 */

export { AdvisorScheduler, type AdvisorSchedulerConfig } from './advisorScheduler'
export { AdvisorService, type AdvisorServiceConfig, type AdvisorTelegramNotifier } from './advisorService'
export { SuggestionEvaluator } from './suggestionEvaluator'
export { buildAdvisorInitPrompt, type AdvisorContext } from './advisorPrompt'
export { AdvisorTelegramNotifierImpl, createAdvisorTelegramNotifier } from './advisorTelegram'
export { AutoIterationService } from './autoIteration'
export { MemoryExtractor, createMemoryExtractor, extractMemoriesFromSession, type ExtractedMemory, type MemoryExtractorConfig } from './memoryExtractor'
export {
    MemoryInjector,
    createMemoryInjector,
    getMemoryPromptFragment,
    getMemoriesForInjection,
    formatMemoriesForPrompt,
    type MemoryInjectorConfig,
    type InjectedMemory,
    type MemoryInjectionResult
} from './memoryInjector'
export {
    CollaborationTaskManager,
    type CollaborationTask,
    type CollaborationTaskType,
    type CollaborationTaskStatus,
    type CollaborationMessage,
    type TaskParticipant,
    type ParticipantRole,
    type Subtask,
    type SubtaskStatus
} from './collaborationTask'
export {
    CollaborationProtocol,
    PairProgrammingProtocol,
    CodeReviewProtocol,
    KnowledgeSharingProtocol,
    ProtocolManager,
    createProtocol,
    type CollaborationProtocolType,
    type ProtocolPhase,
    type ProtocolConfig,
    type ProtocolContext,
    type ProtocolMessage
} from './collaborationProtocol'
export * from './types'
