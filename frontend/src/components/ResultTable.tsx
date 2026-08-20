import {
  useCallback,
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
} from '../types'
import { isFacetable, filterIsActive } from '../types'
import {
  parseColumnRef,
  type TransformRecipe,
} from '../transformations'
import {
  facetTargetFromRecipe,
  findProbeColumn,
  tableFiltersForTarget,
} from '../facetTarget'
import ColumnFilterPopover from './ColumnFilterPopover'
import type { GridSelection } from './DetailInspector'
import { formatCell, HeaderFilterButton } from './gridCells'
import {
  columnWidthStyle,
  gridCellClasses,
  type GridColumn,
} from './gridColumns'
import { GridRow } from './gridRow'

type Props = {
  data: PreviewResult
  connection: Connection
  recipe: TransformRecipe
  /** Qualified columns from transform column probe (`t0.col`). */
  probeColumns: ColumnInfo[]
  onFiltersChange: (filters: ColumnFilter[]) => void
  columnOrder?: string[]
  onColumnOrderChange?: (order: string[]) => void
  columnWidths?: Record<string, number>
  onColumnWidthsChange?: (widths: Record<string, number>) => void
  /** Probe/result column ref hovered in the Columns step. */
  highlightColumn?: string | null
  selection?: GridSelection | null
  onSelectionChange?: (selection: GridSelection) => void
  /** First absolute row number on this page (1-based). */
  rowOffset?: number
}

type CellPos = { row: number; col: number }

type CellRange = {
  anchor: CellPos
  focus: CellPos
}

function normalizeRange(range: CellRange): {
  r0: number
  r1: number
  c0: number
  c1: number
} {
  return {
    r0: Math.min(range.anchor.row, range.focus.row),
    r1: Math.max(range.anchor.row, range.focus.row),
    c0: Math.min(range.anchor.col, range.focus.col),
    c1: Math.max(range.anchor.col, range.focus.col),
  }
}

