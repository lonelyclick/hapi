/**
 * Store module - re-exports types and IStore interface
 *
 * The only store implementation is PostgresStore.
 */

// Re-export all types from types.ts
export * from './types'

// Re-export the interface
export type { IStore } from './interface'

// Re-export PostgresStore as the default store implementation
export { PostgresStore } from './postgres'
