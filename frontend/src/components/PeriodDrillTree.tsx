import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { facetPeriods } from '../api/snowflake'
import type {
  ColumnFilter,
  Connection,
  FacetValue,
  FacetableType,
  FilterValue,
  PeriodGrain,
} from '../types'
import { filterValueKey, periodTokenLabel } from '../types'
import Spinner from './Spinner'
import { ChevronIcon } from './TreeIcons'

type Props = {
  connection: Connection
  database: string
  schema: string
  table: string
  column: string
  type: FacetableType
  scopedFilters: ColumnFilter[]
  selected: FilterValue[]
  onToggle: (value: FilterValue) => void
}

function childGrain(grain: PeriodGrain): PeriodGrain | null {
  if (grain === 'year') return 'month'
  if (grain === 'month') return 'week'
  if (grain === 'week') return 'day'
  return null
}

function pathKey(path: string[]): string {
  return path.join('/')
}

export default function PeriodDrillTree({
  connection,
  database,
  schema,
  table,
  column,
  type,
  scopedFilters,
  selected,
  onToggle,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const selectedKeys = new Set(selected.map(filterValueKey))

  const roots = useQuery({
    queryKey: [
      'facet-periods',
      connection.id,
      database,
      schema,
      table,
      column,
      type,
      'year',
      null,
      null,
      scopedFilters,
    ],
    queryFn: () =>
      facetPeriods(
        connection,
        database,
        schema,
        table,
        column,
        type,
        'year',
        null,
        scopedFilters,
        null,
      ),
    placeholderData: keepPreviousData,
  })

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (roots.isLoading && !roots.data) {
    return (
      <div className="facet-status">
        <Spinner size="sm" label="Loading…" />
      </div>
    )
  }
  if (roots.isError) {
    return (
      <div className="facet-status error">
        {roots.error instanceof Error
          ? roots.error.message
          : 'Failed to load periods'}
      </div>
    )
  }
  const years = roots.data?.values ?? []
  if (years.length === 0) {
    return <div className="facet-status">No periods</div>
  }

  return (
    <div className="facet-tree" role="tree">
      {years.map((item) => (
        <PeriodTreeNode
          key={filterValueKey(item.value)}
          item={item}
          grain="year"
          path={[]}
          depth={0}
          connection={connection}
          database={database}
          schema={schema}
          table={table}
          column={column}
          type={type}
          scopedFilters={scopedFilters}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          selectedKeys={selectedKeys}
          onToggle={onToggle}
        />
      ))}
      {roots.isFetching ? (
        <div className="facet-page-label" style={{ padding: '4px 0' }}>
          <Spinner size="sm" />
        </div>
      ) : null}
    </div>
  )
}

function PeriodTreeNode({
  item,
  grain,
  path,
  depth,
  connection,
  database,
  schema,
  table,
  column,
  type,
  scopedFilters,
  expanded,
  onToggleExpand,
  selectedKeys,
  onToggle,
}: {
  item: FacetValue
  grain: PeriodGrain
  path: string[]
  depth: number
  connection: Connection
  database: string
  schema: string
  table: string
  column: string
  type: FacetableType
  scopedFilters: ColumnFilter[]
  expanded: Set<string>
  onToggleExpand: (key: string) => void
  selectedKeys: Set<string>
  onToggle: (value: FilterValue) => void
}) {
  const token = String(item.value)
  const nodePath = [...path, token]
  const key = pathKey(nodePath)
  const next = childGrain(grain)
  const canExpand = next != null
  const isOpen = canExpand && expanded.has(key)
  const checked = selectedKeys.has(filterValueKey(item.value))
  const clip = next === 'day' ? (path[1] ?? null) : null

  const children = useQuery({
    queryKey: [
      'facet-periods',
      connection.id,
      database,
      schema,
      table,
      column,
      type,
      next,
      token,
      clip,
      scopedFilters,
    ],
    queryFn: () =>
      facetPeriods(
        connection,
        database,
        schema,
        table,
        column,
        type,
        next!,
        token,
        scopedFilters,
        clip,
      ),
    placeholderData: keepPreviousData,
    enabled: isOpen && canExpand,
  })

  return (
    <div className="facet-tree-node" role="treeitem" aria-expanded={canExpand ? isOpen : undefined}>
      <div
        className={`facet-tree-row${checked ? ' on' : ''}`}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        {canExpand ? (
          <button
            type="button"
            className="facet-tree-chevron"
            onClick={() => onToggleExpand(key)}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            <ChevronIcon open={isOpen} />
          </button>
        ) : (
          <span className="facet-tree-chevron spacer" />
        )}
        <label className="facet-tree-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggle(item.value)}
          />
          <span className="facet-value" title={item.label}>
            {item.label || periodTokenLabel(item.value)}
          </span>
          <span className="facet-count">{item.count.toLocaleString()}</span>
        </label>
      </div>
      {isOpen ? (
        <div className="facet-tree-children" role="group">
          {children.isLoading && !children.data ? (
            <div
              className="facet-status"
              style={{ paddingLeft: 16 + depth * 12 }}
            >
              <Spinner size="sm" label="Loading…" />
            </div>
          ) : children.isError ? (
            <div
              className="facet-status error"
              style={{ paddingLeft: 16 + depth * 12 }}
            >
              {children.error instanceof Error
                ? children.error.message
                : 'Failed to load'}
            </div>
          ) : (children.data?.values.length ?? 0) === 0 ? (
            <div
              className="facet-status"
              style={{ paddingLeft: 16 + depth * 12 }}
            >
              Empty
            </div>
          ) : (
            children.data!.values.map((child) => (
              <PeriodTreeNode
                key={filterValueKey(child.value)}
                item={child}
                grain={next!}
                path={nodePath}
                depth={depth + 1}
                connection={connection}
                database={database}
                schema={schema}
                table={table}
                column={column}
                type={type}
                scopedFilters={scopedFilters}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
                selectedKeys={selectedKeys}
                onToggle={onToggle}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
