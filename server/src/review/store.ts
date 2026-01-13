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
