/**
 * Brain 模块 PostgreSQL Store 实现
 *
 * 这是一个试验性功能，独立于主 Store
 */

import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import type { IBrainStore, StoredBrainSession, BrainSessionStatus } from './types'

export class BrainStore implements IBrainStore {
    private pool: Pool

    constructor(pool: Pool) {
        this.pool = pool
    }

    async initSchema(): Promise<void> {
        await this.pool.query(`
            -- Brain Sessions 表 (试验性功能)
            CREATE TABLE IF NOT EXISTS brain_sessions (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                main_session_id TEXT NOT NULL,
                review_session_id TEXT NOT NULL,
                review_model TEXT NOT NULL,
                review_model_variant TEXT,
                status TEXT DEFAULT 'pending',
                context_summary TEXT NOT NULL,
                review_result TEXT,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                completed_at BIGINT
            );
            CREATE INDEX IF NOT EXISTS idx_brain_sessions_main ON brain_sessions(main_session_id);
            CREATE INDEX IF NOT EXISTS idx_brain_sessions_review ON brain_sessions(review_session_id);
            CREATE INDEX IF NOT EXISTS idx_brain_sessions_namespace ON brain_sessions(namespace);
            CREATE INDEX IF NOT EXISTS idx_brain_sessions_status ON brain_sessions(status);

            -- Brain Rounds 表 - 存储每轮对话的汇总
            CREATE TABLE IF NOT EXISTS brain_rounds (
                id TEXT PRIMARY KEY,
                review_session_id TEXT NOT NULL REFERENCES brain_sessions(id) ON DELETE CASCADE,
                round_number INTEGER NOT NULL,
                user_input TEXT NOT NULL,
                ai_summary TEXT NOT NULL,
                original_message_ids TEXT[],
                started_at BIGINT,
                ended_at BIGINT,
                created_at BIGINT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_brain_rounds_session ON brain_rounds(review_session_id);

            -- Brain Executions 表 - 存储每次执行 brain 的记录
            CREATE TABLE IF NOT EXISTS brain_executions (
                id TEXT PRIMARY KEY,
                review_session_id TEXT NOT NULL REFERENCES brain_sessions(id) ON DELETE CASCADE,
                rounds_reviewed INTEGER NOT NULL,
                reviewed_round_numbers INTEGER[],
                time_range_start BIGINT NOT NULL,
                time_range_end BIGINT NOT NULL,
                prompt TEXT NOT NULL,
                result TEXT,
                status TEXT DEFAULT 'pending',
                created_at BIGINT NOT NULL,
                completed_at BIGINT
            );
            CREATE INDEX IF NOT EXISTS idx_brain_executions_session ON brain_executions(review_session_id);
        `)

        // 添加新字段（如果表已存在）
        await this.pool.query(`
            DO $$
            BEGIN
                -- 添加 started_at 字段
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'brain_rounds' AND column_name = 'started_at') THEN
                    ALTER TABLE brain_rounds ADD COLUMN started_at BIGINT;
                END IF;
                -- 添加 ended_at 字段
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'brain_rounds' AND column_name = 'ended_at') THEN
                    ALTER TABLE brain_rounds ADD COLUMN ended_at BIGINT;
                END IF;
                -- 添加 reviewed_round_numbers 字段到 brain_executions
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'brain_executions' AND column_name = 'reviewed_round_numbers') THEN
                    ALTER TABLE brain_executions ADD COLUMN reviewed_round_numbers INTEGER[];
                END IF;
                -- 添加 applied_suggestion_ids 字段到 brain_sessions（存储已发送的建议 ID）
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'brain_sessions' AND column_name = 'applied_suggestion_ids') THEN
                    ALTER TABLE brain_sessions ADD COLUMN applied_suggestion_ids TEXT[] DEFAULT '{}';
                END IF;
                -- 添加 progress_log 字段到 brain_executions（存储进度日志）
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'brain_executions' AND column_name = 'progress_log') THEN
                    ALTER TABLE brain_executions ADD COLUMN progress_log JSONB DEFAULT '[]';
                END IF;
            END $$;
        `)

        // 启动时清理：将因 server 重启而中断的 running execution 标记为 failed
        const cleaned = await this.pool.query(
            `UPDATE brain_executions SET status = 'failed', result = 'Interrupted by server restart', completed_at = $1 WHERE status = 'running'`,
            [Date.now()]
        )
        if ((cleaned.rowCount ?? 0) > 0) {
            console.log(`[BrainStore] Cleaned ${cleaned.rowCount} interrupted executions from previous run`)
        }
    }

