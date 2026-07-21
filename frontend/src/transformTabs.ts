import {
  defaultChartConfig,
  defaultTransformLayout,
  defaultTransformName,
  makeEmptyRecipe,
  normalizeTransformLayout,
  type ChartConfig,
  type SavedTransformation,
  type TransformPanelLayout,
  type TransformRecipe,
} from './transformations'
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
  dirty: boolean
}

function storageKey(connectionId: string): string {
  return `sf-explorer.transformTabs:${connectionId}`
}

function isOpenTransformTab(value: unknown): value is OpenTransformTab {
  if (!value || typeof value !== 'object') return false
  const t = value as Record<string, unknown>
  return (
    typeof t.id === 'string' &&
    (t.savedId === null || typeof t.savedId === 'string') &&
    typeof t.name === 'string' &&
    typeof t.recipe === 'object' &&
    t.recipe !== null &&
    typeof t.chart === 'object' &&
    t.chart !== null &&
    typeof t.dirty === 'boolean'
  )
}

export function loadTransformTabs(connectionId: string): OpenTransformTab[] {
  try {
    const raw = sessionStorage.getItem(storageKey(connectionId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isOpenTransformTab).map((t) => ({
      ...t,
      layout: normalizeTransformLayout(
        (t as OpenTransformTab & { layout?: TransformPanelLayout }).layout,
      ),
    }))
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

export function makeDraftTab(source: SelectedObject): OpenTransformTab {
  const recipe = makeEmptyRecipe(source)
  return {
    id: crypto.randomUUID(),
    savedId: null,
    name: defaultTransformName(recipe),
    recipe,
    chart: defaultChartConfig(),
    layout: defaultTransformLayout(),
    dirty: true,
  }
}

export function makeTabFromSaved(saved: SavedTransformation): OpenTransformTab {
  return {
    id: crypto.randomUUID(),
    savedId: saved.id,
    name: saved.name,
    recipe: structuredClone(saved.recipe),
    chart: structuredClone(saved.chart),
    layout: normalizeTransformLayout(saved.layout),
    dirty: false,
  }
}

export function transformPath(id: string): string {
  return `/t/${encodeURIComponent(id)}`
}

/** Transform mode home (no open draft). */
export const TRANSFORM_HOME = '/t'
