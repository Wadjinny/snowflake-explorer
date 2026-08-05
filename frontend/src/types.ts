export type Connection = {
  id: string
  name: string
  account: string
  user: string
  password: string
  warehouse: string
  role?: string
}

export type NameItem = {
  name: string
}

/** Schema row from account-wide catalog listing (`GET /api/schemas`). */
export type SchemaItem = {
  database: string
  name: string
}

export type ObjectKind = 'table' | 'view'

export type ObjectItem = {
  name: string
  kind: ObjectKind
  /** Table metadata row count; null/undefined for views. */
  row_count?: number | null
}

/** Compact count: 999 → 999, 1200 → 1.2k, 3_400_000 → 3.4M */
export function formatShortCount(n: number): string {
  const abs = Math.abs(n)
  if (abs < 1000) return String(n)
  if (abs < 1_000_000) {
    const v = n / 1000
    return `${Number.isInteger(v) ? v : v.toFixed(1).replace(/\.0$/, '')}k`
  }
  if (abs < 1_000_000_000) {
    const v = n / 1_000_000
    return `${Number.isInteger(v) ? v : v.toFixed(1).replace(/\.0$/, '')}M`
  }
  const v = n / 1_000_000_000
  return `${Number.isInteger(v) ? v : v.toFixed(1).replace(/\.0$/, '')}B`
}

export type ColumnType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'binary'
  | 'semi'
  | 'geo'
  | 'other'

export type FacetableType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'timestamp'

export type ColumnInfo = {
  name: string
  type: ColumnType
}

export type SortDirection = 'asc' | 'desc'

export type SortSpec = {
  column: string
  direction: SortDirection
}

export type CountResult = {
  total: number
}

export type PreviewResult = {
  columns: ColumnInfo[]
  rows: (string | number | boolean | null)[][]
  total: number
  /** Full table schema when `columns` is a distinct projection subset. */
  schemaColumns?: ColumnInfo[] | null
}

export type SelectedObject = {
  database: string
  schema: string
  name: string
  kind: ObjectKind
}

export type FilterValue = string | number | boolean | null

/** How a column filter is applied. Default / omitted is value list (`in`). */
export type FilterOp =
  | 'in'
  | 'is_null'
  | 'is_not_null'
  | 'is_empty'
  | 'is_not_empty'
  | 'has'
  | 'startswith'
  | 'endswith'
  | 'gt'
  | 'lt'
  | 'between'
  | 'this_hour'
  | 'this_day'
  | 'this_week'
  | 'this_month'
  | 'this_year'
  | 'last_hour'
  | 'last_day'
  | 'last_week'
  | 'last_month'
  | 'last_year'

export const STRING_FILTER_OPS: FilterOp[] = [
  'is_null',
  'is_not_null',
  'is_empty',
  'is_not_empty',
  'has',
  'startswith',
  'endswith',
]

export const NUMBER_FILTER_OPS: FilterOp[] = [
  'gt',
  'lt',
  'between',
  'is_not_null',
  'is_null',
]

export const BOOLEAN_FILTER_OPS: FilterOp[] = ['is_not_null', 'is_null']

export const DATE_RELATIVE_OPS: FilterOp[] = [
  'this_year',
  'this_month',
  'this_week',
  'this_day',
  'last_year',
  'last_month',
  'last_week',
  'last_day',
]

export const TIMESTAMP_RELATIVE_OPS: FilterOp[] = [
  'this_year',
  'this_month',
  'this_week',
  'this_day',
  'this_hour',
  'last_year',
  'last_month',
  'last_week',
  'last_day',
  'last_hour',
]

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  in: 'Values',
  is_null: 'Null',
  is_not_null: 'Not null',
  is_empty: 'Empty',
  is_not_empty: 'Not empty',
  has: 'Has',
  startswith: 'Starts with',
  endswith: 'Ends with',
  gt: 'Bigger than',
  lt: 'Lower than',
  between: 'Between',
  this_hour: 'This hour',
  this_day: 'This day',
  this_week: 'This week',
  this_month: 'This month',
  this_year: 'This year',
  last_hour: 'Last hour',
  last_day: 'Last day',
  last_week: 'Last week',
  last_month: 'Last month',
  last_year: 'Last year',
}

export function isRelativeFilterOp(op: FilterOp): boolean {
  return (
    op === 'this_hour' ||
    op === 'this_day' ||
    op === 'this_week' ||
    op === 'this_month' ||
    op === 'this_year' ||
    op === 'last_hour' ||
    op === 'last_day' ||
    op === 'last_week' ||
    op === 'last_month' ||
    op === 'last_year'
  )
}

export type ColumnFilter = {
  column: string
  type: FacetableType
  values: FilterValue[]
  /** Defaults to `in` when omitted (legacy saved filters). */
  op?: FilterOp
  /** When true, kept in the recipe but skipped at run time. */
  disabled?: boolean
}

