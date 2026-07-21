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
import { formatCell, HeaderFilterButton } from './gridCells'

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
  /** First absolute row number on this page (1-based). */
  rowOffset?: number
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
  rowOffset = 1,
}: Props) {
  const [openColumn, setOpenColumn] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [resizePreview, setResizePreview] = useState<{
    name: string
    width: number
  } | null>(null)
  const highlightRef = useRef<HTMLTableCellElement | null>(null)
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
    }
  }, [])

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
    <div className="data-grid-wrap" onClick={() => setOpenColumn(null)}>
      <table className="data-table result-table">
        <thead>
          <tr>
            <th className="th-cell th-rownum">#</th>
            {visible.map(({ col }) => {
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

              const highlighted = columnMatchesHighlight(
                col.name,
                highlightColumn,
                recipe,
                probeColumns,
              )
              const isDragging = dragging === col.name
              const isDropTarget = dropTarget === col.name && !isDragging
              const resized = widthFor(col.name) != null

              return (
                <th
                  key={col.name}
                  ref={(node) => {
                    if (highlighted) highlightRef.current = node
                  }}
                  className={`th-cell${highlighted ? ' col-highlight' : ''}${isDragging ? ' col-dragging' : ''}${isDropTarget ? ' col-drop-target' : ''}${resized ? ' col-resized' : ''}`}
                  style={colStyle(col.name)}
                  title={
                    onColumnOrderChange
                      ? `${col.type} — drag to reorder`
                      : col.type
                  }
                  data-col={col.name}
                  draggable={Boolean(onColumnOrderChange)}
                  onDragStart={(e) => onDragStart(col.name, e)}
                  onDragOver={(e) => onDragOver(col.name, e)}
                  onDragLeave={() =>
                    setDropTarget((t) => (t === col.name ? null : t))
                  }
                  onDrop={(e) => onDrop(col.name, e)}
                  onDragEnd={onDragEnd}
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
            data.rows.map((row, i) => (
              <tr key={i}>
                <td className="cell-rownum">{rowOffset + i}</td>
                {visible.map(({ col, index }) => {
                  const cell = row[index]
                  const isNull = cell == null
                  const highlighted = columnMatchesHighlight(
                    col.name,
                    highlightColumn,
                    recipe,
                    probeColumns,
                  )
                  return (
                    <td
                      key={col.name}
                      className={`${
                        isNull ? 'cell-null' : `cell-type type-${col.type}`
                      }${highlighted ? ' col-highlight' : ''}${
                        widthFor(col.name) != null ? ' col-resized' : ''
                      }`}
                      style={colStyle(col.name)}
                      title={isNull ? 'NULL' : String(cell)}
                    >
                      {isNull ? 'NULL' : formatCell(cell, col.type)}
                    </td>
                  )
                })}
              </tr>
            ))
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
