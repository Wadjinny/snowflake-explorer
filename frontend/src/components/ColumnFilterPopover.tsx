import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { facetColumn } from '../api/snowflake'
import type {
  ColumnFilter,
  Connection,
  FacetableType,
  FilterValue,
} from '../types'
import { filterValueKey } from '../types'
import Spinner from './Spinner'
import { CheckIcon, ClearIcon, CloseIcon } from './TreeIcons'

const PAGE_SIZE = 10

type Props = {
  connection: Connection
  database: string
  schema: string
  table: string
  column: string
  type: FacetableType
  applied: FilterValue[]
  /** All active tab filters (including this column). */
  filters: ColumnFilter[]
  onApply: (filter: ColumnFilter | null) => void
  onClose: () => void
}

export default function ColumnFilterPopover({
  connection,
  database,
  schema,
  table,
  column,
  type,
  applied,
  filters,
  onApply,
  onClose,
}: Props) {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<FilterValue[]>(applied)

  const otherFilters = useMemo(
    () => filters.filter((f) => f.column !== column && f.values.length > 0),
    [filters, column],
  )
  const hasOtherFilters = otherFilters.length > 0
  const [matchOtherFilters, setMatchOtherFilters] = useState(hasOtherFilters)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQ(q)
      setOffset(0)
    }, 250)
    return () => window.clearTimeout(t)
  }, [q])

  useEffect(() => {
    setSelected(applied)
  }, [applied])

  useEffect(() => {
    if (hasOtherFilters) setMatchOtherFilters(true)
  }, [hasOtherFilters])

  useEffect(() => {
    setOffset(0)
  }, [matchOtherFilters])

  const scopedFilters = matchOtherFilters ? otherFilters : []

  const facet = useQuery({
    queryKey: [
      'facet',
      connection.id,
      database,
      schema,
      table,
      column,
      type,
      debouncedQ,
      offset,
      matchOtherFilters,
      scopedFilters,
    ],
    queryFn: () =>
      facetColumn(
        connection,
        database,
        schema,
        table,
        column,
        type,
        debouncedQ,
        PAGE_SIZE,
        offset,
        scopedFilters,
      ),
    placeholderData: keepPreviousData,
  })

  const selectedKeys = new Set(selected.map(filterValueKey))
  const page = facet.data?.values ?? []
  const hasMore = facet.data?.has_more ?? false
  const pageNum = Math.floor(offset / PAGE_SIZE) + 1

  const pageByKey = useMemo(() => {
    const map = new Map<string, (typeof page)[number]>()
    for (const item of page) map.set(filterValueKey(item.value), item)
    return map
  }, [page])

  const selectedRows = useMemo(
    () =>
      selected.map((value) => {
        const fromPage = pageByKey.get(filterValueKey(value))
        return {
          value,
          label: fromPage?.label ?? (value == null ? 'NULL' : String(value)),
          count: fromPage?.count,
        }
      }),
    [selected, pageByKey],
  )

  const unselectedPage = page.filter(
    (item) => !selectedKeys.has(filterValueKey(item.value)),
  )

  const toggle = (value: FilterValue) => {
    const key = filterValueKey(value)
    setSelected((prev) => {
      if (prev.some((v) => filterValueKey(v) === key)) {
        return prev.filter((v) => filterValueKey(v) !== key)
      }
      return [...prev, value]
    })
  }

  const apply = () => {
    if (selected.length === 0) {
      onApply(null)
    } else {
      onApply({ column, type, values: selected })
    }
    onClose()
  }

  const clear = () => {
    setSelected([])
    onApply(null)
    onClose()
  }

  return (
    <div
      className="facet-popover"
      role="dialog"
      aria-label={`Filter ${column}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="facet-popover-head">
        <span className="facet-title">{column}</span>
        <span className={`th-type type-${type}`}>{type}</span>
      </div>

      <input
        className="input facet-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search values…"
        autoFocus
      />

      {hasOtherFilters ? (
        <label className="facet-scope" title="Recount values using other active filters">
          <input
            type="checkbox"
            checked={matchOtherFilters}
            onChange={(e) => setMatchOtherFilters(e.target.checked)}
          />
          <span>Counts with other filters</span>
        </label>
      ) : null}

      <div className="facet-list">
        {facet.isLoading && !facet.data ? (
          <div className="facet-status">
            <Spinner size="sm" label="Loading…" />
          </div>
        ) : facet.isError ? (
          <div className="facet-status error">
            {facet.error instanceof Error
              ? facet.error.message
              : 'Failed to load values'}
          </div>
        ) : selectedRows.length === 0 && unselectedPage.length === 0 ? (
          <div className="facet-status">No values</div>
        ) : (
          <>
            {selectedRows.length > 0 ? (
              <div className="facet-selected">
                {selectedRows.map((item) => (
                  <label
                    key={filterValueKey(item.value)}
                    className="facet-row facet-row-selected"
                  >
                    <input
                      type="checkbox"
                      checked
                      onChange={() => toggle(item.value)}
                    />
                    <span
                      className={`facet-value${item.value == null ? ' null' : ''}`}
                      title={item.label}
                    >
                      {item.label}
                    </span>
                    {item.count != null ? (
                      <span className="facet-count">
                        {item.count.toLocaleString()}
                      </span>
                    ) : (
                      <span className="facet-count facet-count-muted">—</span>
                    )}
                  </label>
                ))}
              </div>
            ) : null}
            {unselectedPage.map((item) => {
              const key = filterValueKey(item.value)
              return (
                <label key={key} className="facet-row">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => toggle(item.value)}
                  />
                  <span
                    className={`facet-value${item.value == null ? ' null' : ''}`}
                    title={item.label}
                  >
                    {item.label}
                  </span>
                  <span className="facet-count">
                    {item.count.toLocaleString()}
                  </span>
                </label>
              )
            })}
          </>
        )}
      </div>

      <div className="facet-pager">
        <button
          type="button"
          className="btn-micro"
          disabled={offset === 0 || facet.isFetching}
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
        >
          ◀
        </button>
        <span className="facet-page-label">
          {facet.isFetching ? <Spinner size="sm" /> : null}
          Page {pageNum}
        </span>
        <button
          type="button"
          className="btn-micro"
          disabled={!hasMore || facet.isFetching}
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
        >
          ▶
        </button>
      </div>

      <div className="facet-actions">
        <button
          type="button"
          className="btn-micro btn-icon"
          onClick={clear}
          title="Clear filter"
          aria-label="Clear filter"
        >
          <ClearIcon />
        </button>
        <div className="facet-actions-right">
          <button
            type="button"
            className="btn-micro btn-icon"
            onClick={onClose}
            title="Cancel"
            aria-label="Cancel"
          >
            <CloseIcon />
          </button>
          <button
            type="button"
            className={`btn-micro btn-icon${selected.length > 0 ? ' open' : ''}`}
            onClick={apply}
            title={
              selected.length > 0
                ? `Apply (${selected.length})`
                : 'Apply (clear filter)'
            }
            aria-label={
              selected.length > 0
                ? `Apply ${selected.length} values`
                : 'Apply clear filter'
            }
          >
            <CheckIcon />
          </button>
        </div>
      </div>
    </div>
  )
}
