import type {
  ColumnFilter,
  FilterValue,
  ObjectKind,
  SelectedObject,
  SortSpec,
} from './types'
import {
  isColumnWidthsRecord,
  normalizeColumnWidths,
} from './openTabs'
import { clampPageSize, getDefaultPageSize, PAGE_SIZE_MAX } from './pageSizePrefs'

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
  /** One or more Y metrics (bar/line/area); single-value types use y[0]. */
  y: string[]
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

export type TransformStepId =
  | 'joins'
  | 'columns'
  | 'filters'
  | 'aggregate'
  | 'pivot'
  | 'order'

export const TRANSFORM_STEP_IDS: TransformStepId[] = [
  'joins',
  'columns',
  'filters',
  'aggregate',
  'pivot',
  'order',
]

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
  /** Steps present in the builder but skipped when running. */
  disabledSteps: TransformStepId[]
}

export type SavedTransformation = {
  id: string
  name: string
  recipe: TransformRecipe
  chart: ChartConfig
  layout: TransformPanelLayout
  /** Result-table column display order (empty = schema/result order). */
  columnOrder: string[]
  /** Result-table column widths (px). */
  columnWidths: Record<string, number>
  /** Result pager page size. */
  pageSize: number
  createdAt: number
}

export const MAX_JOINS = 5

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
      f.type === 'boolean' ||
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
  const yOk =
    c.y === null ||
    typeof c.y === 'string' ||
    (Array.isArray(c.y) && c.y.every((n) => typeof n === 'string'))
  return (
    isChartType(c.type) &&
    (c.x === null || typeof c.x === 'string') &&
    yOk &&
    (c.series === null || typeof c.series === 'string')
  )
}

/** Normalize legacy `y: string | null` to `y: string[]`. */
export function normalizeChartConfig(chart: ChartConfig): ChartConfig {
  const rawY = (chart as { y?: unknown }).y
  let y: string[]
  if (Array.isArray(rawY)) {
    y = rawY.filter(
      (n): n is string => typeof n === 'string' && n.length > 0,
    )
  } else if (typeof rawY === 'string' && rawY.length > 0) {
    y = [rawY]
  } else {
    y = []
  }
  return {
    type: chart.type,
    x: chart.x,
    y,
    series: chart.series,
  }
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

function isTransformStepId(value: unknown): value is TransformStepId {
  return (
    typeof value === 'string' &&
    (TRANSFORM_STEP_IDS as string[]).includes(value)
  )
}

function normalizeDisabledSteps(value: unknown): TransformStepId[] {
  if (!Array.isArray(value)) return []
  return value.filter(isTransformStepId)
}

function isTransformRecipe(value: unknown): value is TransformRecipe {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  const disabledOk =
    r.disabledSteps === undefined ||
    (Array.isArray(r.disabledSteps) &&
      r.disabledSteps.every((s) => typeof s === 'string'))
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
    disabledOk
  )
}

function isSavedTransformation(value: unknown): value is SavedTransformation {
  if (!value || typeof value !== 'object') return false
  const t = value as Record<string, unknown>
  const orderOk =
    t.columnOrder === undefined ||
    (Array.isArray(t.columnOrder) &&
      t.columnOrder.every((c) => typeof c === 'string'))
  const widthsOk = isColumnWidthsRecord(t.columnWidths)
  const pageSizeOk =
    t.pageSize === undefined ||
    (typeof t.pageSize === 'number' && Number.isFinite(t.pageSize))
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    isTransformRecipe(t.recipe) &&
    isChartConfig(t.chart) &&
    (t.layout === undefined || isTransformPanelLayout(t.layout)) &&
    orderOk &&
    widthsOk &&
    pageSizeOk &&
    typeof t.createdAt === 'number'
  )
}

export function defaultChartConfig(): ChartConfig {
  return { type: 'bar', x: null, y: [], series: null }
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
    disabledSteps: [],
  }
}

