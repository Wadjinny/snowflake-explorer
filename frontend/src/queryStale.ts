/** Shared TanStack Query cache times for Snowflake API reads. */

/** SHOW DATABASES / SCHEMAS / INFORMATION_SCHEMA object lists. */
export const CATALOG_STALE_MS = 30 * 60 * 1000

/** Table/view preview rows (browse grid). */
export const PREVIEW_STALE_MS = 10 * 60 * 1000

/** Column facet values + period drill trees. */
export const FACET_STALE_MS = 10 * 60 * 1000

/** Transform recipe column probes (DESC / LIMIT 0). */
export const TRANSFORM_COLUMNS_STALE_MS = 10 * 60 * 1000

/** Keep unused query results a bit longer than staleTime. */
export function queryGcTime(staleMs: number): number {
  return staleMs * 2
}
