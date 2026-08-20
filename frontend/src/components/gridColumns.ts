import type { CSSProperties } from 'react'
import type { ColumnType } from '../types'

export type GridCell = string | number | boolean | null

/**
 * One rendered column, with everything that does not vary per row resolved
 * once. Both grids render pages of up to 1000 rows, so per-cell work is
 * multiplied by the column count — keep it to a lookup and at most one string
 * concat.
 */
export type GridColumn = {
  name: string
  type: ColumnType
  /** Index into the raw row tuple (source order, not display order). */
  index: number
  /** Shared style object; identity is stable while widths are unchanged. */
  style: CSSProperties | undefined
  /** className for a non-null cell in this column. */
  cellClass: string
  /** className for a NULL cell in this column. */
  nullClass: string
}

/** Build a column's cell classNames for its current highlight/resize state. */
export function gridCellClasses(
  type: ColumnType,
  state: { highlighted?: boolean; dimmed?: boolean; resized?: boolean },
): { cellClass: string; nullClass: string } {
  let shared = ''
  if (state.highlighted) shared += ' col-highlight'
  if (state.dimmed) shared += ' col-highlight-dim'
  if (state.resized) shared += ' col-resized'
  return {
    cellClass: `cell-type type-${type}${shared}`,
    nullClass: `cell-null${shared}`,
  }
}

/** Pixel-width style for a column, or undefined when it auto-sizes. */
export function columnWidthStyle(
  width: number | undefined,
): CSSProperties | undefined {
  if (width == null) return undefined
  return { width, minWidth: width, maxWidth: width }
}
