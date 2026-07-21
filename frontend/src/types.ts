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

export type ObjectKind = 'table' | 'view'

export type ObjectItem = {
  name: string
  kind: ObjectKind
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

export type FacetableType = 'string' | 'number' | 'date' | 'timestamp'

export type ColumnInfo = {
  name: string
  type: ColumnType
}

export type SortDirection = 'asc' | 'desc'

export type SortSpec = {
  column: string
  direction: SortDirection
}

export type PreviewResult = {
  columns: ColumnInfo[]
  rows: (string | number | boolean | null)[][]
  total: number
}

export type SelectedObject = {
  database: string
  schema: string
  name: string
  kind: ObjectKind
}

export type FilterValue = string | number | boolean | null

export type ColumnFilter = {
  column: string
  type: FacetableType
  values: FilterValue[]
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

export function isFacetable(type: ColumnType): type is FacetableType {
  return (
    type === 'string' ||
    type === 'number' ||
    type === 'date' ||
    type === 'timestamp'
  )
}

export function filterValueKey(value: FilterValue): string {
  if (value === null) return '__null__'
  return `${typeof value}:${String(value)}`
}
