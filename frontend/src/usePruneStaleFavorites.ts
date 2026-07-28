import { useQueries } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { listObjects, listSchemas } from './api/snowflake'
import { pruneMissingFavorites, type Favorite } from './favorites'
import type { Connection, NameItem } from './types'

/**
 * Drop favorites whose database / schema / object no longer appears in the
 * Snowflake catalog. Uses the same query keys as the object tree so fetches
 * share the TanStack Query cache.
 */
export function usePruneStaleFavorites(
  connection: Connection,
  favorites: Favorite[],
  replace: (next: Favorite[]) => void,
  databases: NameItem[] | undefined,
): void {
  const databasesNeedingSchemas = useMemo(() => {
    const dbs = new Set<string>()
    for (const fav of favorites) {
      if (fav.kind === 'schema' || fav.kind === 'object') {
        dbs.add(fav.database)
      }
    }
    return [...dbs].sort()
  }, [favorites])

  const schemasNeedingObjects = useMemo(() => {
    const keys: { database: string; schema: string }[] = []
    const seen = new Set<string>()
    for (const fav of favorites) {
      if (fav.kind !== 'object') continue
      const key = `${fav.database}\0${fav.schema}`
      if (seen.has(key)) continue
      seen.add(key)
      keys.push({ database: fav.database, schema: fav.schema })
    }
    keys.sort((a, b) =>
      a.database === b.database
        ? a.schema.localeCompare(b.schema)
        : a.database.localeCompare(b.database),
    )
    return keys
  }, [favorites])

  const schemaQueries = useQueries({
    queries: databasesNeedingSchemas.map((database) => ({
      queryKey: ['schemas', connection.id, database],
      queryFn: () => listSchemas(connection, database),
    })),
  })

  const objectQueries = useQueries({
    queries: schemasNeedingObjects.map(({ database, schema }) => ({
      queryKey: ['objects', connection.id, database, schema],
      queryFn: () => listObjects(connection, database, schema),
    })),
  })

  // Content fingerprints (not query-result identity) so maps stay stable.
  const schemaCatalogKey = databasesNeedingSchemas
    .map((database, i) => {
      const q = schemaQueries[i]
      if (!q?.isSuccess || !q.data) return `${database}:`
      return `${database}:${q.data.map((s) => s.name).join('\0')}`
    })
    .join('|')

  const objectCatalogKey = schemasNeedingObjects
    .map(({ database, schema }, i) => {
      const q = objectQueries[i]
      const loc = `${database}\0${schema}`
      if (!q?.isSuccess || !q.data) return `${loc}:`
      return `${loc}:${q.data.map((o) => o.name).join('\0')}`
    })
    .join('|')

  const schemasByDatabase = useMemo(() => {
    const map = new Map<string, ReadonlySet<string>>()
    for (const entry of schemaCatalogKey.split('|')) {
      if (!entry) continue
      const sep = entry.indexOf(':')
      if (sep < 0) continue
      const database = entry.slice(0, sep)
      const names = entry.slice(sep + 1)
      if (!names) continue
      map.set(database, new Set(names.split('\0')))
    }
    return map
  }, [schemaCatalogKey])

  const objectsBySchema = useMemo(() => {
    const map = new Map<string, ReadonlySet<string>>()
    for (const entry of objectCatalogKey.split('|')) {
      if (!entry) continue
      const sep = entry.indexOf(':')
      if (sep < 0) continue
      const loc = entry.slice(0, sep)
      const names = entry.slice(sep + 1)
      if (!names) continue
      map.set(loc, new Set(names.split('\0')))
    }
    return map
  }, [objectCatalogKey])

  useEffect(() => {
    if (favorites.length === 0) return

    const next = pruneMissingFavorites(favorites, {
      ...(databases
        ? { databases: new Set(databases.map((d) => d.name)) }
        : {}),
      ...(schemasByDatabase.size > 0 ? { schemasByDatabase } : {}),
      ...(objectsBySchema.size > 0 ? { objectsBySchema } : {}),
    })

    replace(next)
  }, [
    databases,
    favorites,
    objectsBySchema,
    replace,
    schemasByDatabase,
  ])
}
