import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  clampColumnWidth,
  DEFAULT_COLUMN_WIDTH,
  moveColumnBefore,
  resolveColumnOrder,
} from '../openTabs'
import type {
  ColumnFilter,
  ColumnInfo,
  ColumnType,
  Connection,
  PreviewResult,
  SortSpec,
} from '../types'
import { isFacetable, filterIsActive } from '../types'
import ColumnFilterPopover from './ColumnFilterPopover'
import type { GridSelection } from './DetailInspector'
import { formatCell, HeaderFilterButton } from './gridCells'

type Props = {
  data: PreviewResult
  connection: Connection
  database: string
  schema: string
  table: string
  filters: ColumnFilter[]
  onFiltersChange: (filters: ColumnFilter[]) => void
  sort: SortSpec | null
  onSortChange: (sort: SortSpec | null) => void
  hiddenColumns: string[]
  columnOrder: string[]
  onColumnOrderChange: (order: string[]) => void
  columnWidths: Record<string, number>
  onColumnWidthsChange: (widths: Record<string, number>) => void
  /** Column to highlight (e.g. hovered in the Columns picker). */
  highlightColumn?: string | null
  selection?: GridSelection | null
  onSelectionChange?: (selection: GridSelection) => void
  /** First absolute row number on this page (1-based). */
  rowOffset?: number
}

