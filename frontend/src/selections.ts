import type {
  ColumnFilter,
  FilterValue,
  ObjectKind,
  SelectedObject,
  SortSpec,
} from './types'
import { filterIsActive } from './types'

export type SavedSelection = {
  id: string
  name: string
  object: SelectedObject
  filters: ColumnFilter[]
  sort: SortSpec | null
  hiddenColumns: string[]
  columnOrder: string[]
  columnWidths: Record<string, number>
  limit: number
  createdAt: number
}

function storageKey(connectionId: string): string {
  return `sf-explorer.selections:${connectionId}`
}

function isObjectKind(value: unknown): value is ObjectKind {
  return value === 'table' || value === 'view'
}

function isFilterValue(value: unknown): value is FilterValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function isFilterOp(value: unknown): boolean {
  return (
    value === undefined ||
    value === 'in' ||
    value === 'is_null' ||
    value === 'is_not_null' ||
    value === 'is_empty' ||
    value === 'is_not_empty' ||
    value === 'has' ||
    value === 'startswith' ||
    value === 'endswith' ||
    value === 'gt' ||
    value === 'lt' ||
    value === 'between'
  )
}

function isColumnFilter(value: unknown): value is ColumnFilter {
  if (!value || typeof value !== 'object') return false
  const f = value as Record<string, unknown>
  return (
    typeof f.column === 'string' &&
    (f.type === 'string' ||
      f.type === 'number' ||
      f.type === 'date' ||
      f.type === 'timestamp') &&
    Array.isArray(f.values) &&
    f.values.every(isFilterValue) &&
    isFilterOp(f.op)
  )
}

function isSortSpec(value: unknown): value is SortSpec | null {
  if (value === null) return true
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  return (
    typeof s.column === 'string' &&
    (s.direction === 'asc' || s.direction === 'desc')
  )
}

function isSavedSelection(value: unknown): value is SavedSelection {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  const obj = s.object as Record<string, unknown> | undefined
  const orderOk =
    s.columnOrder === undefined ||
    (Array.isArray(s.columnOrder) &&
      s.columnOrder.every((c) => typeof c === 'string'))
  const widthsOk =
    s.columnWidths === undefined ||
    (typeof s.columnWidths === 'object' &&
      s.columnWidths !== null &&
      !Array.isArray(s.columnWidths) &&
      Object.values(s.columnWidths as Record<string, unknown>).every(
        (v) => typeof v === 'number',
      ))
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    !!obj &&
    typeof obj.database === 'string' &&
    typeof obj.schema === 'string' &&
    typeof obj.name === 'string' &&
    isObjectKind(obj.kind) &&
    Array.isArray(s.filters) &&
    s.filters.every(isColumnFilter) &&
    isSortSpec(s.sort) &&
    Array.isArray(s.hiddenColumns) &&
    s.hiddenColumns.every((c) => typeof c === 'string') &&
    orderOk &&
    widthsOk &&
    typeof s.limit === 'number' &&
    typeof s.createdAt === 'number'
  )
}

function normalizeSelection(sel: SavedSelection): SavedSelection {
  return {
    ...sel,
    columnOrder: Array.isArray(sel.columnOrder) ? sel.columnOrder : [],
    columnWidths:
      sel.columnWidths && typeof sel.columnWidths === 'object'
        ? sel.columnWidths
        : {},
  }
}

export function loadSelections(connectionId: string): SavedSelection[] {
  try {
    const raw = localStorage.getItem(storageKey(connectionId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSavedSelection).map(normalizeSelection)
  } catch {
    return []
  }
}

export function saveSelections(
  connectionId: string,
  selections: SavedSelection[],
): void {
  try {
    localStorage.setItem(storageKey(connectionId), JSON.stringify(selections))
  } catch {
    // ignore quota errors
  }
}

export function defaultSelectionName(
  object: SelectedObject,
  filters: ColumnFilter[],
  sort: SortSpec | null,
): string {
  const filterCount = filters.filter(filterIsActive).length
  const parts = [object.name]
  if (filterCount > 0)
    parts.push(`${filterCount} filter${filterCount === 1 ? '' : 's'}`)
  if (sort) parts.push(`${sort.column} ${sort.direction}`)
  return parts.join(' · ')
}

export function makeSelection(input: {
  name: string
  object: SelectedObject
  filters: ColumnFilter[]
  sort: SortSpec | null
  hiddenColumns: string[]
  columnOrder: string[]
  columnWidths: Record<string, number>
  limit: number
}): SavedSelection {
  return {
    id: crypto.randomUUID(),
    name:
      input.name.trim() ||
      defaultSelectionName(input.object, input.filters, input.sort),
    object: input.object,
    filters: input.filters,
    sort: input.sort,
    hiddenColumns: input.hiddenColumns,
    columnOrder: input.columnOrder,
    columnWidths: input.columnWidths,
    limit: input.limit,
    createdAt: Date.now(),
  }
}

export function selectionFilterCount(sel: SavedSelection): number {
  return sel.filters.filter(filterIsActive).length
}
