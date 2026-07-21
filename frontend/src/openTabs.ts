import type { ColumnFilter, SelectedObject, SortSpec } from './types'
import { objectKeyFrom } from './paths'

export type OpenTab = {
  key: string
  object: SelectedObject
  filters: ColumnFilter[]
  sort: SortSpec | null
  limit: number
  offset: number
  /** Column names to hide; empty = show all. */
  hiddenColumns: string[]
}

const DEFAULT_LIMIT = 100

function storageKey(connectionId: string): string {
  return `sf-explorer.tabs:${connectionId}`
}

function isOpenTab(value: unknown): value is OpenTab {
  if (!value || typeof value !== 'object') return false
  const t = value as Record<string, unknown>
  const obj = t.object as Record<string, unknown> | undefined
  const hiddenOk =
    t.hiddenColumns === undefined || Array.isArray(t.hiddenColumns)
  return (
    typeof t.key === 'string' &&
    !!obj &&
    typeof obj.database === 'string' &&
    typeof obj.schema === 'string' &&
    typeof obj.name === 'string' &&
    (obj.kind === 'table' || obj.kind === 'view') &&
    Array.isArray(t.filters) &&
    (t.sort === null || typeof t.sort === 'object') &&
    typeof t.limit === 'number' &&
    typeof t.offset === 'number' &&
    hiddenOk
  )
}

function normalizeTab(tab: OpenTab): OpenTab {
  return {
    ...tab,
    hiddenColumns: Array.isArray(tab.hiddenColumns) ? tab.hiddenColumns : [],
  }
}

export function loadTabs(connectionId: string): OpenTab[] {
  try {
    const raw = sessionStorage.getItem(storageKey(connectionId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isOpenTab).map(normalizeTab)
  } catch {
    return []
  }
}

export function saveTabs(connectionId: string, tabs: OpenTab[]): void {
  try {
    sessionStorage.setItem(storageKey(connectionId), JSON.stringify(tabs))
  } catch {
    // ignore quota errors
  }
}

export function makeTab(object: SelectedObject): OpenTab {
  return {
    key: objectKeyFrom(object),
    object,
    filters: [],
    sort: null,
    limit: DEFAULT_LIMIT,
    offset: 0,
    hiddenColumns: [],
  }
}

export function upsertTab(tabs: OpenTab[], object: SelectedObject): OpenTab[] {
  const key = objectKeyFrom(object)
  const existing = tabs.find((t) => t.key === key)
  if (existing) {
    if (existing.object.kind !== object.kind) {
      return tabs.map((t) =>
        t.key === key ? { ...t, object: { ...t.object, kind: object.kind } } : t,
      )
    }
    return tabs
  }
  return [...tabs, makeTab(object)]
}
