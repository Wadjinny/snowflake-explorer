import { useEffect, useMemo } from 'react'
import { schemasByDatabaseMap, useAllSchemas } from './catalogSchemas'
import { pruneMissingFavorites, type Favorite } from './favorites'
import type { Connection, NameItem } from './types'

/**
 * Drop favorites whose database / schema no longer appears in the Snowflake
 * catalog. Uses account-wide schemas (no per-schema object listing).
 */
export function usePruneStaleFavorites(
  connection: Connection,
  favorites: Favorite[],
  replace: (next: Favorite[]) => void,
  databases: NameItem[] | undefined,
): void {
  const accountSchemas = useAllSchemas(connection)

  const schemasByDatabase = useMemo(
    () =>
      accountSchemas.isSuccess
        ? schemasByDatabaseMap(accountSchemas.data, databases)
        : new Map<string, ReadonlySet<string>>(),
    [accountSchemas.data, accountSchemas.isSuccess, databases],
  )

  useEffect(() => {
    if (favorites.length === 0) return

    const next = pruneMissingFavorites(favorites, {
      ...(databases
        ? { databases: new Set(databases.map((d) => d.name)) }
        : {}),
      ...(accountSchemas.isSuccess ? { schemasByDatabase } : {}),
    })

    replace(next)
  }, [
    accountSchemas.isSuccess,
    databases,
    favorites,
    replace,
    schemasByDatabase,
  ])
}