    async createBrainSession(data: {
        namespace: string
        mainSessionId: string
        brainSessionId: string
        brainModel: string
        brainModelVariant?: string
        contextSummary: string
    }): Promise<StoredBrainSession> {
        const id = randomUUID()
        const now = Date.now()

        await this.pool.query(
            `INSERT INTO brain_sessions
             (id, namespace, main_session_id, review_session_id, review_model, review_model_variant, status, context_summary, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $8)`,
            [id, data.namespace, data.mainSessionId, data.brainSessionId, data.brainModel, data.brainModelVariant ?? null, data.contextSummary, now]
        )

        return {
            id,
            namespace: data.namespace,
            mainSessionId: data.mainSessionId,
            brainSessionId: data.brainSessionId,
            brainModel: data.brainModel,
            brainModelVariant: data.brainModelVariant,
            status: 'pending',
            contextSummary: data.contextSummary,
            createdAt: now,
            updatedAt: now
        }
    }

    async getBrainSession(id: string): Promise<StoredBrainSession | null> {
        const result = await this.pool.query(
            `SELECT * FROM brain_sessions WHERE id = $1`,
            [id]
        )

        if (result.rows.length === 0) {
            return null
        }

        return this.rowToBrainSession(result.rows[0])
    }

    async getBrainSessionsByMainSession(mainSessionId: string): Promise<StoredBrainSession[]> {
        const result = await this.pool.query(
            `SELECT * FROM brain_sessions WHERE main_session_id = $1 ORDER BY created_at DESC`,
            [mainSessionId]
        )

        return result.rows.map(row => this.rowToBrainSession(row))
    }

    async getActiveBrainSession(mainSessionId: string): Promise<StoredBrainSession | null> {
        const result = await this.pool.query(
            `SELECT * FROM brain_sessions
             WHERE main_session_id = $1 AND status IN ('pending', 'active')
             ORDER BY created_at DESC LIMIT 1`,
            [mainSessionId]
        )

        if (result.rows.length === 0) {
            return null
        }

        return this.rowToBrainSession(result.rows[0])
    }

    async updateBrainSessionStatus(id: string, status: BrainSessionStatus): Promise<boolean> {
        const now = Date.now()
        const result = await this.pool.query(
            `UPDATE brain_sessions SET status = $1, updated_at = $2 WHERE id = $3`,
            [status, now, id]
        )

        return (result.rowCount ?? 0) > 0
    }

    async updateBrainResult(id: string, result: string): Promise<boolean> {
        const now = Date.now()
        const queryResult = await this.pool.query(
            `UPDATE brain_sessions SET review_result = $1, updated_at = $2 WHERE id = $3`,
            [result, now, id]
        )

        return (queryResult.rowCount ?? 0) > 0
    }

    async completeBrainSession(id: string, result: string): Promise<boolean> {
        const now = Date.now()
        const queryResult = await this.pool.query(
            `UPDATE brain_sessions SET status = 'completed', review_result = $1, updated_at = $2, completed_at = $2 WHERE id = $3`,
            [result, now, id]
        )

        return (queryResult.rowCount ?? 0) > 0
    }

    async deleteBrainSession(id: string): Promise<boolean> {
        const result = await this.pool.query(
            `DELETE FROM brain_sessions WHERE id = $1`,
            [id]
        )

        return (result.rowCount ?? 0) > 0
    }