/** Map stray null labels (e.g. Python `str(None)`) back to JSON null. */
export function normalizeFilterValue(
  type: FacetableType,
  value: FilterValue,
): FilterValue {
  if (value === null) return null
  if (
    (type === 'date' || type === 'timestamp') &&
    typeof value === 'string'
  ) {
    const text = value.trim().toLowerCase()
    if (text === '' || text === 'none' || text === 'null') return null
  }
  return value
}

export function normalizeColumnFilter(filter: ColumnFilter): ColumnFilter {
  return {
    ...filter,
    values: filter.values.map((v) => normalizeFilterValue(filter.type, v)),
  }
}

export function normalizeFilterOp(op: FilterOp | undefined): FilterOp {
  return op ?? 'in'
}

export function filterNeedsPattern(op: FilterOp): boolean {
  return op === 'has' || op === 'startswith' || op === 'endswith'
}

/** Single numeric operand (gt / lt). */
export function filterNeedsNumber(op: FilterOp): boolean {
  return op === 'gt' || op === 'lt'
}

/** Two numeric operands (between). */
export function filterNeedsBounds(op: FilterOp): boolean {
  return op === 'between'
}

export function parseFilterNumber(value: FilterValue | undefined): number | null {
  if (value == null) return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  const text = String(value).trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/** Whether the filter defines a runnable condition (ignores `disabled`). */
export function filterHasCondition(filter: ColumnFilter): boolean {
  const op = normalizeFilterOp(filter.op)
  if (op === 'in') return filter.values.length > 0
  if (
    op === 'is_null' ||
    op === 'is_not_null' ||
    op === 'is_empty' ||
    op === 'is_not_empty' ||
    isRelativeFilterOp(op)
  ) {
    return true
  }
  if (filterNeedsNumber(op)) {
    return parseFilterNumber(filter.values[0]) != null
  }
  if (filterNeedsBounds(op)) {
    return (
      parseFilterNumber(filter.values[0]) != null &&
      parseFilterNumber(filter.values[1]) != null
    )
  }
  return filter.values.some((v) => v != null && String(v).length > 0)
}

/** Active for query/run: has a condition and is not disabled. */
export function filterIsActive(filter: ColumnFilter): boolean {
  if (filter.disabled) return false
  return filterHasCondition(filter)
}

/** Short chip / badge text for a filter. */
export function filterChipLabels(filter: ColumnFilter): string[] {
  const op = normalizeFilterOp(filter.op)
  if (isRelativeFilterOp(op)) {
    return [FILTER_OP_LABELS[op]]
  }
  if (op === 'in') {
    return filter.values.map((v) =>
      filter.type === 'date' || filter.type === 'timestamp'
        ? periodTokenLabel(v)
        : v == null
          ? 'NULL'
          : String(v),
    )
  }
  if (filterNeedsNumber(op)) {
    const n = parseFilterNumber(filter.values[0])
    if (n == null) return [FILTER_OP_LABELS[op]]
    return [`${op === 'gt' ? '>' : '<'} ${n}`]
  }
  if (filterNeedsBounds(op)) {
    const lo = parseFilterNumber(filter.values[0])
    const hi = parseFilterNumber(filter.values[1])
    if (lo == null || hi == null) return [FILTER_OP_LABELS[op]]
    return [`${lo} … ${hi}`]
  }
  if (!filterNeedsPattern(op)) {
    return [FILTER_OP_LABELS[op]]
  }
  const patterns = filter.values
    .filter((v) => v != null && String(v).length > 0)
    .map((v) => String(v))
  if (patterns.length === 0) return [FILTER_OP_LABELS[op]]
  return patterns.map((p) => `${FILTER_OP_LABELS[op]} “${p}”`)
}

export type FacetValue = {
  value: FilterValue
  label: string
  count: number
}

export type FacetResult = {
  values: FacetValue[]
  limit: number
  offset: number
  has_more: boolean
}

export type PeriodGrain = 'year' | 'month' | 'week' | 'day' | 'hour'

export type FacetPeriodResult = {
  values: FacetValue[]
  grain: PeriodGrain
  parent: string | null
}

export function isFacetable(type: ColumnType): type is FacetableType {
  return (
    type === 'string' ||
    type === 'number' ||
    type === 'boolean' ||
    type === 'date' ||
    type === 'timestamp'
  )
}

export function filterValueKey(value: FilterValue): string {
  if (value === null) return '__null__'
  return `${typeof value}:${String(value)}`
}

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** Human label for a date/period filter token. */
export function periodTokenLabel(value: FilterValue): string {
  if (value === null) return 'NULL'
  const text = String(value)
  if (/^\d{4}$/.test(text)) return text
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    const m = Number(text.slice(5, 7))
    return `${MONTH_SHORT[m - 1]} ${text.slice(0, 4)}`
  }
  if (/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(text)) {
    return `Week ${Number(text.slice(6))} · ${text.slice(0, 4)}`
  }
  if (/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3])$/.test(text)) {
    return `${text.slice(11, 13)}:00`
  }
  return text
}
