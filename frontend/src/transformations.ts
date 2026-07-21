import type {
  ColumnFilter,
  FilterValue,
  ObjectKind,
  SelectedObject,
  SortSpec,
} from './types'

export type JoinType = 'inner' | 'left' | 'right' | 'full'

export type JoinOn = {
  leftAlias: string
  leftColumn: string
  rightAlias: string
  rightColumn: string
}

export type TransformJoin = {
  id: string
  type: JoinType
  target: SelectedObject
  alias: string
  on: JoinOn[]
}

export type AggFn = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max'

export type Aggregation = {
  id: string
  fn: AggFn
  /** Null = COUNT(*). Otherwise `alias.column`. */
  column: string | null
  alias: string
}

export type PivotSpec = {
  rowKeys: string[]
  pivotColumn: string
  valueColumn: string
  agg: AggFn
}

/** Selected output column: `alias.column`, optional rename. */
export type RecipeColumn = {
  ref: string
  as?: string
}

export type ChartType =
  | 'bar'
  | 'line'
  | 'area'
  | 'scatter'
  | 'pie'
  | 'heatmap'

export type ChartConfig = {
  type: ChartType
  x: string | null
  y: string | null
  series: string | null
}

/** Panel id → size percent (0..100) for a react-resizable-panels Group. */
export type PanelLayoutMap = Record<string, number>

/** Layout of the transform workspace groups. */
export type TransformPanelLayout = {
  /** objects | transform-main */
  objects: PanelLayoutMap
  /** builder | results */
  steps: PanelLayoutMap
  /** table | chart */
  results: PanelLayoutMap
}

export type TransformRecipe = {
  source: SelectedObject
  sourceAlias: string
  joins: TransformJoin[]
  filters: ColumnFilter[]
  /** Empty = all columns from joined sources (when no aggregations). */
  columns: RecipeColumn[]
  groupBy: string[]
  aggregations: Aggregation[]
  pivot: PivotSpec | null
  sort: SortSpec | null
  limit: number
}

export type SavedTransformation = {
  id: string
  name: string
  recipe: TransformRecipe
  chart: ChartConfig
  layout: TransformPanelLayout
  createdAt: number
}

export const MAX_JOINS = 5
export const DEFAULT_TRANSFORM_LIMIT = 500
export const MAX_TRANSFORM_LIMIT = 5000

function storageKey(connectionId: string): string {
  return `sf-explorer.transformations:${connectionId}`
}

function isObjectKind(value: unknown): value is ObjectKind {
  return value === 'table' || value === 'view'
}

function isSelectedObject(value: unknown): value is SelectedObject {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return (
    typeof o.database === 'string' &&
    typeof o.schema === 'string' &&
    typeof o.name === 'string' &&
    isObjectKind(o.kind)
  )
}

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
  return (
    typeof f.column === 'string' &&
    (f.type === 'string' ||
      f.type === 'number' ||
      f.type === 'date' ||
      f.type === 'timestamp') &&
    Array.isArray(f.values) &&
    f.values.every(isFilterValue)
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

function isJoinType(value: unknown): value is JoinType {
  return (
    value === 'inner' ||
    value === 'left' ||
    value === 'right' ||
    value === 'full'
  )
}

function isAggFn(value: unknown): value is AggFn {
  return (
    value === 'count' ||
    value === 'count_distinct' ||
    value === 'sum' ||
    value === 'avg' ||
    value === 'min' ||
    value === 'max'
  )
}

function isJoinOn(value: unknown): value is JoinOn {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return (
    typeof o.leftAlias === 'string' &&
    typeof o.leftColumn === 'string' &&
    typeof o.rightAlias === 'string' &&
    typeof o.rightColumn === 'string'
  )
}

function isTransformJoin(value: unknown): value is TransformJoin {
  if (!value || typeof value !== 'object') return false
  const j = value as Record<string, unknown>
  return (
    typeof j.id === 'string' &&
    isJoinType(j.type) &&
    isSelectedObject(j.target) &&
    typeof j.alias === 'string' &&
    Array.isArray(j.on) &&
    j.on.every(isJoinOn)
  )
}

function isRecipeColumn(value: unknown): value is RecipeColumn {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return (
    typeof c.ref === 'string' &&
    (c.as === undefined || typeof c.as === 'string')
  )
}

function isAggregation(value: unknown): value is Aggregation {
  if (!value || typeof value !== 'object') return false
  const a = value as Record<string, unknown>
  return (
    typeof a.id === 'string' &&
    isAggFn(a.fn) &&
    (a.column === null || typeof a.column === 'string') &&
    typeof a.alias === 'string'
  )
}

function isPivotSpec(value: unknown): value is PivotSpec | null {
  if (value === null) return true
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    Array.isArray(p.rowKeys) &&
    p.rowKeys.every((k) => typeof k === 'string') &&
    typeof p.pivotColumn === 'string' &&
    typeof p.valueColumn === 'string' &&
    isAggFn(p.agg)
  )
}

function isChartType(value: unknown): value is ChartType {
  return (
    value === 'bar' ||
    value === 'line' ||
    value === 'area' ||
    value === 'scatter' ||
    value === 'pie' ||
    value === 'heatmap'
  )
}