    async deleteBrainSessionsByMainSession(mainSessionId: string): Promise<number> {
        const result = await this.pool.query(
            `DELETE FROM brain_sessions WHERE main_session_id = $1`,
            [mainSessionId]
        )

        return result.rowCount ?? 0
    }

    // ============ Brain Rounds 相关方法 ============

    async createBrainRound(data: {
        brainSessionId: string
        roundNumber: number
        userInput: string
        aiSummary: string
        originalMessageIds?: string[]
        startedAt?: number
        endedAt?: number
    }): Promise<{ id: string }> {
        const id = randomUUID()
        const now = Date.now()

        await this.pool.query(
            `INSERT INTO brain_rounds
             (id, review_session_id, round_number, user_input, ai_summary, original_message_ids, started_at, ended_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [id, data.brainSessionId, data.roundNumber, data.userInput, data.aiSummary, data.originalMessageIds ?? [], data.startedAt ?? null, data.endedAt ?? null, now]
        )

        return { id }
    }

    async getBrainRounds(brainSessionId: string): Promise<Array<{
        id: string
        roundNumber: number
        userInput: string
        aiSummary: string
        originalMessageIds: string[]
        startedAt?: number
        endedAt?: number
        createdAt: number
    }>> {
        const result = await this.pool.query(
            `SELECT * FROM brain_rounds WHERE review_session_id = $1 ORDER BY round_number ASC`,
            [brainSessionId]
        )

        return result.rows.map(row => ({
            id: row.id as string,
            roundNumber: row.round_number as number,
            userInput: row.user_input as string,
            aiSummary: row.ai_summary as string,
            originalMessageIds: (row.original_message_ids as string[]) ?? [],
            startedAt: row.started_at ? Number(row.started_at) : undefined,
            endedAt: row.ended_at ? Number(row.ended_at) : undefined,
            createdAt: Number(row.created_at)
        }))
    }

    // ============ Brain Executions 相关方法 ============

    async createBrainExecution(data: {
        brainSessionId: string
        roundsReviewed: number
        reviewedRoundNumbers: number[]
        timeRangeStart: number
        timeRangeEnd: number
        prompt: string
        status?: string
    }): Promise<{ id: string }> {
        const id = randomUUID()
        const now = Date.now()

        await this.pool.query(
            `INSERT INTO brain_executions
             (id, review_session_id, rounds_reviewed, reviewed_round_numbers, time_range_start, time_range_end, prompt, status, progress_log, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '[]'::jsonb, $9)`,
            [id, data.brainSessionId, data.roundsReviewed, data.reviewedRoundNumbers, data.timeRangeStart, data.timeRangeEnd, data.prompt, data.status || 'pending', now]
        )

        return { id }
    }

    async getBrainExecutions(brainSessionId: string): Promise<Array<{
        id: string
        roundsReviewed: number
        reviewedRoundNumbers: number[]
        timeRangeStart: number
        timeRangeEnd: number
        prompt: string
        result?: string
        status: string
        createdAt: number
        completedAt?: number
    }>> {
        const result = await this.pool.query(
            `SELECT * FROM brain_executions WHERE review_session_id = $1 ORDER BY created_at DESC`,
            [brainSessionId]
        )

        return result.rows.map(row => ({
            id: row.id as string,
            roundsReviewed: row.rounds_reviewed as number,
            reviewedRoundNumbers: (row.reviewed_round_numbers as number[]) ?? [],
            timeRangeStart: Number(row.time_range_start),
            timeRangeEnd: Number(row.time_range_end),
            prompt: row.prompt as string,
            result: row.result as string | undefined,
            status: row.status as string,
            createdAt: Number(row.created_at),
            completedAt: row.completed_at ? Number(row.completed_at) : undefined
        }))
    }

    /**
     * 获取已 brain 过的轮次号集合
     * 只统计 completed 的执行记录（running/failed 不算）
     */
    async getBrainedRoundNumbers(brainSessionId: string): Promise<Set<number>> {
        const result = await this.pool.query(
            `SELECT reviewed_round_numbers FROM brain_executions WHERE review_session_id = $1 AND status = 'completed'`,
            [brainSessionId]
        )
        const brainedRoundNumbers = new Set<number>()
        for (const row of result.rows) {
            const nums = row.reviewed_round_numbers as number[]
            if (nums) {
                for (const num of nums) {
                    brainedRoundNumbers.add(num)
                }
            }
        }
        return brainedRoundNumbers
    }

    async appendProgressLog(executionId: string, entry: {
        id: string
        type: string
        content: string
        timestamp: number
    }): Promise<void> {
        await this.pool.query(
            `UPDATE brain_executions SET progress_log = progress_log || $1::jsonb WHERE id = $2`,
            [JSON.stringify([entry]), executionId]
        )
    }

    async getLatestExecutionWithProgress(brainSessionId: string): Promise<{
        id: string
        status: string
        progressLog: Array<{ id: string; type: string; content: string; timestamp: number }>
    } | null> {
        const result = await this.pool.query(
            `SELECT id, status, progress_log FROM brain_executions WHERE review_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [brainSessionId]
        )
        if (result.rows.length === 0) return null
        const row = result.rows[0]
        return {
            id: row.id as string,
            status: row.status as string,
            progressLog: (row.progress_log ?? []) as Array<{ id: string; type: string; content: string; timestamp: number }>
        }
    }

