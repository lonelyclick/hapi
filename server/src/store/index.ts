/**
 * Store module - PostgreSQL only
 *
 * This module exports the IStore interface and PostgresStore implementation.
 * All types are re-exported from types.ts for convenience.
 */

// Re-export all types
export * from './types'

// Re-export the IStore interface
export type { IStore } from './interface'

// Re-export PostgresStore
export { PostgresStore } from './postgres'

// Type alias for backwards compatibility
// Code should use IStore, but Store is kept as an alias during migration
export type { IStore as Store } from './interface'

import type { PostgresConfig } from './types'
import { PostgresStore } from './postgres'
import type { IStore } from './interface'

/**
 * Create a PostgreSQL store instance
 */
export async function createStore(config: PostgresConfig): Promise<IStore> {
    return PostgresStore.create(config)
}
