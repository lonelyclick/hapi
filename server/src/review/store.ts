/**
 * Review 模块 PostgreSQL Store 实现
 *
 * 这是一个试验性功能，独立于主 Store
 */

import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import type { IReviewStore, StoredReviewSession, ReviewSessionStatus } from './types'

export class ReviewStore implements IReviewStore {
    private pool: Pool

    constructor(pool: Pool) {
        this.pool = pool
    }

    async initSchema(): Promise<void> {
        await this.pool.query(`
            -- Review Sessions 表 (试验性功能)
            CREATE TABLE IF NOT EXISTS review_sessions (
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
            CREATE INDEX IF NOT EXISTS idx_review_sessions_main ON review_sessions(main_session_id);
            CREATE INDEX IF NOT EXISTS idx_review_sessions_review ON review_sessions(review_session_id);
            CREATE INDEX IF NOT EXISTS idx_review_sessions_namespace ON review_sessions(namespace);
            CREATE INDEX IF NOT EXISTS idx_review_sessions_status ON review_sessions(status);

            -- Review Rounds 表 - 存储每轮对话的汇总
            CREATE TABLE IF NOT EXISTS review_rounds (
                id TEXT PRIMARY KEY,
                review_session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
                round_number INTEGER NOT NULL,
                user_input TEXT NOT NULL,
                ai_summary TEXT NOT NULL,
                original_message_ids TEXT[],
                started_at BIGINT,
                ended_at BIGINT,
                created_at BIGINT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_review_rounds_session ON review_rounds(review_session_id);

            -- Review Executions 表 - 存储每次执行 review 的记录
            CREATE TABLE IF NOT EXISTS review_executions (
                id TEXT PRIMARY KEY,
                review_session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
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
            CREATE INDEX IF NOT EXISTS idx_review_executions_session ON review_executions(review_session_id);
        `)

        // 添加新字段（如果表已存在）
        await this.pool.query(`
            DO $$
            BEGIN
                -- 添加 started_at 字段
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'review_rounds' AND column_name = 'started_at') THEN
                    ALTER TABLE review_rounds ADD COLUMN started_at BIGINT;
                END IF;
                -- 添加 ended_at 字段
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'review_rounds' AND column_name = 'ended_at') THEN
                    ALTER TABLE review_rounds ADD COLUMN ended_at BIGINT;
                END IF;
                -- 添加 reviewed_round_numbers 字段到 review_executions
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'review_executions' AND column_name = 'reviewed_round_numbers') THEN
                    ALTER TABLE review_executions ADD COLUMN reviewed_round_numbers INTEGER[];
                END IF;
            END $$;
        `)
    }

    async createReviewSession(data: {
        namespace: string
        mainSessionId: string
        reviewSessionId: string
        reviewModel: string
        reviewModelVariant?: string
        contextSummary: string
    }): Promise<StoredReviewSession> {
        const id = randomUUID()
        const now = Date.now()

        await this.pool.query(
            `INSERT INTO review_sessions
             (id, namespace, main_session_id, review_session_id, review_model, review_model_variant, status, context_summary, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $8)`,
            [id, data.namespace, data.mainSessionId, data.reviewSessionId, data.reviewModel, data.reviewModelVariant ?? null, data.contextSummary, now]
        )

        return {
            id,
            namespace: data.namespace,
            mainSessionId: data.mainSessionId,
            reviewSessionId: data.reviewSessionId,
            reviewModel: data.reviewModel,
            reviewModelVariant: data.reviewModelVariant,
            status: 'pending',
            contextSummary: data.contextSummary,
            createdAt: now,
            updatedAt: now
        }
    }

    async getReviewSession(id: string): Promise<StoredReviewSession | null> {
        const result = await this.pool.query(
            `SELECT * FROM review_sessions WHERE id = $1`,
            [id]
        )

        if (result.rows.length === 0) {
            return null
        }

        return this.rowToReviewSession(result.rows[0])
    }

    async getReviewSessionsByMainSession(mainSessionId: string): Promise<StoredReviewSession[]> {
        const result = await this.pool.query(
            `SELECT * FROM review_sessions WHERE main_session_id = $1 ORDER BY created_at DESC`,
            [mainSessionId]
        )

        return result.rows.map(row => this.rowToReviewSession(row))
    }

    async getActiveReviewSession(mainSessionId: string): Promise<StoredReviewSession | null> {
        const result = await this.pool.query(
            `SELECT * FROM review_sessions
             WHERE main_session_id = $1 AND status IN ('pending', 'active')
             ORDER BY created_at DESC LIMIT 1`,
            [mainSessionId]
        )

        if (result.rows.length === 0) {
            return null
        }

        return this.rowToReviewSession(result.rows[0])
    }

    async updateReviewSessionStatus(id: string, status: ReviewSessionStatus): Promise<boolean> {
        const now = Date.now()
        const result = await this.pool.query(
            `UPDATE review_sessions SET status = $1, updated_at = $2 WHERE id = $3`,
            [status, now, id]
        )

        return (result.rowCount ?? 0) > 0
    }

