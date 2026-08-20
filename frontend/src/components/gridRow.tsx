import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { formatCell } from './gridCells'
import type { GridCell, GridColumn } from './gridColumns'

type Props = {
  row: readonly GridCell[]
  rowIndex: number
  /** Absolute 1-based row number shown in the `#` column. */
  rowNumber: number
  columns: readonly GridColumn[]
  rowSelected: boolean
  /** Selected cell's column on this row; null when no cell is selected here. */
  selectedColumn: string | null
  /** Inclusive selected visible-column range on this row; -1 for none. */
  rangeFrom: number
  rangeTo: number
  onSelectCell: (rowIndex: number, column: string | null) => void
  onRangeStart: (
    rowIndex: number,
    vcol: number,
    event: ReactPointerEvent<HTMLTableRowElement>,
  ) => void
}

/** Resolve which cell an event landed in. Returns -1 for the row-number cell. */
function vcolFromEvent(
  event: ReactMouseEvent<HTMLTableRowElement> | ReactPointerEvent<HTMLTableRowElement>,
): number | null {
  const target = event.target
  const td = target instanceof Element ? target.closest('td') : null
  if (!(td instanceof HTMLElement)) return null
  if (td.dataset.rownum !== undefined) return -1
  const vcol = Number(td.dataset.vcol)
  return Number.isFinite(vcol) ? vcol : null
}

function GridRowInner({
  row,
  rowIndex,
  rowNumber,
  columns,
  rowSelected,
  selectedColumn,
  rangeFrom,
  rangeTo,
  onSelectCell,
  onRangeStart,
}: Props) {
  // Handlers live on the <tr>, not on every <td>: a 50-column page would
  // otherwise allocate two closures per cell, 100k per render.
  const handleDoubleClick = (event: ReactMouseEvent<HTMLTableRowElement>) => {
    const vcol = vcolFromEvent(event)
    if (vcol == null) return
    event.stopPropagation()
    onSelectCell(rowIndex, vcol < 0 ? null : (columns[vcol]?.name ?? null))
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLTableRowElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return
    const vcol = vcolFromEvent(event)
    if (vcol == null || vcol < 0) return
    onRangeStart(rowIndex, vcol, event)
  }

  return (
    <tr
      className={rowSelected ? 'row-selected' : undefined}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
    >
      <td
        className="cell-rownum"
        data-rownum=""
        title={`Double-click to inspect row ${rowNumber}`}
      >
        {rowNumber}
      </td>
      {columns.map((col, vcol) => {
        const cell = row[col.index]
        const text = cell == null ? null : formatCell(cell, col.type)
        let className = text == null ? col.nullClass : col.cellClass
        if (rowSelected && selectedColumn === col.name) {
          className += ' cell-selected'
        }
        if (vcol >= rangeFrom && vcol <= rangeTo) className += ' cell-range'
        return (
          <td
            key={col.name}
            style={col.style}
            className={className}
            title={text ?? 'NULL'}
            data-col={col.name}
            data-row={rowIndex}
            data-vcol={vcol}
          >
            {text ?? 'NULL'}
          </td>
        )
      })}
    </tr>
  )
}

/**
 * Memoized so unrelated renders — column hover, a scroll-position save, a
 * filter popover opening — skip every row whose own inputs are unchanged.
 * All props must therefore stay referentially stable: `columns` is memoized by
 * the parent and the callbacks are ref-backed.
 */
export const GridRow = memo(GridRowInner)
