/**
 * Brain 决策状态机
 *
 * 使用 XState v5 定义 Brain 的工作流程：
 * idle → developing → reviewing → linting → testing → committing → deploying → done
 *
 * 每个状态内部由 LLM 判断并返回信号（signal），状态机根据信号驱动转换。
 * 状态机定义是全局通用的，每个 brain session 只持久化 currentState + stateContext。
 */

import { setup, createActor, type Snapshot } from 'xstate'
import type { BrainMachineState, BrainStateContext, BrainSignal } from './types'
import { DEFAULT_STATE_CONTEXT } from './types'

/** 各状态回退到 developing 的最大重试次数 */
const MAX_RETRIES = {
    reviewing: 5,
    linting: 3,
    testing: 3,
    committing: 2,
    deploying: 2,
} as const

/** XState 状态机定义 */
export const brainMachine = setup({
    types: {
        context: {} as BrainStateContext,
        events: {} as { type: BrainSignal; detail?: string },
    },
    guards: {
        canRetryReviewing: ({ context }) => context.retries.reviewing < MAX_RETRIES.reviewing,
        canRetryLinting: ({ context }) => context.retries.linting < MAX_RETRIES.linting,
        canRetryTesting: ({ context }) => context.retries.testing < MAX_RETRIES.testing,
        canRetryCommitting: ({ context }) => context.retries.committing < MAX_RETRIES.committing,
        canRetryDeploying: ({ context }) => context.retries.deploying < MAX_RETRIES.deploying,
    },
    actions: {
        incrementReviewRetry: ({ context }) => { context.retries.reviewing++ },
        incrementLintRetry: ({ context }) => { context.retries.linting++ },
        incrementTestRetry: ({ context }) => { context.retries.testing++ },
        incrementCommitRetry: ({ context }) => { context.retries.committing++ },
        incrementDeployRetry: ({ context }) => { context.retries.deploying++ },
        recordSignal: ({ context, event }) => {
            context.lastSignal = event.type
            context.lastSignalDetail = event.detail
        },
    },
}).createMachine({
    id: 'brain',
    initial: 'idle',
    context: { ...DEFAULT_STATE_CONTEXT },
    states: {
        idle: {
            on: {
                ai_reply_done: {
                    target: 'reviewing',
                    actions: 'recordSignal',
                },
            },
        },
        developing: {
            on: {
                ai_reply_done: {
                    target: 'reviewing',
                    actions: 'recordSignal',
                },
            },
        },
        reviewing: {
            on: {
                has_issue: [
                    {
                        guard: 'canRetryReviewing',
                        target: 'developing',
                        actions: ['incrementReviewRetry', 'recordSignal'],
                    },
                    {
                        // 超过重试上限，强制进入 linting
                        target: 'linting',
                        actions: 'recordSignal',
                    },
                ],
                no_issue: {
                    target: 'linting',
                    actions: 'recordSignal',
                },
                ai_question: {
                    target: 'developing',
                    actions: ['incrementReviewRetry', 'recordSignal'],
                },
                skip: {
                    target: 'linting',
                    actions: 'recordSignal',
                },
            },
        },
        linting: {
            on: {
                lint_pass: {
                    target: 'testing',
                    actions: 'recordSignal',
                },
                lint_fail: [
                    {
                        guard: 'canRetryLinting',
                        target: 'developing',
                        actions: ['incrementLintRetry', 'recordSignal'],
                    },
                    {
                        // 超过重试上限，跳过 lint 进入 testing
                        target: 'testing',
                        actions: 'recordSignal',
                    },
                ],
                // waiting: 已发 lint 指令，等主 session 跑完
                waiting: {
                    target: 'linting',
                    actions: 'recordSignal',
                },
                skip: {
                    target: 'testing',
                    actions: 'recordSignal',
                },
            },
        },
        testing: {
            on: {
                test_pass: {
                    target: 'committing',
                    actions: 'recordSignal',
                },
                test_fail: [
                    {
                        guard: 'canRetryTesting',
                        target: 'developing',
                        actions: ['incrementTestRetry', 'recordSignal'],
                    },
                    {
                        // 超过重试上限，标记 done（附带测试失败警告）
                        target: 'done',
                        actions: 'recordSignal',
                    },
                ],
                waiting: {
                    target: 'testing',
                    actions: 'recordSignal',
                },
                skip: {
                    target: 'committing',
                    actions: 'recordSignal',
                },
            },
        },
        committing: {
            on: {
                commit_ok: {
                    target: 'done',
                    actions: 'recordSignal',
                },
                commit_fail: [
                    {
                        guard: 'canRetryCommitting',
                        target: 'developing',
                        actions: ['incrementCommitRetry', 'recordSignal'],
                    },
                    {
                        target: 'done',
                        actions: 'recordSignal',
                    },
                ],
                // 需要部署时可跳到 deploying
                deploy_ok: {
                    target: 'deploying',
                    actions: 'recordSignal',
                },
                waiting: {
                    target: 'committing',
                    actions: 'recordSignal',
                },
                skip: {
                    target: 'done',
                    actions: 'recordSignal',
                },
            },
        },
        deploying: {
            on: {
                deploy_ok: {
                    target: 'done',
                    actions: 'recordSignal',
                },
                deploy_fail: [
                    {
                        guard: 'canRetryDeploying',
                        target: 'developing',
                        actions: ['incrementDeployRetry', 'recordSignal'],
                    },
                    {
                        target: 'done',
                        actions: 'recordSignal',
                    },
                ],
                waiting: {
                    target: 'deploying',
                    actions: 'recordSignal',
                },
                skip: {
                    target: 'done',
                    actions: 'recordSignal',
                },
            },
        },
        done: {
            type: 'final',
        },
    },
})

