import { useEffect, useMemo, useRef, useState } from 'react'
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
import { facetTargetFromRecipe, findProbeColumn } from '../facetTarget'
import ColumnFilterPopover from './ColumnFilterPopover'
import { FilterIcon } from './TreeIcons'

type Props = {
  data: PreviewResult
  connection: Connection
  recipe: TransformRecipe
  /** Qualified columns from transform column probe (`t0.col`). */
  probeColumns: ColumnInfo[]
  onFiltersChange: (filters: ColumnFilter[]) => void
  /** Probe/result column ref hovered in the Columns step. */
  highlightColumn?: string | null
}

export default function ResultTable({
  data,
  connection,
  recipe,
  probeColumns,
  onFiltersChange,
  highlightColumn = null,
}: Props) {
  const [openColumn, setOpenColumn] = useState<string | null>(null)
  const highlightRef = useRef<HTMLTableCellElement | null>(null)

  const filterMap = useMemo(() => {
    const map = new Map<string, ColumnFilter[]>()
    for (const f of recipe.filters) {
      const list = map.get(f.column)
      if (list) list.push(f)
      else map.set(f.column, [f])
    }
    return map
  }, [recipe.filters])

  useEffect(() => {
    if (!highlightColumn) return
    const el = highlightRef.current
    if (!el) return
    el.scrollIntoView({
      behavior: 'smooth',
      inline: 'nearest',
      block: 'nearest',
    })
  }, [highlightColumn, data.columns])

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

  return (
    <div className="data-grid-wrap" onClick={() => setOpenColumn(null)}>
      <table className="data-table result-table">
        <thead>
          <tr>
            <th className="th-cell th-rownum">#</th>
            {data.columns.map((col) => {
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

              // Filters on the same physical table, bare names for facet API.
              const tableFilters: ColumnFilter[] =
                target == null
                  ? []
                  : recipe.filters.flatMap((f) => {
                      const { alias, column } = parseColumnRef(
                        f.column,
                        recipe.sourceAlias,
                      )
                      if (
                        alias !==
                        parseColumnRef(target.filterKey, recipe.sourceAlias)
                          .alias
                      ) {
                        return []
                      }
                      const next: ColumnFilter = {
                        column,
                        type: f.type,
                        values: f.values,
                      }
                      if (f.op) next.op = f.op
                      return [next]
                    })

              const highlighted = columnMatchesHighlight(
                col.name,
                highlightColumn,
                recipe,
                probeColumns,
              )

              return (
                <th
                  key={col.name}
                  ref={(node) => {
                    if (highlighted) highlightRef.current = node
                  }}
                  className={`th-cell${highlighted ? ' col-highlight' : ''}`}
                  title={col.type}
                  data-col={col.name}
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
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 ? (
            <tr>
              <td
                colSpan={data.columns.length + 1}
                style={{ color: 'var(--text-ghost)' }}
              >
                No rows
              </td>
            </tr>
          ) : (
            data.rows.map((row, i) => (
              <tr key={i}>
                <td className="cell-rownum">{i + 1}</td>
                {data.columns.map((col, ci) => {
                  const cell = row[ci]
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
                      }${highlighted ? ' col-highlight' : ''}`}
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
      onMouseDown={(e) => e.stopPropagation()}
    >
      <FilterIcon />
    </button>
  )
}

function formatCell(
  cell: string | number | boolean,
  type: import('../types').ColumnType,
): string {
  if (type === 'boolean') {
    return cell === true || cell === 'true' || cell === 1 ? 'true' : 'false'
  }
  return String(cell)
}
