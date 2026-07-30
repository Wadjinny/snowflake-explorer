import { useQuery } from '@tanstack/react-query'
import { listAllSchemas } from './api/snowflake'
import type { Connection, NameItem, SchemaItem } from './types'

/** Catalog lists change rarely; keep account-wide schema data across expands. */
export const CATALOG_STALE_MS = 5 * 60 * 1000

export function allSchemasQueryKey(connectionId: string) {
  return ['all-schemas', connectionId] as const
}

export function useAllSchemas(connection: Connection) {
  return useQuery({
    queryKey: allSchemasQueryKey(connection.id),
    queryFn: () => listAllSchemas(connection),
    staleTime: CATALOG_STALE_MS,
  })
}

export function schemasInDatabase(
  all: SchemaItem[] | undefined,
  database: string,
): NameItem[] {
  if (!all) return []
  return all
    .filter((s) => s.database === database)
    .map((s) => ({ name: s.name }))
}

export function schemasByDatabaseMap(
  all: SchemaItem[] | undefined,
  databases?: readonly { name: string }[],
): Map<string, ReadonlySet<string>> {
  const map = new Map<string, Set<string>>()
  if (databases) {
    for (const db of databases) map.set(db.name, new Set())
  }
  if (!all) return map
  for (const s of all) {
    let set = map.get(s.database)
    if (!set) {
      set = new Set()
      map.set(s.database, set)
    }
    set.add(s.name)
  }
  return map
}