// ============ 对外接口：按需重建 + 转换 + 序列化 ============

export interface TransitionResult {
    /** 转换后的新状态 */
    newState: BrainMachineState
    /** 更新后的上下文 */
    newContext: BrainStateContext
    /** 是否发生了实际转换（状态有变化） */
    changed: boolean
}

/**
 * 核心方法：发送信号，驱动状态转换
 *
 * 从 DB 读取 currentState + stateContext → 重建 actor → 发送 signal → 返回新状态
 * 不常驻内存，用完即销毁
 */
export function sendSignal(
    currentState: BrainMachineState,
    stateContext: BrainStateContext,
    signal: BrainSignal,
    detail?: string
): TransitionResult {
    // 从持久化数据重建 actor
    const actor = createActor(brainMachine, {
        snapshot: {
            value: currentState,
            context: { ...stateContext },
            status: currentState === 'done' ? 'done' : 'active',
            output: undefined,
            error: undefined,
        } as unknown as Snapshot<unknown>,
    })

    actor.start()

    const stateBefore = actor.getSnapshot().value as BrainMachineState

    // 发送信号
    actor.send({ type: signal, detail })

    const snapshot = actor.getSnapshot()
    const newState = snapshot.value as BrainMachineState
    const newContext = snapshot.context as BrainStateContext

    actor.stop()

    return {
        newState,
        newContext,
        changed: newState !== stateBefore,
    }
}

/**
 * 获取当前状态允许的信号列表
 * 用于在 prompt 中告诉 LLM "你只能返回这些信号"
 */
export function getAllowedSignals(state: BrainMachineState): BrainSignal[] {
    const signalMap: Record<BrainMachineState, BrainSignal[]> = {
        idle: ['ai_reply_done'],
        developing: ['ai_reply_done'],
        reviewing: ['has_issue', 'no_issue', 'ai_question', 'skip'],
        linting: ['lint_pass', 'lint_fail', 'waiting', 'skip'],
        testing: ['test_pass', 'test_fail', 'waiting', 'skip'],
        committing: ['commit_ok', 'commit_fail', 'waiting', 'skip'],
        deploying: ['deploy_ok', 'deploy_fail', 'waiting', 'skip'],
        done: [],
    }
    return signalMap[state] ?? []
}

/**
 * 判断某个状态是否需要 Brain 立即采取行动（发 prompt 给主 session）
 * 而不是等下一次主 session 回复
 */
export function needsImmediateAction(state: BrainMachineState): boolean {
    // linting/testing/committing/deploying 需要 Brain 主动 push 指令
    return ['linting', 'testing', 'committing', 'deploying'].includes(state)
}