    async updateReviewResult(id: string, result: string): Promise<boolean> {
        const now = Date.now()
        const queryResult = await this.pool.query(
            `UPDATE review_sessions SET review_result = $1, updated_at = $2 WHERE id = $3`,
            [result, now, id]
        )

        return (queryResult.rowCount ?? 0) > 0
    }

    async completeReviewSession(id: string, result: string): Promise<boolean> {
        const now = Date.now()
        const queryResult = await this.pool.query(
            `UPDATE review_sessions SET status = 'completed', review_result = $1, updated_at = $2, completed_at = $2 WHERE id = $3`,
            [result, now, id]
        )

        return (queryResult.rowCount ?? 0) > 0
    }

    async deleteReviewSession(id: string): Promise<boolean> {
        const result = await this.pool.query(
            `DELETE FROM review_sessions WHERE id = $1`,
            [id]
        )

        return (result.rowCount ?? 0) > 0
    }

    async deleteReviewSessionsByMainSession(mainSessionId: string): Promise<number> {
        const result = await this.pool.query(
            `DELETE FROM review_sessions WHERE main_session_id = $1`,
            [mainSessionId]
        )

        return result.rowCount ?? 0
    }

    // ============ Review Rounds 相关方法 ============

    async createReviewRound(data: {
        reviewSessionId: string
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
            `INSERT INTO review_rounds
             (id, review_session_id, round_number, user_input, ai_summary, original_message_ids, started_at, ended_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [id, data.reviewSessionId, data.roundNumber, data.userInput, data.aiSummary, data.originalMessageIds ?? [], data.startedAt ?? null, data.endedAt ?? null, now]
        )

        return { id }
    }

    async getReviewRounds(reviewSessionId: string): Promise<Array<{
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
            `SELECT * FROM review_rounds WHERE review_session_id = $1 ORDER BY round_number ASC`,
            [reviewSessionId]
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

    // ============ Review Executions 相关方法 ============

    async createReviewExecution(data: {
        reviewSessionId: string
        roundsReviewed: number
        reviewedRoundNumbers: number[]
        timeRangeStart: number
        timeRangeEnd: number
        prompt: string
    }): Promise<{ id: string }> {
        const id = randomUUID()
        const now = Date.now()

        await this.pool.query(
            `INSERT INTO review_executions
             (id, review_session_id, rounds_reviewed, reviewed_round_numbers, time_range_start, time_range_end, prompt, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
            [id, data.reviewSessionId, data.roundsReviewed, data.reviewedRoundNumbers, data.timeRangeStart, data.timeRangeEnd, data.prompt, now]
        )

        return { id }
    }

    async getReviewExecutions(reviewSessionId: string): Promise<Array<{
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
            `SELECT * FROM review_executions WHERE review_session_id = $1 ORDER BY created_at DESC`,
            [reviewSessionId]
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
     * 获取已 review 过的轮次号集合
     * 只要有执行记录就算已 review（因为 prompt 已发给 Review AI）
     */
    async getReviewedRoundNumbers(reviewSessionId: string): Promise<Set<number>> {
        const executions = await this.getReviewExecutions(reviewSessionId)
        const reviewedRoundNumbers = new Set<number>()
        for (const exec of executions) {
            if (exec.reviewedRoundNumbers) {
                for (const roundNum of exec.reviewedRoundNumbers) {
                    reviewedRoundNumbers.add(roundNum)
                }
            }
        }
        return reviewedRoundNumbers
    }

    async completeReviewExecution(id: string, result: string): Promise<boolean> {
        const now = Date.now()
        const queryResult = await this.pool.query(
            `UPDATE review_executions SET status = 'completed', result = $1, completed_at = $2 WHERE id = $3`,
            [result, now, id]
        )

        return (queryResult.rowCount ?? 0) > 0
    }

    async failReviewExecution(id: string, error: string): Promise<boolean> {
        const now = Date.now()
        const queryResult = await this.pool.query(
            `UPDATE review_executions SET status = 'failed', result = $1, completed_at = $2 WHERE id = $3`,
            [error, now, id]
        )

        return (queryResult.rowCount ?? 0) > 0
    }

    async deleteReviewRounds(reviewSessionId: string): Promise<number> {
        const result = await this.pool.query(
            `DELETE FROM review_rounds WHERE review_session_id = $1`,
            [reviewSessionId]
        )

        return result.rowCount ?? 0
    }

    private rowToReviewSession(row: Record<string, unknown>): StoredReviewSession {
        return {
            id: row.id as string,
            namespace: row.namespace as string,
            mainSessionId: row.main_session_id as string,
            reviewSessionId: row.review_session_id as string,
            reviewModel: row.review_model as string,
            reviewModelVariant: row.review_model_variant as string | undefined,
            status: row.status as ReviewSessionStatus,
            contextSummary: row.context_summary as string,
            reviewResult: row.review_result as string | undefined,
            createdAt: Number(row.created_at),
            updatedAt: Number(row.updated_at),
            completedAt: row.completed_at ? Number(row.completed_at) : undefined
        }
    }
}
