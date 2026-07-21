import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { facetColumn } from '../api/snowflake'
import type {
  ColumnFilter,
  Connection,
  FacetableType,
  FilterOp,
  FilterValue,
} from '../types'
import {
  FILTER_OP_LABELS,
  filterIsActive,
  filterNeedsBounds,
  filterNeedsPattern,
  filterValueKey,
  normalizeFilterOp,
  NUMBER_FILTER_OPS,
  parseFilterNumber,
  periodTokenLabel,
  STRING_FILTER_OPS,
} from '../types'
import PeriodDrillTree from './PeriodDrillTree'
import Spinner from './Spinner'
import { CheckIcon, ClearIcon, CloseIcon } from './TreeIcons'

const PAGE_SIZE = 10
const POPOVER_WIDTH = 280

type Mode = 'values' | 'drill' | 'condition'

type Pos = { top: number; left: number; maxHeight: number }

type PatternOp = 'has' | 'startswith' | 'endswith'

type Props = {
  connection: Connection
  database: string
  schema: string
  table: string
  column: string
  type: FacetableType
  /** Filters currently applied to this column (values and/or conditions). */
  appliedFilters: ColumnFilter[]
  /** All active tab filters (including this column). */
  filters: ColumnFilter[]
  /** Replace this column's filters. Empty array clears. */
  onApply: (next: ColumnFilter[]) => void
  onClose: () => void
  /** Anchor for fixed positioning (avoids overflow clipping). */
  anchorRef?: React.RefObject<HTMLElement | null>
}

function isConditionOp(op: FilterOp): boolean {
  return op !== 'in'
}

function initialMode(type: FacetableType, applied: ColumnFilter[]): Mode {
  if (applied.some((f) => isConditionOp(normalizeFilterOp(f.op)))) {
    return 'condition'
  }
  if (type === 'date' || type === 'timestamp') return 'drill'
  return 'values'
}

function findApplied(filters: ColumnFilter[], op: FilterOp): ColumnFilter | undefined {
  return filters.find((f) => normalizeFilterOp(f.op) === op)
}

function exclusiveToggle(prev: Set<FilterOp>, op: FilterOp): Set<FilterOp> {
  const next = new Set(prev)
  if (next.has(op)) {
    next.delete(op)
    return next
  }
  next.add(op)
  if (op === 'is_null') {
    next.clear()
    next.add('is_null')
    return next
  }
  next.delete('is_null')
  if (op === 'is_not_null') next.delete('is_null')
  if (op === 'is_empty') next.delete('is_not_empty')
  if (op === 'is_not_empty') next.delete('is_empty')
  return next
}