    async completeBrainExecution(id: string, result: string): Promise<boolean> {
        const now = Date.now()
        const queryResult = await this.pool.query(
            `UPDATE brain_executions SET status = 'completed', result = $1, completed_at = $2 WHERE id = $3`,
            [result, now, id]
        )

        return (queryResult.rowCount ?? 0) > 0
    }

    async failBrainExecution(id: string, error: string): Promise<boolean> {
        const now = Date.now()
        const queryResult = await this.pool.query(
            `UPDATE brain_executions SET status = 'failed', result = $1, completed_at = $2 WHERE id = $3`,
            [error, now, id]
        )

        return (queryResult.rowCount ?? 0) > 0
    }

    // ============ Applied Suggestions 相关方法 ============

    async getAppliedSuggestionIds(brainSessionId: string): Promise<string[]> {
        const result = await this.pool.query(
            `SELECT applied_suggestion_ids FROM brain_sessions WHERE id = $1`,
            [brainSessionId]
        )
        if (result.rows.length === 0) {
            return []
        }
        return (result.rows[0].applied_suggestion_ids as string[]) ?? []
    }

    async addAppliedSuggestionIds(brainSessionId: string, suggestionIds: string[]): Promise<boolean> {
        const now = Date.now()
        // 使用 array_cat 合并数组，然后用子查询去重
        const queryResult = await this.pool.query(
            `UPDATE brain_sessions
             SET applied_suggestion_ids = (
                 SELECT ARRAY(SELECT DISTINCT unnest(array_cat(applied_suggestion_ids, $1::TEXT[])))
             ),
             updated_at = $2
             WHERE id = $3`,
            [suggestionIds, now, brainSessionId]
        )
        return (queryResult.rowCount ?? 0) > 0
    }

    async deleteBrainRounds(brainSessionId: string): Promise<number> {
        const result = await this.pool.query(
            `DELETE FROM brain_rounds WHERE review_session_id = $1`,
            [brainSessionId]
        )

        return result.rowCount ?? 0
    }

    private rowToBrainSession(row: Record<string, unknown>): StoredBrainSession {
        return {
            id: row.id as string,
            namespace: row.namespace as string,
            mainSessionId: row.main_session_id as string,
            brainSessionId: row.review_session_id as string,
            brainModel: row.review_model as string,
            brainModelVariant: row.review_model_variant as string | undefined,
            status: row.status as BrainSessionStatus,
            contextSummary: row.context_summary as string,
            brainResult: row.review_result as string | undefined,
            createdAt: Number(row.created_at),
            updatedAt: Number(row.updated_at),
            completedAt: row.completed_at ? Number(row.completed_at) : undefined
        }
    }
}