/** Drop legacy fields and normalize disabledSteps. */
export function normalizeRecipe(recipe: TransformRecipe): TransformRecipe {
  const { limit: _legacy, ...rest } = recipe as TransformRecipe & {
    limit?: number
  }
  return {
    ...rest,
    disabledSteps: normalizeDisabledSteps(rest.disabledSteps),
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
  columnOrder?: string[]
  columnWidths?: Record<string, number>
  pageSize?: number
}): SavedTransformation {
  const pageSize =
    typeof input.pageSize === 'number' && Number.isFinite(input.pageSize)
      ? clampPageSize(input.pageSize, PAGE_SIZE_MAX)
      : getDefaultPageSize()
  return {
    id: crypto.randomUUID(),
    name: input.name?.trim() || defaultTransformName(input.recipe),
    recipe: input.recipe,
    chart: normalizeChartConfig(input.chart ?? defaultChartConfig()),
    layout: normalizeTransformLayout(input.layout),
    columnOrder: Array.isArray(input.columnOrder) ? [...input.columnOrder] : [],
    columnWidths: normalizeColumnWidths(input.columnWidths),
    pageSize,
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

function isCompleteJoinOn(cond: {
  leftColumn: string
  rightColumn: string
}): boolean {
  return Boolean(cond.leftColumn.trim() && cond.rightColumn.trim())
}

/**
 * Drop unfinished joins / ON clauses before sending a recipe to the API.
 * Pydantic rejects empty join column strings; the builder keeps draft rows in UI.
 * Disabled steps are omitted from the payload when `applyDisabled` is true (default).
 */
export function prepareRecipeForApi(
  recipe: TransformRecipe,
  opts: { requireJoinOn?: boolean; applyDisabled?: boolean } = {},
): TransformRecipe {
  const requireJoinOn = opts.requireJoinOn ?? false
  const applyDisabled = opts.applyDisabled ?? true
  const disabled = new Set(
    applyDisabled ? normalizeDisabledSteps(recipe.disabledSteps) : [],
  )

  const joins = disabled.has('joins')
    ? []
    : recipe.joins
        .filter((j) => j.target.name.trim())
        .map((j) => ({
          ...j,
          on: j.on.filter(isCompleteJoinOn),
        }))
        .filter((j) => !requireJoinOn || j.on.length > 0)

  if (requireJoinOn && !disabled.has('joins')) {
    const incomplete = recipe.joins.filter(
      (j) =>
        j.target.name.trim() &&
        j.on.filter(isCompleteJoinOn).length === 0,
    )
    if (incomplete.length > 0) {
      const aliases = incomplete.map((j) => j.alias).join(', ')
      throw new Error(
        `Join ${aliases}: pick both ON columns before running`,
      )
    }
  }

  return {
    source: recipe.source,
    sourceAlias: recipe.sourceAlias,
    joins,
    filters: disabled.has('filters') ? [] : recipe.filters,
    columns: disabled.has('columns') ? [] : recipe.columns,
    groupBy: disabled.has('aggregate') ? [] : recipe.groupBy,
    aggregations: disabled.has('aggregate') ? [] : recipe.aggregations,
    pivot: disabled.has('pivot') ? null : recipe.pivot,
    sort: disabled.has('order') ? null : recipe.sort,
    disabledSteps: [],
  }
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
      recipe: normalizeRecipe(t.recipe),
      chart: normalizeChartConfig(t.chart),
      layout: normalizeTransformLayout(
        (t as SavedTransformation & { layout?: TransformPanelLayout }).layout,
      ),
      columnOrder: Array.isArray(t.columnOrder) ? t.columnOrder : [],
      columnWidths: normalizeColumnWidths(t.columnWidths),
      pageSize:
        typeof t.pageSize === 'number' && Number.isFinite(t.pageSize)
          ? clampPageSize(t.pageSize, PAGE_SIZE_MAX)
          : getDefaultPageSize(),
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