function tsvEscape(value: string): string {
  if (/[\t\n\r"]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function copyValue(
  cell: string | number | boolean | null,
  type: ColumnType,
): string {
  if (cell == null) return ''
  return formatCell(cell, type)
}

export default function ResultTable({
  data,
  connection,
  recipe,
  probeColumns,
  onFiltersChange,
  columnOrder = [],
  onColumnOrderChange,
  columnWidths = {},
  onColumnWidthsChange,
  highlightColumn = null,
  selection = null,
  onSelectionChange,
  rowOffset = 1,
}: Props) {
  const [openColumn, setOpenColumn] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [resizePreview, setResizePreview] = useState<{
    name: string
    width: number
  } | null>(null)
  const [cellRange, setCellRange] = useState<CellRange | null>(null)
  const highlightRef = useRef<HTMLTableCellElement | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const rangeDragging = useRef(false)
  const rangeModeRef = useRef<'cells' | 'columns'>('cells')
  const cellRangeRef = useRef<CellRange | null>(null)
  cellRangeRef.current = cellRange
  const resizeRef = useRef<{
    name: string
    startX: number
    startWidth: number
  } | null>(null)

  const filterMap = useMemo(() => {
    const map = new Map<string, ColumnFilter[]>()
    for (const f of recipe.filters) {
      const list = map.get(f.column)
      if (list) list.push(f)
      else map.set(f.column, [f])
    }
    return map
  }, [recipe.filters])

  const allNames = useMemo(
    () => data.columns.map((c) => c.name),
    [data.columns],
  )

  const visible = useMemo(() => {
    const byName = new Map(
      data.columns.map((col, index) => [col.name, { col, index }] as const),
    )
    const names = resolveColumnOrder(allNames, columnOrder)
    return names
      .map((name) => byName.get(name))
      .filter((e): e is { col: ColumnInfo; index: number } => Boolean(e))
  }, [data.columns, allNames, columnOrder])

  const navColumns = useMemo(
    () => visible.map(({ col }) => col.name),
    [visible],
  )

  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const dataRef = useRef(data)
  dataRef.current = data
  // Ref-backed so the row callbacks below can stay referentially stable even
  // though the parent passes a fresh closure on every render.
  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange

  const lastRowIndex = Math.max(0, data.rows.length - 1)

  /**
   * Which result column the Columns step is hovering, resolved once. Matching
   * per cell would re-scan `probeColumns` for every cell on the page.
   */
  const highlightedColumn = useMemo(() => {
    if (!highlightColumn) return null
    const match = visible.find(({ col }) =>
      columnMatchesHighlight(col.name, highlightColumn, recipe, probeColumns),
    )
    return match?.col.name ?? null
  }, [highlightColumn, visible, recipe, probeColumns])

  /** Per-column cell data, resolved once instead of once per cell. */
  const gridColumns = useMemo<GridColumn[]>(
    () =>
      visible.map(({ col, index }) => {
        const width =
          resizePreview?.name === col.name
            ? resizePreview.width
            : columnWidths[col.name]
        return {
          name: col.name,
          type: col.type,
          index,
          style: columnWidthStyle(width),
          ...gridCellClasses(col.type, {
            highlighted: highlightedColumn === col.name,
            resized: width != null,
          }),
        }
      }),
    [visible, columnWidths, resizePreview, highlightedColumn],
  )

  useEffect(() => {
    setCellRange(null)
  }, [data.rows, data.columns])

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
    if (!highlightColumn) return
    const el = highlightRef.current
    if (!el) return
    el.scrollIntoView({
      behavior: 'smooth',
      inline: 'nearest',
      block: 'nearest',
    })
  }, [highlightColumn, visible])

  useEffect(() => {
    return () => {
      document.body.classList.remove('col-resizing')
      document.body.classList.remove('cell-range-selecting')
    }
  }, [])

  const posFromPoint = useCallback(
    (clientX: number, clientY: number): CellPos | null => {
      const el = document.elementFromPoint(clientX, clientY)
      const td =
        el instanceof Element ? el.closest('td[data-row][data-vcol]') : null
      if (!(td instanceof HTMLElement)) return null
      if (!wrapRef.current?.contains(td)) return null
      const row = Number(td.dataset.row)
      const col = Number(td.dataset.vcol)
      if (!Number.isFinite(row) || !Number.isFinite(col)) return null
      return { row, col }
    },
    [],
  )

  const vcolFromPoint = (clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY)
    if (!(el instanceof Element) || !wrapRef.current?.contains(el)) return null
    const cell = el.closest('[data-vcol]')
    if (!(cell instanceof HTMLElement)) return null
    const col = Number(cell.dataset.vcol)
    return Number.isFinite(col) ? col : null
  }

  const attachRangeListeners = useCallback(
    (onMove: (ev: PointerEvent) => void) => {
      const onUp = () => {
        rangeDragging.current = false
        document.body.classList.remove('cell-range-selecting')
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [],
  )

  const onRangeStart = useCallback(
    (rowIndex: number, vcol: number, e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setOpenColumn(null)
      rangeModeRef.current = 'cells'
      rangeDragging.current = true
      const pos: CellPos = { row: rowIndex, col: vcol }
      const next = { anchor: pos, focus: pos }
      cellRangeRef.current = next
      setCellRange(next)
      document.body.classList.add('cell-range-selecting')

      attachRangeListeners((ev) => {
        if (!rangeDragging.current) return
        const at = posFromPoint(ev.clientX, ev.clientY)
        if (!at) return
        const prev = cellRangeRef.current
        if (!prev) return
        if (prev.focus.row === at.row && prev.focus.col === at.col) return
        const updated = { anchor: prev.anchor, focus: at }
        cellRangeRef.current = updated
        setCellRange(updated)
      })
    },
    [attachRangeListeners, posFromPoint],
  )

  const onSelectCell = useCallback(
    (rowIndex: number, column: string | null) => {
      setOpenColumn(null)
      setCellRange(null)
      onSelectionChangeRef.current?.({ rowIndex, column })
    },
    [],
  )

  const beginColumnSelect = (
    vcol: number,
    e: ReactPointerEvent<HTMLTableCellElement>,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setOpenColumn(null)
    rangeModeRef.current = 'columns'
    rangeDragging.current = true
    const last = Math.max(0, dataRef.current.rows.length - 1)
    const next: CellRange = {
      anchor: { row: 0, col: vcol },
      focus: { row: last, col: vcol },
    }
    cellRangeRef.current = next
    setCellRange(next)
    document.body.classList.add('cell-range-selecting')

    attachRangeListeners((ev) => {
      if (!rangeDragging.current) return
      const col = vcolFromPoint(ev.clientX, ev.clientY)
      if (col == null) return
      const prev = cellRangeRef.current
      if (!prev) return
      const lastR = Math.max(0, dataRef.current.rows.length - 1)
      if (
        prev.focus.col === col &&
        prev.focus.row === lastR &&
        prev.anchor.row === 0
      ) {
        return
      }
      const updated: CellRange = {
        anchor: { row: 0, col: prev.anchor.col },
        focus: { row: lastR, col },
      }
      cellRangeRef.current = updated
      setCellRange(updated)
    })
  }

  /** Selected range bounds, normalized once rather than per cell. */
  const range = useMemo(
    () => (cellRange ? normalizeRange(cellRange) : null),
    [cellRange],
  )

  const columnFullySelected = (vcol: number): boolean => {
    if (!range) return false
    const { r0, r1, c0, c1 } = range
    if (vcol < c0 || vcol > c1) return false
    if (data.rows.length === 0) return true
    return r0 === 0 && r1 === lastRowIndex
  }

  const copyRange = async () => {
    const range = cellRangeRef.current
    if (!range) return false
    const { r0, r1, c0, c1 } = normalizeRange(range)
    const cols = visibleRef.current
    const rows = dataRef.current.rows
    const header: string[] = []
    for (let c = c0; c <= c1; c++) {
      const entry = cols[c]
      header.push(tsvEscape(entry?.col.name ?? ''))
    }
    const lines: string[] = [header.join('\t')]
    for (let r = r0; r <= r1; r++) {
      const row = rows[r]
      if (!row) continue
      const cells: string[] = []
      for (let c = c0; c <= c1; c++) {
        const entry = cols[c]
        if (!entry) {
          cells.push('')
          continue
        }
        cells.push(
          tsvEscape(copyValue(row[entry.index] ?? null, entry.col.type)),
        )
      }
      lines.push(cells.join('\t'))
    }
    const text = lines.join('\n')
    if (!text) return false
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

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

  // Ctrl/Cmd+C copies the drag-selected cell range as TSV.
  // Escape clears the range.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if (e.key === 'Escape' && cellRangeRef.current) {
        e.preventDefault()
        setCellRange(null)
        return
      }

      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key !== 'c' && e.key !== 'C') return
      if (!cellRangeRef.current) return
      if (inField) return
      e.preventDefault()
      void copyRange()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keep the selected cell in view while traversing.
  useEffect(() => {
    if (!selection) return
    const el = selection.column
      ? document.querySelector('.result-table td.cell-selected')
      : document.querySelector('.result-table tr.row-selected td.cell-rownum')
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [selection])

  if (data.columns.length === 0) {
    return <div className="empty-hint">No columns</div>
  }

  const applyColumnFilters = (filterKey: string, next: ColumnFilter[]) => {
    onFiltersChange([
      ...recipe.filters.filter((f) => f.column !== filterKey),
      ...next
        .filter(filterIsActive)
        .map((f) => ({ ...f, column: filterKey })),
    ])
  }

  const onDragStart = (name: string, e: DragEvent) => {
    if (!onColumnOrderChange) return
    if (resizeRef.current) {
      e.preventDefault()
      return
    }
    const t = e.target
    if (t instanceof Element && t.closest('.facet-popover')) {
      e.preventDefault()
      return
    }
    setDragging(name)
    setOpenColumn(null)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', name)
    e.dataTransfer.setData('application/x-sf-col', name)
  }

  const onDragOver = (name: string, e: DragEvent) => {
    if (!onColumnOrderChange) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragging && name !== dragging) setDropTarget(name)
  }

  const onDrop = (to: string, e: DragEvent) => {
    if (!onColumnOrderChange) return
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
    if (!onColumnWidthsChange) return
    e.preventDefault()
    e.stopPropagation()
    setOpenColumn(null)
    const th = e.currentTarget.parentElement as HTMLElement | null
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
    if (!state || !onColumnWidthsChange) return
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
    if (!onColumnWidthsChange) return
    const next = { ...columnWidths }
    delete next[name]
    onColumnWidthsChange(next)
  }

  return (
    <div
      ref={wrapRef}
      className="data-grid-wrap"
      onClick={() => setOpenColumn(null)}
      onPointerDown={(e) => {
        if (e.ctrlKey || e.metaKey) return
        if (resizeRef.current || rangeDragging.current) return
        if (cellRangeRef.current) setCellRange(null)
      }}
    >
      <table className="data-table result-table">
        <thead>
          <tr>
            <th className="th-cell th-rownum" title="Row">
              #
            </th>
            {visible.map(({ col }, vcol) => {
              const target = facetTargetFromRecipe(
                col.name,
                col.type,
                recipe,
                probeColumns,
              )
              const canFilter =
                target != null && isFacetable(target.type)
              const appliedFilters =
                target != null ? (filterMap.get(target.filterKey) ?? []) : []
              const active = appliedFilters.some(filterIsActive)
              const isOpen = openColumn === col.name

              const tableFilters: ColumnFilter[] =
                target == null ? [] : tableFiltersForTarget(recipe, target)

              const highlighted = highlightedColumn === col.name
              const isDragging = dragging === col.name
              const isDropTarget = dropTarget === col.name && !isDragging
              const resized = widthFor(col.name) != null
              const colSelected = columnFullySelected(vcol)

              return (
                <th
                  key={col.name}
                  ref={(node) => {
                    if (highlighted) highlightRef.current = node
                  }}
                  className={`th-cell${highlighted ? ' col-highlight' : ''}${isDragging ? ' col-dragging' : ''}${isDropTarget ? ' col-drop-target' : ''}${resized ? ' col-resized' : ''}${colSelected ? ' col-range' : ''}`}
                  style={colStyle(col.name)}
                  title={
                    onColumnOrderChange
                      ? `${col.type} - drag to reorder · drag edge to resize · Ctrl+drag to select`
                      : `${col.type} · Ctrl+drag to select`
                  }
                  data-col={col.name}
                  data-vcol={vcol}
                  draggable={
                    Boolean(onColumnOrderChange) &&
                    !isOpen &&
                    !resizePreview
                  }
                  onDragStart={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault()
                      return
                    }
                    onDragStart(col.name, e)
                  }}
                  onDragOver={(e) => onDragOver(col.name, e)}
                  onDragLeave={() =>
                    setDropTarget((t) => (t === col.name ? null : t))
                  }
                  onDrop={(e) => onDrop(col.name, e)}
                  onDragEnd={onDragEnd}
                  onPointerDown={(e) => {
                    if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return
                    const targetEl = e.target as Element
                    if (targetEl.closest('.col-resize-handle')) return
                    beginColumnSelect(vcol, e)
                  }}
                >
                  <div className="th-top">
                    <span className="th-name">{col.name}</span>
                    {canFilter && target ? (
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
                  {isOpen && canFilter && target ? (
                    <ColumnFilterPopover
                      connection={connection}
                      database={target.object.database}
                      schema={target.object.schema}
                      table={target.object.name}
                      column={target.bareColumn}
                      type={target.type}
                      appliedFilters={appliedFilters.map((f) => ({
                        ...f,
                        column: target.bareColumn,
                      }))}
                      filters={tableFilters}
                      onApply={(next) =>
                        applyColumnFilters(target.filterKey, next)
                      }
                      onClose={() => setOpenColumn(null)}
                    />
                  ) : null}
                  {onColumnWidthsChange ? (
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
              const inRangeRow =
                range != null && i >= range.r0 && i <= range.r1
              return (
                <GridRow
                  key={i}
                  row={row}
                  rowIndex={i}
                  rowNumber={rowOffset + i}
                  columns={gridColumns}
                  rowSelected={rowSelected}
                  selectedColumn={
                    rowSelected ? (selection?.column ?? null) : null
                  }
                  rangeFrom={inRangeRow ? range.c0 : -1}
                  rangeTo={inRangeRow ? range.c1 : -1}
                  onSelectCell={onSelectCell}
                  onRangeStart={onRangeStart}
                />
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

function columnMatchesHighlight(
  resultName: string,
  highlightRef: string | null,
  recipe: TransformRecipe,
  probeColumns: ColumnInfo[],
): boolean {
  if (!highlightRef) return false
  if (resultName === highlightRef) return true
  const probe = findProbeColumn(
    probeColumns,
    resultName,
    recipe.sourceAlias,
  )
  if (probe?.name === highlightRef) return true
  const { column } = parseColumnRef(highlightRef, recipe.sourceAlias)
  return resultName === column
}
