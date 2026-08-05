import type { ColumnFilter, SelectedObject, SortSpec } from './types'
import { BROWSE_PAGE_SIZE_MAX, getDefaultPageSize } from './pageSizePrefs'
import { objectKeyFrom, objectPathFrom } from './paths'
import { selectionPath, type SavedSelection } from './selections'

export type OpenTab = {
  key: string
  object: SelectedObject
  filters: ColumnFilter[]
  sort: SortSpec | null
  /** When true, preview uses SELECT DISTINCT. */
  distinct: boolean
  limit: number
  offset: number
  /** Column names to hide; empty = show all. */
  hiddenColumns: string[]
  /** Display order of column names; empty = schema order. */
  columnOrder: string[]
  /** Per-column pixel widths; missing = default. */
  columnWidths: Record<string, number>
  /** Data grid panel scroll (restored when switching tabs). */
  scrollTop: number
  scrollLeft: number
  /** Linked saved selection id, if this tab was opened from Selections. */
  selectionId: string | null
  /** Display name of the linked selection (session copy; synced from storage). */
  selectionName: string | null
  /** True when linked selection view state differs from the saved bookmark. */
  dirty: boolean
}

/** Session tab key for a selection-linked browse tab. */
export function selectionTabKey(selectionId: string): string {
  return `s:${selectionId}`
}

export function tabPath(tab: OpenTab): string {
  if (tab.selectionId) return selectionPath(tab.selectionId)
  return objectPathFrom(tab.object, { filters: tab.filters })
}

function storageKey(connectionId: string): string {
  return `sf-explorer.tabs:${connectionId}`
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isOpenTab(value: unknown): value is OpenTab {
  if (!value || typeof value !== 'object') return false
  const t = value as Record<string, unknown>
  const obj = t.object as Record<string, unknown> | undefined
  const hiddenOk =
    t.hiddenColumns === undefined || Array.isArray(t.hiddenColumns)
  const orderOk =
    t.columnOrder === undefined ||
    (Array.isArray(t.columnOrder) &&
      t.columnOrder.every((c) => typeof c === 'string'))
  const widthsOk =
    t.columnWidths === undefined ||
    (typeof t.columnWidths === 'object' &&
      t.columnWidths !== null &&
      !Array.isArray(t.columnWidths) &&
      Object.values(t.columnWidths as Record<string, unknown>).every(
        (v) => typeof v === 'number',
      ))
  const scrollOk =
    (t.scrollTop === undefined || isFiniteNumber(t.scrollTop)) &&
    (t.scrollLeft === undefined || isFiniteNumber(t.scrollLeft))
  const selectionIdOk =
    t.selectionId === undefined ||
    t.selectionId === null ||
    typeof t.selectionId === 'string'
  const selectionNameOk =
    t.selectionName === undefined ||
    t.selectionName === null ||
    typeof t.selectionName === 'string'
  const dirtyOk = t.dirty === undefined || typeof t.dirty === 'boolean'
  const distinctOk = t.distinct === undefined || typeof t.distinct === 'boolean'
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
    hiddenOk &&
    orderOk &&
    widthsOk &&
    scrollOk &&
    selectionIdOk &&
    selectionNameOk &&
    dirtyOk &&
    distinctOk
  )
}

function normalizeTab(tab: OpenTab): OpenTab {
  const selectionId =
    typeof tab.selectionId === 'string' && tab.selectionId
      ? tab.selectionId
      : null
  const selectionName =
    typeof tab.selectionName === 'string' && tab.selectionName
      ? tab.selectionName
      : null
  return {
    ...tab,
    distinct: Boolean(tab.distinct),
    hiddenColumns: Array.isArray(tab.hiddenColumns) ? tab.hiddenColumns : [],
    columnOrder: Array.isArray(tab.columnOrder) ? tab.columnOrder : [],
    columnWidths:
      tab.columnWidths && typeof tab.columnWidths === 'object'
        ? tab.columnWidths
        : {},
    scrollTop: isFiniteNumber(tab.scrollTop) ? Math.max(0, tab.scrollTop) : 0,
    scrollLeft: isFiniteNumber(tab.scrollLeft)
      ? Math.max(0, tab.scrollLeft)
      : 0,
    selectionId,
    selectionName,
    dirty: Boolean(tab.dirty) && selectionId !== null,
    key: selectionId ? selectionTabKey(selectionId) : tab.key,
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
    distinct: false,
    limit: getDefaultPageSize(BROWSE_PAGE_SIZE_MAX),
    offset: 0,
    hiddenColumns: [],
    columnOrder: [],
    columnWidths: {},
    scrollTop: 0,
    scrollLeft: 0,
    selectionId: null,
    selectionName: null,
    dirty: false,
  }
}

export function makeSelectionTab(sel: SavedSelection): OpenTab {
  return {
    key: selectionTabKey(sel.id),
    object: sel.object,
    filters: sel.filters,
    sort: sel.sort,
    distinct: Boolean(sel.distinct),
    limit: sel.limit,
    offset: 0,
    hiddenColumns: sel.hiddenColumns,
    columnOrder: sel.columnOrder,
    columnWidths: sel.columnWidths ?? {},
    scrollTop: 0,
    scrollLeft: 0,
    selectionId: sel.id,
    selectionName: sel.name,
    dirty: false,
  }
}

export const MIN_COLUMN_WIDTH = 48
export const MAX_COLUMN_WIDTH = 960
export const DEFAULT_COLUMN_WIDTH = 160

export function clampColumnWidth(width: number): number {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)))
}

export function normalizeColumnWidths(
  value: unknown,
): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = clampColumnWidth(v)
    }
  }
  return out
}

export function isColumnWidthsRecord(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.values(value as Record<string, unknown>).every(
        (v) => typeof v === 'number' && Number.isFinite(v),
      ))
  )
}

/** Apply a saved order to a column-name list (unknown names append at end). */
export function resolveColumnOrder(
  columns: string[],
  order: string[],
): string[] {
  if (order.length === 0) return columns
  const set = new Set(columns)
  const ordered = order.filter((n) => set.has(n))
  const rest = columns.filter((n) => !ordered.includes(n))
  return [...ordered, ...rest]
}

/** Move `from` to the position of `to` (insert before `to`). */
export function moveColumnBefore(
  allColumns: string[],
  order: string[],
  from: string,
  to: string,
): string[] {
  if (from === to) {
    return order.length ? resolveColumnOrder(allColumns, order) : [...allColumns]
  }
  const base = order.length
    ? resolveColumnOrder(allColumns, order)
    : [...allColumns]
  const next = base.filter((n) => n !== from)
  const idx = next.indexOf(to)
  if (idx === -1) return base
  next.splice(idx, 0, from)
  return next
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