export default function ColumnFilterPopover({
  connection,
  database,
  schema,
  table,
  column,
  type,
  appliedFilters,
  filters,
  onApply,
  onClose,
  anchorRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos | null>(null)
  const isDateType = type === 'date' || type === 'timestamp'
  const isNumber = type === 'number'
  const hasCondition = type === 'string' || isNumber
  const conditionOps = isNumber ? NUMBER_FILTER_OPS : STRING_FILTER_OPS

  const valueApplied = useMemo(
    () => findApplied(appliedFilters, 'in'),
    [appliedFilters],
  )
  const condApplied = useMemo(
    () =>
      appliedFilters.filter((f) => isConditionOp(normalizeFilterOp(f.op))),
    [appliedFilters],
  )

  const [mode, setMode] = useState<Mode>(() =>
    initialMode(type, appliedFilters),
  )
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<FilterValue[]>(
    () => valueApplied?.values ?? [],
  )
  const [condOps, setCondOps] = useState<Set<FilterOp>>(() => {
    const ops = new Set(
      condApplied.map((f) => normalizeFilterOp(f.op)).filter(isConditionOp),
    )
    return ops
  })
  const [patterns, setPatterns] = useState<Partial<Record<PatternOp, string>>>(
    () => {
      const init: Partial<Record<PatternOp, string>> = {}
      for (const op of ['has', 'startswith', 'endswith'] as const) {
        const f = findApplied(condApplied, op)
        if (f?.values[0] != null) init[op] = String(f.values[0])
      }
      return init
    },
  )
  const [gtVal, setGtVal] = useState(() => {
    const f = findApplied(condApplied, 'gt')
    return f?.values[0] != null ? String(f.values[0]) : ''
  })
  const [ltVal, setLtVal] = useState(() => {
    const f = findApplied(condApplied, 'lt')
    return f?.values[0] != null ? String(f.values[0]) : ''
  })
  const [betweenLow, setBetweenLow] = useState(() => {
    const f = findApplied(condApplied, 'between')
    return f?.values[0] != null ? String(f.values[0]) : ''
  })
  const [betweenHigh, setBetweenHigh] = useState(() => {
    const f = findApplied(condApplied, 'between')
    return f?.values[1] != null ? String(f.values[1]) : ''
  })

  const otherFilters = useMemo(
    () =>
      filters.filter((f) => f.column !== column && filterIsActive(f)),
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
    setSelected(valueApplied?.values ?? [])
    const nextOps = new Set(
      condApplied.map((f) => normalizeFilterOp(f.op)).filter(isConditionOp),
    )
    setCondOps(nextOps)
    const nextPatterns: Partial<Record<PatternOp, string>> = {}
    for (const op of ['has', 'startswith', 'endswith'] as const) {
      const f = findApplied(condApplied, op)
      if (f?.values[0] != null) nextPatterns[op] = String(f.values[0])
    }
    setPatterns(nextPatterns)
    const gt = findApplied(condApplied, 'gt')
    setGtVal(gt?.values[0] != null ? String(gt.values[0]) : '')
    const lt = findApplied(condApplied, 'lt')
    setLtVal(lt?.values[0] != null ? String(lt.values[0]) : '')
    const between = findApplied(condApplied, 'between')
    setBetweenLow(
      between?.values[0] != null ? String(between.values[0]) : '',
    )
    setBetweenHigh(
      between?.values[1] != null ? String(between.values[1]) : '',
    )
  }, [valueApplied, condApplied])

  useEffect(() => {
    if (hasOtherFilters) setMatchOtherFilters(true)
  }, [hasOtherFilters])

  useEffect(() => {
    setOffset(0)
  }, [matchOtherFilters])

  useLayoutEffect(() => {
    if (!anchorRef) {
      setPos(null)
      return
    }
    const update = () => {
      const el = anchorRef.current
      if (!el) {
        setPos(null)
        return
      }
      const r = el.getBoundingClientRect()
      const left = Math.max(
        8,
        Math.min(r.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 8),
      )
      const spaceBelow = window.innerHeight - r.bottom - 8
      const spaceAbove = r.top - 8
      const placeBelow = spaceBelow >= 240 || spaceBelow >= spaceAbove
      const maxHeight = Math.min(420, placeBelow ? spaceBelow : spaceAbove)
      const top = placeBelow
        ? r.bottom + 4
        : Math.max(8, r.top - maxHeight - 4)
      setPos({ top, left, maxHeight })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorRef])

  useEffect(() => {
    if (!anchorRef) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (anchorRef.current?.contains(t)) return
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDoc)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDoc)
    }
  }, [onClose, anchorRef])

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
    enabled: mode === 'values',
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
        const label =
          fromPage?.label ??
          (isDateType
            ? periodTokenLabel(value)
            : value == null
              ? 'NULL'
              : String(value))
        return {
          value,
          label,
          count: fromPage?.count,
        }
      }),
    [selected, pageByKey, isDateType],
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

  const buildConditionFilters = (): ColumnFilter[] => {
    const out: ColumnFilter[] = []
    for (const op of conditionOps) {
      if (!condOps.has(op)) continue
      let values: FilterValue[] = []
      if (filterNeedsPattern(op)) {
        const text = (patterns[op as PatternOp] ?? '').trim()
        values = text ? [text] : []
      } else if (op === 'gt') {
        const n = parseFilterNumber(gtVal)
        values = n != null ? [n] : []
      } else if (op === 'lt') {
        const n = parseFilterNumber(ltVal)
        values = n != null ? [n] : []
      } else if (filterNeedsBounds(op)) {
        const lo = parseFilterNumber(betweenLow)
        const hi = parseFilterNumber(betweenHigh)
        values = lo != null && hi != null ? [lo, hi] : []
      }
      const draft: ColumnFilter = { column, type, op, values }
      if (filterIsActive(draft)) out.push(draft)
    }
    return out
  }

  const conditionDrafts = buildConditionFilters()
  const conditionReady = conditionDrafts.length > 0
  const valuesReady = selected.length > 0
  const applyReady = mode === 'condition' ? conditionReady : valuesReady

  const apply = () => {
    if (mode === 'condition') {
      onApply(conditionDrafts)
      onClose()
      return
    }
    if (selected.length === 0) {
      onApply([])
    } else {
      onApply([{ column, type, values: selected, op: 'in' }])
    }
    onClose()
  }

  const clear = () => {
    setSelected([])
    setCondOps(new Set())
    setPatterns({})
    setGtVal('')
    setLtVal('')
    setBetweenLow('')
    setBetweenHigh('')
    onApply([])
    onClose()
  }

  const toggleCondOp = (op: FilterOp) => {
    setCondOps((prev) => exclusiveToggle(prev, op))
  }

  const onEnterApply = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && conditionReady) {
      e.preventDefault()
      apply()
    }
  }

  const body = (
    <div
      ref={rootRef}
      className={`facet-popover${pos ? ' facet-popover-fixed' : ''}`}
      style={
        pos
          ? {
              top: pos.top,
              left: pos.left,
              maxHeight: pos.maxHeight,
            }
          : undefined
      }
      role="dialog"
      aria-label={`Filter ${column}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="facet-popover-head">
        <span className="facet-title">{column}</span>
        <span className={`th-type type-${type}`}>{type}</span>
      </div>

      {isDateType || hasCondition ? (
        <div className="facet-mode-tabs" role="tablist">
          {isDateType ? (
            <button
              type="button"
              role="tab"
              className={`btn-micro${mode === 'drill' ? ' open' : ''}`}
              aria-selected={mode === 'drill'}
              onClick={() => setMode('drill')}
            >
              Drill-down
            </button>
          ) : null}
          <button
            type="button"
            role="tab"
            className={`btn-micro${mode === 'values' ? ' open' : ''}`}
            aria-selected={mode === 'values'}
            onClick={() => setMode('values')}
          >
            Values
          </button>
          {hasCondition ? (
            <button
              type="button"
              role="tab"
              className={`btn-micro${mode === 'condition' ? ' open' : ''}`}
              aria-selected={mode === 'condition'}
              onClick={() => setMode('condition')}
            >
              Condition
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === 'condition' ? (
        <div className="facet-condition">
          <div
            className="facet-condition-ops"
            role="listbox"
            aria-label="Operators"
            aria-multiselectable="true"
          >
            {conditionOps.map((op) => (
              <button
                key={op}
                type="button"
                role="option"
                aria-selected={condOps.has(op)}
                className={`facet-condition-op${condOps.has(op) ? ' on' : ''}`}
                onClick={() => toggleCondOp(op)}
              >
                {FILTER_OP_LABELS[op]}
              </button>
            ))}
          </div>

          {condOps.size === 0 ? (
            <div className="facet-condition-hint">
              Select one or more conditions (combined with{' '}
              <span className="tf-mono">AND</span>).
            </div>
          ) : null}

          {[...condOps].map((op) => {
            if (filterNeedsPattern(op)) {
              const key = op as PatternOp
              return (
                <label key={op} className="facet-condition-field">
                  <span className="facet-condition-field-label">
                    {FILTER_OP_LABELS[op]}
                  </span>
                  <input
                    className="input facet-search"
                    value={patterns[key] ?? ''}
                    onChange={(e) =>
                      setPatterns((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                    placeholder={
                      op === 'has'
                        ? 'Text to find…'
                        : op === 'startswith'
                          ? 'Prefix…'
                          : 'Suffix…'
                    }
                    onKeyDown={onEnterApply}
                  />
                </label>
              )
            }
            if (op === 'gt') {
              return (
                <label key={op} className="facet-condition-field">
                  <span className="facet-condition-field-label">
                    {FILTER_OP_LABELS[op]}
                  </span>
                  <input
                    className="input facet-search"
                    type="number"
                    inputMode="decimal"
                    value={gtVal}
                    onChange={(e) => setGtVal(e.target.value)}
                    placeholder="Greater than…"
                    onKeyDown={onEnterApply}
                  />
                </label>
              )
            }
            if (op === 'lt') {
              return (
                <label key={op} className="facet-condition-field">
                  <span className="facet-condition-field-label">
                    {FILTER_OP_LABELS[op]}
                  </span>
                  <input
                    className="input facet-search"
                    type="number"
                    inputMode="decimal"
                    value={ltVal}
                    onChange={(e) => setLtVal(e.target.value)}
                    placeholder="Less than…"
                    onKeyDown={onEnterApply}
                  />
                </label>
              )
            }
            if (filterNeedsBounds(op)) {
              return (
                <div key={op} className="facet-condition-field">
                  <span className="facet-condition-field-label">
                    {FILTER_OP_LABELS[op]}
                  </span>
                  <div className="facet-condition-bounds">
                    <input
                      className="input facet-search"
                      type="number"
                      inputMode="decimal"
                      value={betweenLow}
                      onChange={(e) => setBetweenLow(e.target.value)}
                      placeholder="Min"
                      onKeyDown={onEnterApply}
                    />
                    <span className="facet-condition-bounds-sep">…</span>
                    <input
                      className="input facet-search"
                      type="number"
                      inputMode="decimal"
                      value={betweenHigh}
                      onChange={(e) => setBetweenHigh(e.target.value)}
                      placeholder="Max"
                      onKeyDown={onEnterApply}
                    />
                  </div>
                </div>
              )
            }
            return (
              <div key={op} className="facet-condition-hint">
                {FILTER_OP_LABELS[op]}
              </div>
            )
          })}
        </div>
      ) : mode === 'values' ? (
        <>
          <input
            className="input facet-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search values…"
            autoFocus
          />

          {hasOtherFilters ? (
            <label
              className="facet-scope"
              title="Recount values using other active filters"
            >
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
        </>
      ) : (
        <>
          {hasOtherFilters ? (
            <label
              className="facet-scope"
              title="Recount values using other active filters"
            >
              <input
                type="checkbox"
                checked={matchOtherFilters}
                onChange={(e) => setMatchOtherFilters(e.target.checked)}
              />
              <span>Counts with other filters</span>
            </label>
          ) : null}

          {selected.length > 0 ? (
            <div className="facet-chips">
              {selected.map((v) => (
                <button
                  key={filterValueKey(v)}
                  type="button"
                  className="facet-chip"
                  title="Remove"
                  onClick={() => toggle(v)}
                >
                  {periodTokenLabel(v)}
                  <span aria-hidden>×</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="facet-list facet-list-tree">
            <PeriodDrillTree
              connection={connection}
              database={database}
              schema={schema}
              table={table}
              column={column}
              type={type}
              scopedFilters={scopedFilters}
              selected={selected}
              onToggle={toggle}
            />
          </div>
        </>
      )}

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
            className={`btn-micro btn-icon${applyReady ? ' open' : ''}`}
            onClick={apply}
            title={
              applyReady
                ? mode === 'condition'
                  ? `Apply (${conditionDrafts.length} condition${conditionDrafts.length === 1 ? '' : 's'})`
                  : `Apply (${selected.length})`
                : 'Apply (clear filter)'
            }
            aria-label={
              applyReady
                ? mode === 'condition'
                  ? `Apply ${conditionDrafts.length} conditions`
                  : `Apply ${selected.length} values`
                : 'Apply clear filter'
            }
          >
            <CheckIcon />
          </button>
        </div>
      </div>
    </div>
  )

  if (anchorRef) {
    return createPortal(body, document.body)
  }
  return body
}
