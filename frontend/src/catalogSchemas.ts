import { useQuery } from '@tanstack/react-query'
import { listAllSchemas } from './api/snowflake'
import { CATALOG_STALE_MS, queryGcTime } from './queryStale'
import type { Connection, NameItem, SchemaItem } from './types'

export { CATALOG_STALE_MS } from './queryStale'

export function allSchemasQueryKey(connectionId: string) {
  return ['all-schemas', connectionId] as const
}

export function databasesQueryKey(connectionId: string) {
  return ['databases', connectionId] as const
}

export function objectsQueryKey(
  connectionId: string,
  database: string,
  schema: string,
) {
  return ['objects', connectionId, database, schema] as const
}

export function useAllSchemas(connection: Connection) {
  return useQuery({
    queryKey: allSchemasQueryKey(connection.id),
    queryFn: () => listAllSchemas(connection),
    staleTime: CATALOG_STALE_MS,
    gcTime: queryGcTime(CATALOG_STALE_MS),
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

/** database name → its schemas, for one pass over the account-wide list. */
export function groupSchemasByDatabase(
  all: SchemaItem[] | undefined,
): ReadonlyMap<string, NameItem[]> {
  const map = new Map<string, NameItem[]>()
  if (!all) return map
  for (const s of all) {
    const list = map.get(s.database)
    if (list) list.push({ name: s.name })
    else map.set(s.database, [{ name: s.name }])
  }
  return map
}
