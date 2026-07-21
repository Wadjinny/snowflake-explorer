import { useEffect, useMemo, useState } from 'react'
import type {
  ColumnFilter,
  ColumnInfo,
  ColumnType,
  Connection,
  PreviewResult,
  SortSpec,
} from '../types'
import { isFacetable } from '../types'
import ColumnFilterPopover from './ColumnFilterPopover'
import { FilterIcon } from './TreeIcons'

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
}: Props) {
  const [openColumn, setOpenColumn] = useState<string | null>(null)

  useEffect(() => {
    if (!openColumn) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenColumn(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openColumn])

  const hidden = useMemo(() => new Set(hiddenColumns), [hiddenColumns])

  const visible = useMemo(() => {
    const cols: { col: ColumnInfo; index: number }[] = []
    data.columns.forEach((col, index) => {
      if (!hidden.has(col.name)) cols.push({ col, index })
    })
    // Fallback: if everything hidden, show all
    if (cols.length === 0) {
      return data.columns.map((col, index) => ({ col, index }))
    }
    return cols
  }, [data.columns, hidden])

  if (data.columns.length === 0) {
    return <div className="empty-hint">No columns</div>
  }

  const filterMap = new Map(filters.map((f) => [f.column, f]))

  const applyFilter = (column: string, filter: ColumnFilter | null) => {
    const next = filters.filter((f) => f.column !== column)
    if (filter && filter.values.length > 0) next.push(filter)
    onFiltersChange(next)
  }

  const cycleSort = (column: string) => {
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

  return (
    <div className="data-grid-wrap" onClick={() => setOpenColumn(null)}>
      <table className="data-table">
        <thead>
          <tr>
            {visible.map(({ col }) => {
              const active = filterMap.has(col.name)
              const applied = filterMap.get(col.name)?.values ?? []
              const isOpen = openColumn === col.name
              const canFilter = isFacetable(col.type)
              const sortDir =
                sort?.column === col.name ? sort.direction : null
              return (
                <th key={col.name} title={col.type} className="th-cell">
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
                      applied={applied}
                      onApply={(f) => applyFilter(col.name, f)}
                      onClose={() => setOpenColumn(null)}
                    />
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
                colSpan={visible.length}
                style={{ color: 'var(--text-ghost)' }}
              >
                No rows
              </td>
            </tr>
          ) : (
            data.rows.map((row, i) => (
              <tr key={i}>
                {visible.map(({ col, index }) => {
                  const cell = row[index]
                  const colType: ColumnType = col.type
                  const isNull = cell == null
                  return (
                    <td
                      key={col.name}
                      className={
                        isNull ? 'cell-null' : `cell-type type-${colType}`
                      }
                      title={isNull ? 'NULL' : String(cell)}
                    >
                      {isNull ? 'NULL' : formatCell(cell, colType)}
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

function HeaderFilterButton({
  active,
  open,
  onToggle,
}: {
  active: boolean
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`th-filter-btn${active ? ' active' : ''}${open ? ' open' : ''}`}
      title={active ? 'Edit filter' : 'Filter'}
      aria-label="Filter column"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <FilterIcon />
    </button>
  )
}

function formatCell(
  cell: string | number | boolean,
  type: ColumnType,
): string {
  if (type === 'boolean') {
    return cell === true || cell === 'true' || cell === 1 ? 'true' : 'false'
  }
  return String(cell)
}
