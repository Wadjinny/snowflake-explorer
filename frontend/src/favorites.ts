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

/** Path to expand in the tree when a db/schema favorite is opened. */
export type RevealPath = {
  database: string
  schema?: string
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
