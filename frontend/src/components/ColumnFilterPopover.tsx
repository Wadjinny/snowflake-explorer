import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { facetColumn } from '../api/snowflake'
import type {
  ColumnFilter,
  Connection,
  FacetableType,
  FilterValue,
} from '../types'
import { filterValueKey } from '../types'
import Spinner from './Spinner'

const PAGE_SIZE = 10

type Props = {
  connection: Connection
  database: string
  schema: string
  table: string
  column: string
  type: FacetableType
  applied: FilterValue[]
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
  onApply,
  onClose,
}: Props) {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<FilterValue[]>(applied)

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
      ),
    placeholderData: keepPreviousData,
  })

  const selectedKeys = new Set(selected.map(filterValueKey))
  const page = facet.data?.values ?? []
  const hasMore = facet.data?.has_more ?? false
  const pageNum = Math.floor(offset / PAGE_SIZE) + 1

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
        ) : page.length === 0 ? (
          <div className="facet-status">No values</div>
        ) : (
          page.map((item) => {
            const key = filterValueKey(item.value)
            const checked = selectedKeys.has(key)
            return (
              <label key={key} className="facet-row">
                <input
                  type="checkbox"
                  checked={checked}
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
          })
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
        <button type="button" className="btn" onClick={clear}>
          Clear
        </button>
        <div className="facet-actions-right">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={apply}>
            Apply{selected.length > 0 ? ` (${selected.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
