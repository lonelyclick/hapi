import type { ModelMode } from '@/types/api'

/**
 * Context windows vary by model/provider and may change over time.
 *
 * The UI displays context usage percentage that should align with backend autoCompact behavior.
 *
 * Backend autoCompact threshold calculation (from cli/src/services/compact/autoCompact.ts):
 * - effectiveContextWindow = contextWindow - MAX_OUTPUT_TOKENS_FOR_SUMMARY (20,000)
 * - autoCompactThreshold = effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS (13,000)
 * - Total reserved: 20,000 + 13,000 = 33,000 tokens
 *
 * Frontend should use the same threshold so percentage display matches actual compact timing.
 */
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000
const AUTOCOMPACT_BUFFER_TOKENS = 13_000
const TOTAL_RESERVED_TOKENS = MAX_OUTPUT_TOKENS_FOR_SUMMARY + AUTOCOMPACT_BUFFER_TOKENS

const MODEL_CONTEXT_WINDOWS: Partial<Record<ModelMode, number>> = {
    // Claude Code 1M context window (Opus 4.6 / Sonnet 4.5+)
    default: 1_000_000,
    sonnet: 1_000_000,
    opus: 1_000_000
}

export function getContextBudgetTokens(modelMode: ModelMode | undefined): number | null {
    const mode: ModelMode = modelMode ?? 'default'
    const windowTokens = MODEL_CONTEXT_WINDOWS[mode]
    if (!windowTokens) return null
    // Use same threshold as backend autoCompact for accurate percentage display
    return Math.max(1, windowTokens - TOTAL_RESERVED_TOKENS)
}
