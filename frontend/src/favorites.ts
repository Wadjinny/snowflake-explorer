import type { ObjectKind } from './types'

export type Favorite =
  | { kind: 'database'; database: string }
  | { kind: 'schema'; database: string; schema: string }
  | {
      kind: 'object'
      database: string
      schema: string
      name: string
      objectKind: ObjectKind
    }

export type FavoriteObjectNode = {
  name: string
  objectKind: ObjectKind
}

export type FavoriteSchemaNode = {
  schema: string
  favorited: boolean
  objects: FavoriteObjectNode[]
}

export type FavoriteDatabaseNode = {
  database: string
  favorited: boolean
  schemas: FavoriteSchemaNode[]
}

/** Nest flat favorites into database → schema → object trees. */
export function buildFavoriteForest(favorites: Favorite[]): FavoriteDatabaseNode[] {
  const order: string[] = []
  const dbs = new Map<
    string,
    {
      favorited: boolean
      schemaOrder: string[]
      schemas: Map<
        string,
        { favorited: boolean; objectOrder: string[]; objects: Map<string, ObjectKind> }
      >
    }
  >()

  const ensureDb = (database: string) => {
    let db = dbs.get(database)
    if (!db) {
      db = { favorited: false, schemaOrder: [], schemas: new Map() }
      dbs.set(database, db)
      order.push(database)
    }
    return db
  }

  const ensureSchema = (database: string, schema: string) => {
    const db = ensureDb(database)
    let sch = db.schemas.get(schema)
    if (!sch) {
      sch = { favorited: false, objectOrder: [], objects: new Map() }
      db.schemas.set(schema, sch)
      db.schemaOrder.push(schema)
    }
    return sch
  }

  for (const fav of favorites) {
    if (fav.kind === 'database') {
      ensureDb(fav.database).favorited = true
    } else if (fav.kind === 'schema') {
      ensureSchema(fav.database, fav.schema).favorited = true
    } else {
      const sch = ensureSchema(fav.database, fav.schema)
      if (!sch.objects.has(fav.name)) {
        sch.objectOrder.push(fav.name)
      }
      sch.objects.set(fav.name, fav.objectKind)
    }
  }

  return order.map((database) => {
    const db = dbs.get(database)!
    return {
      database,
      favorited: db.favorited,
      schemas: db.schemaOrder.map((schema) => {
        const sch = db.schemas.get(schema)!
        return {
          schema,
          favorited: sch.favorited,
          objects: sch.objectOrder.map((name) => ({
            name,
            objectKind: sch.objects.get(name)!,
          })),
        }
      }),
    }
  })
}

function storageKey(connectionId: string): string {
  return `sf-explorer.favorites:${connectionId}`
}

export function favoriteKey(fav: Favorite): string {
  if (fav.kind === 'database') return `db:${fav.database}`
  if (fav.kind === 'schema') return `schema:${fav.database}\0${fav.schema}`
  return `object:${fav.database}\0${fav.schema}\0${fav.name}`
}

export function favoriteLabel(fav: Favorite): string {
  if (fav.kind === 'database') return fav.database
  if (fav.kind === 'schema') return `${fav.database}.${fav.schema}`
  return fav.name
}

export function favoriteTitle(fav: Favorite): string {
  if (fav.kind === 'database') return fav.database
  if (fav.kind === 'schema') return `${fav.database}.${fav.schema}`
  return `${fav.database}.${fav.schema}.${fav.name}`
}

function isFavorite(value: unknown): value is Favorite {
  if (!value || typeof value !== 'object') return false
  const f = value as Record<string, unknown>
  if (f.kind === 'database') return typeof f.database === 'string'
  if (f.kind === 'schema') {
    return typeof f.database === 'string' && typeof f.schema === 'string'
  }
  if (f.kind === 'object') {
    return (
      typeof f.database === 'string' &&
      typeof f.schema === 'string' &&
      typeof f.name === 'string' &&
      (f.objectKind === 'table' || f.objectKind === 'view')
    )
  }
  return false
}

export function loadFavorites(connectionId: string): Favorite[] {
  try {
    const raw = localStorage.getItem(storageKey(connectionId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isFavorite)
  } catch {
    return []
  }
}

export function saveFavorites(connectionId: string, favorites: Favorite[]): void {
  try {
    localStorage.setItem(storageKey(connectionId), JSON.stringify(favorites))
  } catch {
    // ignore quota errors
  }
}

export function toggleFavorite(list: Favorite[], fav: Favorite): Favorite[] {
  const key = favoriteKey(fav)
  const existing = list.findIndex((f) => favoriteKey(f) === key)
  if (existing >= 0) return list.filter((_, i) => i !== existing)
  return [fav, ...list]
}

export function hasFavorite(list: Favorite[], fav: Favorite): boolean {
  const key = favoriteKey(fav)
  return list.some((f) => favoriteKey(f) === key)
}

/** True when both lists contain the same favorites (order ignored). */
export function favoritesEqual(a: Favorite[], b: Favorite[]): boolean {
  if (a.length !== b.length) return false
  const keys = new Set(a.map(favoriteKey))
  return b.every((f) => keys.has(favoriteKey(f)))
}

/**
 * Drop favorites that are missing from known catalog slices.
 * Only levels with a provided set are checked (so partial loads are safe).
 */
export function pruneMissingFavorites(
  list: Favorite[],
  catalog: {
    databases?: ReadonlySet<string>
    /** database → schema names */
    schemasByDatabase?: ReadonlyMap<string, ReadonlySet<string>>
    /** `${database}\0${schema}` → object names */
    objectsBySchema?: ReadonlyMap<string, ReadonlySet<string>>
  },
): Favorite[] {
  const { databases, schemasByDatabase, objectsBySchema } = catalog
  return list.filter((fav) => {
    if (databases && !databases.has(fav.database)) return false

    if (fav.kind === 'schema' || fav.kind === 'object') {
      const schemas = schemasByDatabase?.get(fav.database)
      if (schemas && !schemas.has(fav.schema)) return false
    }

    if (fav.kind === 'object') {
      const key = `${fav.database}\0${fav.schema}`
      const objects = objectsBySchema?.get(key)
      if (objects && !objects.has(fav.name)) return false
    }

    return true
  })
}

/** True when a schema/object under this database (or object under this schema) is favorited. */
export function hasFavoriteDescendant(
  list: Favorite[],
  parent:
    | { kind: 'database'; database: string }
    | { kind: 'schema'; database: string; schema: string },
): boolean {
  if (parent.kind === 'database') {
    return list.some(
      (f) =>
        f.database === parent.database &&
        (f.kind === 'schema' || f.kind === 'object'),
    )
  }
  return list.some(
    (f) =>
      f.kind === 'object' &&
      f.database === parent.database &&
      f.schema === parent.schema,
  )
}