function isChartConfig(value: unknown): value is ChartConfig {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return (
    isChartType(c.type) &&
    (c.x === null || typeof c.x === 'string') &&
    (c.y === null || typeof c.y === 'string') &&
    (c.series === null || typeof c.series === 'string')
  )
}

function isPanelLayoutMap(value: unknown): value is PanelLayoutMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return false
  return entries.every(
    ([k, v]) => typeof k === 'string' && typeof v === 'number' && Number.isFinite(v),
  )
}

function isTransformPanelLayout(value: unknown): value is TransformPanelLayout {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return (
    isPanelLayoutMap(o.objects) &&
    isPanelLayoutMap(o.steps) &&
    isPanelLayoutMap(o.results)
  )
}

function isTransformRecipe(value: unknown): value is TransformRecipe {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return (
    isSelectedObject(r.source) &&
    typeof r.sourceAlias === 'string' &&
    Array.isArray(r.joins) &&
    r.joins.every(isTransformJoin) &&
    Array.isArray(r.filters) &&
    r.filters.every(isColumnFilter) &&
    Array.isArray(r.columns) &&
    r.columns.every(isRecipeColumn) &&
    Array.isArray(r.groupBy) &&
    r.groupBy.every((g) => typeof g === 'string') &&
    Array.isArray(r.aggregations) &&
    r.aggregations.every(isAggregation) &&
    isPivotSpec(r.pivot) &&
    isSortSpec(r.sort) &&
    typeof r.limit === 'number'
  )
}

function isSavedTransformation(value: unknown): value is SavedTransformation {
  if (!value || typeof value !== 'object') return false
  const t = value as Record<string, unknown>
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    isTransformRecipe(t.recipe) &&
    isChartConfig(t.chart) &&
    (t.layout === undefined || isTransformPanelLayout(t.layout)) &&
    typeof t.createdAt === 'number'
  )
}

export function defaultChartConfig(): ChartConfig {
  return { type: 'bar', x: null, y: null, series: null }
}

export function defaultTransformLayout(): TransformPanelLayout {
  return {
    objects: { objects: 22, 'transform-main': 78 },
    steps: { builder: 28, results: 72 },
    results: { table: 55, chart: 45 },
  }
}

export function normalizeTransformLayout(
  value: TransformPanelLayout | undefined | null,
): TransformPanelLayout {
  const fallback = defaultTransformLayout()
  if (!value) return fallback
  return {
    objects: { ...fallback.objects, ...value.objects },
    steps: { ...fallback.steps, ...value.steps },
    results: { ...fallback.results, ...value.results },
  }
}

export function makeEmptyRecipe(source: SelectedObject): TransformRecipe {
  return {
    source,
    sourceAlias: 't0',
    joins: [],
    filters: [],
    columns: [],
    groupBy: [],
    aggregations: [],
    pivot: null,
    sort: null,
    limit: DEFAULT_TRANSFORM_LIMIT,
  }
}

export function defaultTransformName(recipe: TransformRecipe): string {
  const parts = [recipe.source.name]
  if (recipe.joins.length > 0) {
    parts.push(
      `${recipe.joins.length} join${recipe.joins.length === 1 ? '' : 's'}`,
    )
  }
  if (recipe.aggregations.length > 0) parts.push('agg')
  if (recipe.pivot) parts.push('pivot')
  return parts.join(' · ')
}

export function makeTransformation(input: {
  name?: string
  recipe: TransformRecipe
  chart?: ChartConfig
  layout?: TransformPanelLayout
}): SavedTransformation {
  return {
    id: crypto.randomUUID(),
    name: input.name?.trim() || defaultTransformName(input.recipe),
    recipe: input.recipe,
    chart: input.chart ?? defaultChartConfig(),
    layout: normalizeTransformLayout(input.layout),
    createdAt: Date.now(),
  }
}

export function nextJoinAlias(recipe: TransformRecipe): string {
  return `t${recipe.joins.length + 1}`
}

export function allAliases(recipe: TransformRecipe): string[] {
  return [recipe.sourceAlias, ...recipe.joins.map((j) => j.alias)]
}

/** Parse `alias.column` or bare `column` (assumes t0). */
export function parseColumnRef(
  ref: string,
  defaultAlias = 't0',
): { alias: string; column: string } {
  const i = ref.indexOf('.')
  if (i <= 0) return { alias: defaultAlias, column: ref }
  return { alias: ref.slice(0, i), column: ref.slice(i + 1) }
}

export function formatColumnRef(alias: string, column: string): string {
  return `${alias}.${column}`
}

export function loadTransformations(
  connectionId: string,
): SavedTransformation[] {
  try {
    const raw = localStorage.getItem(storageKey(connectionId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSavedTransformation).map((t) => ({
      ...t,
      layout: normalizeTransformLayout(
        (t as SavedTransformation & { layout?: TransformPanelLayout }).layout,
      ),
    }))
  } catch {
    return []
  }
}

export function saveTransformations(
  connectionId: string,
  items: SavedTransformation[],
): void {
  try {
    localStorage.setItem(storageKey(connectionId), JSON.stringify(items))
  } catch {
    // ignore quota errors
  }
}
