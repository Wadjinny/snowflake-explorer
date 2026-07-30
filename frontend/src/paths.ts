import type {
  ColumnFilter,
  FacetableType,
  FilterOp,
  FilterValue,
  ObjectKind,
  SelectedObject,
} from './types'
import { filterIsActive, normalizeColumnFilter } from './types'

const FACETABLE_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'date',
  'timestamp',
])

const FILTER_OPS: ReadonlySet<string> = new Set([
  'in',
  'is_null',
  'is_not_null',
  'is_empty',
  'is_not_empty',
  'has',
  'startswith',
  'endswith',
  'gt',
  'lt',
  'between',
  'this_hour',
  'this_day',
  'this_week',
  'this_month',
  'this_year',
  'last_hour',
  'last_day',
  'last_week',
  'last_month',
  'last_year',
])

function isFilterValue(value: unknown): value is FilterValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function isColumnFilter(value: unknown): value is ColumnFilter {
  if (!value || typeof value !== 'object') return false
  const f = value as Record<string, unknown>
  const opOk = f.op === undefined || FILTER_OPS.has(String(f.op))
  return (
    typeof f.column === 'string' &&
    FACETABLE_TYPES.has(String(f.type)) &&
    Array.isArray(f.values) &&
    f.values.every(isFilterValue) &&
    opOk
  )
}

/** Active filters only, stable JSON for the `f` search param. */
export function serializeFiltersParam(filters: ColumnFilter[]): string | null {
  const active = filters
    .map(normalizeColumnFilter)
    .filter(filterIsActive)
    .map((f) => {
    const op = f.op && f.op !== 'in' ? f.op : undefined
    const row: {
      column: string
      type: FacetableType
      values: FilterValue[]
      op?: FilterOp
    } = {
      column: f.column,
      type: f.type,
      values: f.values,
    }
    if (op) row.op = op
    return row
  })
  if (active.length === 0) return null
  return JSON.stringify(active)
}

/** Parse `f` query value. Invalid JSON yields []. */
export function parseFiltersParam(raw: string | null): ColumnFilter[] {
  if (raw == null || raw === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isColumnFilter).map(normalizeColumnFilter)
  } catch {
    return []
  }
}

export function filtersParamEqual(a: ColumnFilter[], b: ColumnFilter[]): boolean {
  return serializeFiltersParam(a) === serializeFiltersParam(b)
}

export type ObjectPathOptions = {
  filters?: ColumnFilter[]
}

/** Shareable path for a table/view: /o/:database/:schema/:name[?kind=view][&f=…] */
export function objectPath(
  database: string,
  schema: string,
  name: string,
  kind: ObjectKind = 'table',
  opts?: ObjectPathOptions,
): string {
  const base = `/o/${encodeURIComponent(database)}/${encodeURIComponent(schema)}/${encodeURIComponent(name)}`
  const params = new URLSearchParams()
  if (kind === 'view') params.set('kind', 'view')
  const encoded = serializeFiltersParam(opts?.filters ?? [])
  if (encoded) params.set('f', encoded)
  const q = params.toString()
  return q ? `${base}?${q}` : base
}

export function objectPathFrom(
  obj: SelectedObject,
  opts?: ObjectPathOptions,
): string {
  return objectPath(obj.database, obj.schema, obj.name, obj.kind, opts)
}

export function objectKey(
  database: string,
  schema: string,
  name: string,
): string {
  return `${database}\u0000${schema}\u0000${name}`
}

export function objectKeyFrom(obj: SelectedObject): string {
  return objectKey(obj.database, obj.schema, obj.name)
}

export function shortObjectLabel(obj: SelectedObject): string {
  return obj.name
}

export function objectTitle(obj: SelectedObject): string {
  return `${obj.database}.${obj.schema}.${obj.name}`
}