export default function DataGrid({
  data,
  connection,
  database,
  schema,
  table,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  hiddenColumns,
  columnOrder,
  onColumnOrderChange,
  columnWidths,
  onColumnWidthsChange,
  highlightColumn = null,
  selection = null,
  onSelectionChange,
  rowOffset = 1,
}: Props) {
  const [openColumn, setOpenColumn] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /** Live width while dragging a resize handle (not yet committed). */
  const [resizePreview, setResizePreview] = useState<{
    name: string
    width: number
  } | null>(null)
  const highlightRef = useRef<HTMLTableCellElement | null>(null)
  const didDrag = useRef(false)
  const resizeRef = useRef<{
    name: string
    startX: number
    startWidth: number
  } | null>(null)

  useEffect(() => {
    if (!openColumn) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      setOpenColumn(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [openColumn])

  useEffect(() => {
    return () => {
      document.body.classList.remove('col-resizing')
    }
  }, [])

  const hidden = useMemo(() => new Set(hiddenColumns), [hiddenColumns])
  const highlightIsHidden = Boolean(
    highlightColumn && hidden.has(highlightColumn),
  )

  const visible = useMemo(() => {
    const byName = new Map(
      data.columns.map((col, index) => [col.name, { col, index }] as const),
    )
    const names = resolveColumnOrder(
      data.columns.map((c) => c.name),
      columnOrder,
    )
    const cols: { col: ColumnInfo; index: number }[] = []
    for (const name of names) {
      // Include a hovered hidden column so it can be highlighted (dimmed).
      if (hidden.has(name) && name !== highlightColumn) continue
      const entry = byName.get(name)
      if (entry) cols.push(entry)
    }
    // Fallback: if everything hidden, show all in order
    if (cols.length === 0) {
      return names
        .map((name) => byName.get(name))
        .filter((e): e is { col: ColumnInfo; index: number } => Boolean(e))
    }
    return cols
  }, [data.columns, hidden, columnOrder, highlightColumn])

  /** Columns that can be focused with arrow keys (excludes hover-ghost hidden cols). */
  const navColumns = useMemo(() => {
    const names = resolveColumnOrder(
      data.columns.map((c) => c.name),
      columnOrder,
    )
    const shown = names.filter((n) => !hidden.has(n))
    return shown.length > 0 ? shown : names
  }, [data.columns, columnOrder, hidden])

  useEffect(() => {
    if (!highlightColumn) return
    const el = highlightRef.current
    if (!el) return
    el.scrollIntoView({
      behavior: 'smooth',
      inline: 'nearest',
      block: 'nearest',
    })
  }, [highlightColumn, visible])

  // Arrow-key traversal when a cell/row is selected.
  useEffect(() => {
    if (!selection || !onSelectionChange) return

    const onKey = (e: KeyboardEvent) => {
      if (openColumn) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      const { key } = e
      if (
        key !== 'ArrowLeft' &&
        key !== 'ArrowRight' &&
        key !== 'ArrowUp' &&
        key !== 'ArrowDown'
      ) {
        return
      }

      e.preventDefault()
      const maxRow = data.rows.length - 1
      if (maxRow < 0) return

      let rowIndex = selection.rowIndex
      let column = selection.column

      if (key === 'ArrowUp') {
        if (rowIndex <= 0) return
        rowIndex -= 1
      } else if (key === 'ArrowDown') {
        if (rowIndex >= maxRow) return
        rowIndex += 1
      } else if (key === 'ArrowLeft') {
        if (navColumns.length === 0) return
        if (!column) {
          column = navColumns[navColumns.length - 1] ?? null
        } else {
          const i = navColumns.indexOf(column)
          if (i <= 0) column = null
          else column = navColumns[i - 1] ?? null
        }
      } else if (key === 'ArrowRight') {
        if (navColumns.length === 0) return
        if (!column) {
          column = navColumns[0] ?? null
        } else {
          const i = navColumns.indexOf(column)
          if (i === -1) column = navColumns[0] ?? null
          else if (i < navColumns.length - 1) column = navColumns[i + 1] ?? null
          else return
        }
      }

      if (rowIndex === selection.rowIndex && column === selection.column) return
      onSelectionChange({ rowIndex, column })
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    selection,
    onSelectionChange,
    openColumn,
    data.rows.length,
    navColumns,
  ])

  // Keep the selected cell in view while traversing.
  useEffect(() => {
    if (!selection) return
    const el = selection.column
      ? document.querySelector('.data-table td.cell-selected')
      : document.querySelector('.data-table tr.row-selected td.cell-rownum')
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [selection])

  if (data.columns.length === 0) {
    return <div className="empty-hint">No columns</div>
  }

  const colFilters = (column: string) =>
    filters.filter((f) => f.column === column)
  const allNames = data.columns.map((c) => c.name)

  const applyColumnFilters = (column: string, next: ColumnFilter[]) => {
    onFiltersChange([
      ...filters.filter((f) => f.column !== column),
      ...next.filter(filterIsActive).map((f) => ({ ...f, column })),
    ])
  }

  const cycleSort = (column: string) => {
    if (didDrag.current) {
      didDrag.current = false
      return
    }
    if (sort?.column !== column) {
      onSortChange({ column, direction: 'asc' })
      return
    }
    if (sort.direction === 'asc') {
      onSortChange({ column, direction: 'desc' })
      return
    }
    onSortChange(null)
  }

  const onDragStart = (name: string, e: DragEvent) => {
    if (resizeRef.current) {
      e.preventDefault()
      return
    }
    // Popover is nested in the draggable <th>; don't treat in-popover
    // pointer moves (text select, scroll scrub) as a column reorder.
    const t = e.target
    if (t instanceof Element && t.closest('.facet-popover')) {
      e.preventDefault()
      return
    }
    didDrag.current = false
    setDragging(name)
    setOpenColumn(null)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', name)
    // Some browsers need a non-empty drag image content
    e.dataTransfer.setData('application/x-sf-col', name)
  }

  const onDragOver = (name: string, e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragging && name !== dragging) setDropTarget(name)
  }

  const onDrop = (to: string, e: DragEvent) => {
    e.preventDefault()
    const from =
      e.dataTransfer.getData('application/x-sf-col') ||
      e.dataTransfer.getData('text/plain') ||
      dragging
    if (!from || from === to) {
      setDragging(null)
      setDropTarget(null)
      return
    }
    didDrag.current = true
    onColumnOrderChange(moveColumnBefore(allNames, columnOrder, from, to))
    setDragging(null)
    setDropTarget(null)
  }

  const onDragEnd = () => {
    setDragging(null)
    setDropTarget(null)
  }

  const widthFor = (name: string): number | undefined => {
    if (resizePreview?.name === name) return resizePreview.width
    return columnWidths[name]
  }

  const colStyle = (name: string): CSSProperties | undefined => {
    const w = widthFor(name)
    if (w == null) return undefined
    return { width: w, minWidth: w, maxWidth: w }
  }

  const onResizePointerDown = (
    name: string,
    e: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setOpenColumn(null)
    const th = (e.currentTarget.parentElement as HTMLElement | null)
    const startWidth =
      columnWidths[name] ??
      th?.getBoundingClientRect().width ??
      DEFAULT_COLUMN_WIDTH
    resizeRef.current = {
      name,
      startX: e.clientX,
      startWidth,
    }
    setResizePreview({ name, width: clampColumnWidth(startWidth) })
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.classList.add('col-resizing')
  }

  const onResizePointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const state = resizeRef.current
    if (!state) return
    const next = clampColumnWidth(state.startWidth + (e.clientX - state.startX))
    setResizePreview({ name: state.name, width: next })
  }

  const endResize = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const state = resizeRef.current
    if (!state) return
    const next = clampColumnWidth(state.startWidth + (e.clientX - state.startX))
    resizeRef.current = null
    setResizePreview(null)
    document.body.classList.remove('col-resizing')
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    onColumnWidthsChange({ ...columnWidths, [state.name]: next })
  }

  const resetColumnWidth = (name: string) => {
    const next = { ...columnWidths }
    delete next[name]
    onColumnWidthsChange(next)
  }

  return (
    <div className="data-grid-wrap" onClick={() => setOpenColumn(null)}>
      <table className="data-table">
        <thead>
          <tr>
            <th className="th-cell th-rownum" title="Row">
              #
            </th>
            {visible.map(({ col }) => {
              const appliedFilters = colFilters(col.name)
              const active = appliedFilters.some(filterIsActive)
              const isOpen = openColumn === col.name
              const canFilter = isFacetable(col.type)
              const sortDir =
                sort?.column === col.name ? sort.direction : null
              const highlighted = highlightColumn === col.name
              const dimmed = highlighted && highlightIsHidden
              const isDragging = dragging === col.name
              const isDropTarget = dropTarget === col.name && !isDragging
              const resized = widthFor(col.name) != null
              return (
                <th
                  key={col.name}
                  ref={(node) => {
                    if (highlighted) highlightRef.current = node
                  }}
                  style={colStyle(col.name)}
                  title={
                    dimmed
                      ? `${col.type} — hidden (hover preview)`
                      : `${col.type} — drag to reorder · drag edge to resize`
                  }
                  draggable={!dimmed && !resizePreview && !isOpen}
                  onDragStart={(e) => onDragStart(col.name, e)}
                  onDragOver={(e) => onDragOver(col.name, e)}
                  onDragLeave={() =>
                    setDropTarget((t) => (t === col.name ? null : t))
                  }
                  onDrop={(e) => onDrop(col.name, e)}
                  onDragEnd={onDragEnd}
                  className={`th-cell${highlighted ? ' col-highlight' : ''}${dimmed ? ' col-highlight-dim' : ''}${isDragging ? ' col-dragging' : ''}${isDropTarget ? ' col-drop-target' : ''}${resized ? ' col-resized' : ''}`}
                  data-col={col.name}
                >
                  <div className="th-top">
                    <button
                      type="button"
                      className={`th-sort-btn${sortDir ? ' active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        cycleSort(col.name)
                      }}
                      title={
                        sortDir === 'asc'
                          ? 'Sorted ascending — click for descending'
                          : sortDir === 'desc'
                            ? 'Sorted descending — click to clear'
                            : 'Sort ascending'
                      }
                    >
                      <span className="th-name">{col.name}</span>
                      <span className="th-sort-indicator" aria-hidden>
                        {sortDir === 'asc'
                          ? '▲'
                          : sortDir === 'desc'
                            ? '▼'
                            : '⇅'}
                      </span>
                    </button>
                    {canFilter ? (
                      <HeaderFilterButton
                        active={active}
                        open={isOpen}
                        onToggle={() =>
                          setOpenColumn((c) =>
                            c === col.name ? null : col.name,
                          )
                        }
                      />
                    ) : null}
                  </div>
                  <span className={`th-type type-${col.type}`}>{col.type}</span>
                  {isOpen && isFacetable(col.type) ? (
                    <ColumnFilterPopover
                      connection={connection}
                      database={database}
                      schema={schema}
                      table={table}
                      column={col.name}
                      type={col.type}
                      appliedFilters={appliedFilters}
                      filters={filters}
                      onApply={(next) => applyColumnFilters(col.name, next)}
                      onClose={() => setOpenColumn(null)}
                    />
                  ) : null}
                  {!dimmed ? (
                    <span
                      className={`col-resize-handle${
                        resizePreview?.name === col.name ? ' active' : ''
                      }`}
                      onPointerDown={(e) => onResizePointerDown(col.name, e)}
                      onPointerMove={onResizePointerMove}
                      onPointerUp={endResize}
                      onPointerCancel={endResize}
                      onDoubleClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        resetColumnWidth(col.name)
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="col-resize-tip" aria-hidden>
                        Drag to resize · double-click to reset
                      </span>
                      {resizePreview?.name === col.name ? (
                        <span className="col-resize-width">
                          {Math.round(resizePreview.width)}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 ? (
            <tr>
              <td
                colSpan={visible.length + 1}
                style={{ color: 'var(--text-ghost)' }}
              >
                No rows
              </td>
            </tr>
          ) : (
            data.rows.map((row, i) => {
              const rowSelected = selection?.rowIndex === i
              return (
                <tr
                  key={i}
                  className={rowSelected ? 'row-selected' : undefined}
                >
                  <td
                    className="cell-rownum"
                    title={`Double-click to inspect row ${rowOffset + i}`}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      setOpenColumn(null)
                      onSelectionChange?.({ rowIndex: i, column: null })
                    }}
                  >
                    {rowOffset + i}
                  </td>
                  {visible.map(({ col, index }) => {
                    const cell = row[index]
                    const colType: ColumnType = col.type
                    const isNull = cell == null
                    const highlighted = highlightColumn === col.name
                    const dimmed = highlighted && highlightIsHidden
                    const cellSelected =
                      rowSelected && selection?.column === col.name
                    return (
                      <td
                        key={col.name}
                        style={colStyle(col.name)}
                        className={`${
                          isNull ? 'cell-null' : `cell-type type-${colType}`
                        }${highlighted ? ' col-highlight' : ''}${dimmed ? ' col-highlight-dim' : ''}${cellSelected ? ' cell-selected' : ''}${widthFor(col.name) != null ? ' col-resized' : ''}`}
                        title={isNull ? 'NULL' : String(cell)}
                        data-col={col.name}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          setOpenColumn(null)
                          onSelectionChange?.({
                            rowIndex: i,
                            column: col.name,
                          })
                        }}
                      >
                        {isNull ? 'NULL' : formatCell(cell, colType)}
                      </td>
                    )
                  })}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
