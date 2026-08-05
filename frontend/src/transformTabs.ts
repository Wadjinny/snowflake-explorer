import {
  defaultChartConfig,
  defaultTransformLayout,
  defaultTransformName,
  makeEmptyRecipe,
  makeRecipeFromBrowse,
  normalizeChartConfig,
  normalizeRecipe,
  normalizeTransformLayout,
  type BrowseTransformSeed,
  type ChartConfig,
  type SavedTransformation,
  type TransformPanelLayout,
  type TransformRecipe,
} from './transformations'
import { normalizeColumnWidths, isColumnWidthsRecord } from './openTabs'
import {
  clampPageSize,
  getDefaultPageSize,
  PAGE_SIZE_MAX,
} from './pageSizePrefs'
import type { SelectedObject } from './types'

/** Session-only open transform (draft). URL uses `id`. */
export type OpenTransformTab = {
  id: string
  /** Linked saved bookmark, if any. */
  savedId: string | null
  name: string
  recipe: TransformRecipe
  chart: ChartConfig
  layout: TransformPanelLayout
  /** Result-table column display order (empty = result order). */
  columnOrder: string[]
  /** Result-table column widths (px). */
  columnWidths: Record<string, number>
  /** Result pager page size (session + saved). */
  pageSize: number
  /** Result pager offset (session). */
  offset: number
  dirty: boolean
}

function storageKey(connectionId: string): string {
  return `sf-explorer.transformTabs:${connectionId}`
}

function normalizePageSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return getDefaultPageSize()
  }
  return clampPageSize(value, PAGE_SIZE_MAX)
}

function isOpenTransformTab(value: unknown): value is OpenTransformTab {
  if (!value || typeof value !== 'object') return false
  const t = value as Record<string, unknown>
  const orderOk =
    t.columnOrder === undefined ||
    (Array.isArray(t.columnOrder) &&
      t.columnOrder.every((c) => typeof c === 'string'))
  const widthsOk = isColumnWidthsRecord(t.columnWidths)
  const offsetOk =
    t.offset === undefined ||
    (typeof t.offset === 'number' && Number.isFinite(t.offset) && t.offset >= 0)
  const pageSizeOk =
    t.pageSize === undefined ||
    (typeof t.pageSize === 'number' && Number.isFinite(t.pageSize))
  return (
    typeof t.id === 'string' &&
    (t.savedId === null || typeof t.savedId === 'string') &&
    typeof t.name === 'string' &&
    typeof t.recipe === 'object' &&
    t.recipe !== null &&
    typeof t.chart === 'object' &&
    t.chart !== null &&
    typeof t.dirty === 'boolean' &&
    orderOk &&
    widthsOk &&
    offsetOk &&
    pageSizeOk
  )
}

function normalizeTab(t: OpenTransformTab): OpenTransformTab {
  return {
    ...t,
    recipe: normalizeRecipe(t.recipe),
    chart: normalizeChartConfig(t.chart),
    layout: normalizeTransformLayout(
      (t as OpenTransformTab & { layout?: TransformPanelLayout }).layout,
    ),
    columnOrder: Array.isArray(t.columnOrder) ? t.columnOrder : [],
    columnWidths: normalizeColumnWidths(t.columnWidths),
    pageSize: normalizePageSize(t.pageSize),
    offset: typeof t.offset === 'number' && t.offset >= 0 ? t.offset : 0,
  }
}

export function loadTransformTabs(connectionId: string): OpenTransformTab[] {
  try {
    const raw = sessionStorage.getItem(storageKey(connectionId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isOpenTransformTab).map(normalizeTab)
  } catch {
    return []
  }
}

export function saveTransformTabs(
  connectionId: string,
  tabs: OpenTransformTab[],
): void {
  try {
    sessionStorage.setItem(storageKey(connectionId), JSON.stringify(tabs))
  } catch {
    // ignore quota
  }
}

export function makeDraftTab(
  source: SelectedObject,
  seed?: BrowseTransformSeed,
): OpenTransformTab {
  const recipe =
    seed != null ? makeRecipeFromBrowse(source, seed) : makeEmptyRecipe(source)
  return {
    id: crypto.randomUUID(),
    savedId: null,
    name: defaultTransformName(recipe),
    recipe,
    chart: defaultChartConfig(),
    layout: defaultTransformLayout(),
    columnOrder: [],
    columnWidths: {},
    pageSize: getDefaultPageSize(),
    offset: 0,
    dirty: true,
  }
}

export function makeTabFromSaved(saved: SavedTransformation): OpenTransformTab {
  return {
    id: crypto.randomUUID(),
    savedId: saved.id,
    name: saved.name,
    recipe: structuredClone(saved.recipe),
    chart: normalizeChartConfig(structuredClone(saved.chart)),
    layout: normalizeTransformLayout(saved.layout),
    columnOrder: Array.isArray(saved.columnOrder)
      ? [...saved.columnOrder]
      : [],
    columnWidths: normalizeColumnWidths(saved.columnWidths),
    pageSize: normalizePageSize(saved.pageSize),
    offset: 0,
    dirty: false,
  }
}

export function transformPath(id: string): string {
  return `/t/${encodeURIComponent(id)}`
}

/** Transform mode home (no open draft). */
export const TRANSFORM_HOME = '/t'
