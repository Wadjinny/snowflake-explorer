import { useEffect, useState, type ReactNode } from 'react'
import type {
  ColumnInfo,
  ColumnFilter,
  FacetableType,
  SelectedObject,
  SortDirection,
} from '../types'
import { isFacetable } from '../types'
import { objectTitle } from '../paths'
import {
  DEFAULT_TRANSFORM_LIMIT,
  MAX_JOINS,
  nextJoinAlias,
  parseColumnRef,
  type AggFn,
  type Aggregation,
  type JoinType,
  type TransformJoin,
  type TransformRecipe,
} from '../transformations'
import { CloseIcon } from './TreeIcons'

type Props = {
  recipe: TransformRecipe
  columns: ColumnInfo[]
  onChange: (recipe: TransformRecipe) => void
  onPickSource?: () => void
  onHoverColumn?: (columnRef: string | null) => void
}

type StepId =
  | 'joins'
  | 'columns'
  | 'filters'
  | 'aggregate'
  | 'pivot'
  | 'order'
  | 'limit'

const JOIN_TYPES: JoinType[] = ['inner', 'left', 'right', 'full']
const AGG_FNS: AggFn[] = [
  'count',
  'count_distinct',
  'sum',
  'avg',
  'min',
  'max',
]

const AGG_FN_LABELS: Record<AggFn, string> = {
  count: 'count',
  count_distinct: 'count distinct',
  sum: 'sum',
  avg: 'avg',
  min: 'min',
  max: 'max',
}

const STEP_LABELS: Record<StepId, string> = {
  joins: 'Join',
  columns: 'Columns',
  filters: 'Filter',
  aggregate: 'Aggregate',
  pivot: 'Pivot',
  order: 'Order',
  limit: 'Limit',
}

const ALL_STEPS: StepId[] = [
  'joins',
  'columns',
  'filters',
  'aggregate',
  'pivot',
  'order',
  'limit',
]

function stepsFromRecipe(recipe: TransformRecipe): Set<StepId> {
  const s = new Set<StepId>()
  if (recipe.joins.length > 0) s.add('joins')
  if (recipe.columns.length > 0) s.add('columns')
  if (recipe.filters.length > 0) s.add('filters')
  if (recipe.groupBy.length > 0 || recipe.aggregations.length > 0) {
    s.add('aggregate')
  }
  if (recipe.pivot) s.add('pivot')
  if (recipe.sort) s.add('order')
  if (recipe.limit !== DEFAULT_TRANSFORM_LIMIT) s.add('limit')
  return s
}

/** Output column names suitable for ORDER BY on the compiled query. */
function orderColumnOptions(
  recipe: TransformRecipe,
  columns: ColumnInfo[],
): string[] {
  if (recipe.aggregations.length > 0 || recipe.groupBy.length > 0) {
    const opts: string[] = []
    for (const ref of recipe.groupBy) {
      opts.push(parseColumnRef(ref, recipe.sourceAlias).column)
    }
    for (const agg of recipe.aggregations) {
      const alias = agg.alias.trim()
      if (alias) opts.push(alias)
    }
    return [...new Set(opts)]
  }
  if (recipe.columns.length > 0) {
    return [
      ...new Set(
        recipe.columns.map(
          (c) =>
            c.as?.trim() ||
            parseColumnRef(c.ref, recipe.sourceAlias).column,
        ),
      ),
    ]
  }
  return [
    ...new Set(
      columns.map(
        (c) => parseColumnRef(c.name, recipe.sourceAlias).column,
      ),
    ),
  ]
}

export default function TransformBuilder({
  recipe,
  columns,
  onChange,
  onPickSource,
  onHoverColumn,
}: Props) {
  const [opened, setOpened] = useState<Set<StepId>>(() => new Set())
  /** Empty `recipe.columns` means all unless this is true (explicit none/partial). */
  const [columnsSelectMode, setColumnsSelectMode] = useState(
    () => recipe.columns.length > 0,
  )
  const [columnSearch, setColumnSearch] = useState('')

  useEffect(() => {
    return () => onHoverColumn?.(null)
  }, [onHoverColumn])

  useEffect(() => {
    if (recipe.columns.length > 0) setColumnsSelectMode(true)
  }, [recipe.columns.length])

  const patch = (partial: Partial<TransformRecipe>) =>
    onChange({ ...recipe, ...partial })

  const active = (() => {
    const next = stepsFromRecipe(recipe)
    for (const id of opened) next.add(id)
    return next
  })()

  const openStep = (id: StepId) => {
    setOpened((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  const closeStep = (id: StepId) => {
    setOpened((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const selectedRefs = new Set(recipe.columns.map((c) => c.ref))
  const hasColumnSelection = columnsSelectMode

  const orderedColumnEntries = (() => {
    const entries = columns.map((col) => {
      const checked = !hasColumnSelection || selectedRefs.has(col.name)
      const rename =
        recipe.columns.find((c) => c.ref === col.name)?.as ?? ''
      return { col, checked, rename }
    })
    if (!hasColumnSelection) return entries
    return [
      ...entries.filter((e) => e.checked),
      ...entries.filter((e) => !e.checked),
    ]
  })()

  const columnSearchQ = columnSearch.trim().toLowerCase()
  const visibleColumnEntries = columnSearchQ
    ? orderedColumnEntries.filter(({ col, rename }) => {
        const { column: bare } = parseColumnRef(col.name, recipe.sourceAlias)
        return (
          bare.toLowerCase().includes(columnSearchQ) ||
          col.name.toLowerCase().includes(columnSearchQ) ||
          rename.toLowerCase().includes(columnSearchQ)
        )
      })
    : orderedColumnEntries

  const selectAllColumns = () => {
    setColumnsSelectMode(false)
    patch({ columns: [] })
  }

  const selectNoColumns = () => {
    setColumnsSelectMode(true)
    patch({ columns: [] })
  }

  const toggleColumn = (ref: string) => {
    if (selectedRefs.has(ref)) {
      patch({ columns: recipe.columns.filter((c) => c.ref !== ref) })
    } else {
      patch({ columns: [...recipe.columns, { ref }] })
    }
  }

  const setRename = (ref: string, asName: string) => {
    const next = recipe.columns.map((c) =>
      c.ref === ref ? { ...c, as: asName.trim() || undefined } : c,
    )
    patch({ columns: next })
  }

  const addJoin = () => {
    if (recipe.joins.length >= MAX_JOINS) return
    const alias = nextJoinAlias(recipe)
    const join: TransformJoin = {
      id: crypto.randomUUID(),
      type: 'inner',
      target: {
        database: recipe.source.database,
        schema: recipe.source.schema,
        name: '',
        kind: 'table',
      },
      alias,
      on: [
        {
          leftAlias: recipe.sourceAlias,
          leftColumn: '',
          rightAlias: alias,
          rightColumn: '',
        },
      ],
    }
    patch({ joins: [...recipe.joins, join] })
    openStep('joins')
  }

  const updateJoin = (id: string, next: TransformJoin) => {
    patch({
      joins: recipe.joins.map((j) => (j.id === id ? next : j)),
    })
  }

  const removeJoin = (id: string) => {
    patch({ joins: recipe.joins.filter((j) => j.id !== id) })
  }

  const addAgg = () => {
    const agg: Aggregation = {
      id: crypto.randomUUID(),
      fn: 'count',
      column: null,
      alias: `metric_${recipe.aggregations.length + 1}`,
    }
    patch({ aggregations: [...recipe.aggregations, agg] })
    openStep('aggregate')
  }

  const addFilter = () => {
    const first = columns.find((c) => isFacetable(c.type))
    if (!first) {
      openStep('filters')
      return
    }
    const f: ColumnFilter = {
      column: first.name,
      type: first.type as FacetableType,
      values: [],
    }
    patch({ filters: [...recipe.filters, f] })
    openStep('filters')
  }

  const enablePivot = () => {
    patch({
      pivot: {
        rowKeys: recipe.groupBy.slice(0, 1),
        pivotColumn: columns[0]?.name ?? '',
        valueColumn: columns[1]?.name ?? columns[0]?.name ?? '',
        agg: 'sum',
      },
    })
    openStep('pivot')
  }

  const enableOrder = () => {
    const opts = orderColumnOptions(recipe, columns)
    patch({
      sort: {
        column: opts[0] ?? '',
        direction: 'asc',
      },
    })
    openStep('order')
  }

  const removeStep = (id: StepId) => {
    closeStep(id)
    switch (id) {
      case 'joins':
        patch({ joins: [] })
        break
      case 'columns':
        patch({ columns: [] })
        setColumnsSelectMode(false)
        break
      case 'filters':
        patch({ filters: [] })
        break
      case 'aggregate':
        patch({ groupBy: [], aggregations: [] })
        break
      case 'pivot':
        patch({ pivot: null })
        break
      case 'order':
        patch({ sort: null })
        break
      case 'limit':
        patch({ limit: DEFAULT_TRANSFORM_LIMIT })
        break
    }
  }

  const addStep = (id: StepId) => {
    switch (id) {
      case 'joins':
        addJoin()
        break
      case 'columns':
        setColumnsSelectMode(false)
        openStep('columns')
        break
      case 'filters':
        addFilter()
        break
      case 'aggregate':
        addAgg()
        break
      case 'pivot':
        enablePivot()
        break
      case 'order':
        enableOrder()
        break
      case 'limit':
        openStep('limit')
        break
    }
  }

  const aliases = [recipe.sourceAlias, ...recipe.joins.map((j) => j.alias)]
  const colsForAlias = (alias: string) =>
    columns
      .filter((c) => parseColumnRef(c.name).alias === alias)
      .map((c) => parseColumnRef(c.name).column)

  const sortOptions = orderColumnOptions(recipe, columns)
  const availableSteps = ALL_STEPS.filter((id) => !active.has(id))

  return (
    <div className="transform-builder">
      <StepShell title="Source">
        <div className="tf-source-row">
          <span className="tf-mono" title={objectTitle(recipe.source)}>
            {objectTitle(recipe.source)}
          </span>
          <span className="kind-badge">{recipe.sourceAlias}</span>
          {onPickSource ? (
            <button type="button" className="btn-micro" onClick={onPickSource}>
              Change
            </button>
          ) : null}
        </div>
      </StepShell>

      {active.has('joins') ? (
        <StepShell
          title="Joins"
          meta={
            recipe.joins.length > 0 ? (
              <span className="tf-step-meta">{recipe.joins.length}</span>
            ) : null
          }
          actions={
            <button
              type="button"
              className="btn-micro"
              onClick={addJoin}
              disabled={recipe.joins.length >= MAX_JOINS}
            >
              Add
            </button>
          }
          onRemove={() => removeStep('joins')}
          removeTitle="Remove joins"
        >
          {recipe.joins.length === 0 ? (
            <div className="tf-empty">No joins yet</div>
          ) : (
            <div className="tf-stack">
              {recipe.joins.map((join) => (
                <JoinEditor
                  key={join.id}
                  join={join}
                  aliases={aliases}
                  colsForAlias={colsForAlias}
                  onChange={(j) => updateJoin(join.id, j)}
                  onRemove={() => removeJoin(join.id)}
                />
              ))}
            </div>
          )}
        </StepShell>
      ) : null}

      {active.has('columns') ? (
        <StepShell
          title="Columns"
          meta={
            <span className="tf-step-meta">
              {hasColumnSelection
                ? `${recipe.columns.length}/${columns.length}`
                : 'all'}
            </span>
          }
          actions={
            <>
              <button
                type="button"
                className="btn-micro"
                onClick={selectAllColumns}
                title="Include all columns"
                disabled={!hasColumnSelection}
              >
                All
              </button>
              <button
                type="button"
                className="btn-micro"
                onClick={selectNoColumns}
                title="Deselect all columns"
                disabled={hasColumnSelection && recipe.columns.length === 0}
              >
                None
              </button>
            </>
          }
          onRemove={() => removeStep('columns')}
          removeTitle="Remove columns step"
        >
          {!hasColumnSelection ? (
            <div className="tf-hint">Uncheck a column to start selecting</div>
          ) : null}
          <input
            className="input tf-search"
            type="search"
            placeholder="Find column…"
            value={columnSearch}
            onChange={(e) => setColumnSearch(e.target.value)}
            aria-label="Find column"
          />
          <div className="tf-list">
            {visibleColumnEntries.length === 0 ? (
              <div className="tf-empty tf-list-empty">No matching columns</div>
            ) : (
              visibleColumnEntries.map(({ col, checked, rename }) => {
                const ref = col.name
                const { alias, column: bare } = parseColumnRef(
                  ref,
                  recipe.sourceAlias,
                )
                return (
                  <div
                    key={ref}
                    className={`tf-list-row tf-col-row${checked ? ' on' : ''}${hasColumnSelection && !checked ? ' off' : ''}`}
                    onMouseEnter={() => onHoverColumn?.(ref)}
                    onMouseLeave={() => onHoverColumn?.(null)}
                  >
                    <label className="tf-col-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (!hasColumnSelection) {
                            patch({
                              columns: columns
                                .filter((c) => c.name !== ref)
                                .map((c) => ({ ref: c.name })),
                            })
                          } else {
                            toggleColumn(ref)
                          }
                        }}
                      />
                      <span className="kind-badge">{alias}</span>
                      <span className="tf-mono tf-col-name" title={ref}>
                        {bare}
                      </span>
                      <span className={`th-type type-${col.type}`}>
                        {col.type}
                      </span>
                    </label>
                    {checked && hasColumnSelection ? (
                      <label className="tf-col-as">
                        <span className="tf-col-as-label">as</span>
                        <input
                          className="input tf-rename"
                          placeholder={bare}
                          value={rename}
                          onChange={(e) => setRename(ref, e.target.value)}
                        />
                      </label>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
        </StepShell>
      ) : null}

      {active.has('filters') ? (
        <StepShell
          title="Filters"
          meta={
            recipe.filters.length > 0 ? (
              <span className="tf-step-meta">{recipe.filters.length}</span>
            ) : null
          }
          actions={
            <button type="button" className="btn-micro" onClick={addFilter}>
              Add
            </button>
          }
          onRemove={() => removeStep('filters')}
          removeTitle="Remove filters"
        >
          {recipe.filters.length === 0 ? (
            <div className="tf-empty">No filters yet</div>
          ) : (
            <div className="tf-stack">
              {recipe.filters.map((f, i) => (
                <FilterEditor
                  key={i}
                  filter={f}
                  columns={columns}
                  onChange={(next) => {
                    const filters = [...recipe.filters]
                    filters[i] = next
                    patch({ filters })
                  }}
                  onRemove={() =>
                    patch({
                      filters: recipe.filters.filter((_, j) => j !== i),
                    })
                  }
                />
              ))}
            </div>
          )}
        </StepShell>
      ) : null}

      {active.has('aggregate') ? (
        <StepShell
          title="Aggregate"
          meta={
            recipe.groupBy.length > 0 || recipe.aggregations.length > 0 ? (
              <span className="tf-step-meta">
                {recipe.groupBy.length}g · {recipe.aggregations.length}m
              </span>
            ) : null
          }
          actions={
            <button type="button" className="btn-micro" onClick={addAgg}>
              Add metric
            </button>
          }
          onRemove={() => removeStep('aggregate')}
          removeTitle="Remove aggregate"
        >
          <div className="tf-block">
            <div className="tf-block-label">Group by</div>
            <div className="tf-list tf-list-sm">
              {columns.map((c) => {
                const on = recipe.groupBy.includes(c.name)
                return (
                  <label
                    key={c.name}
                    className={`tf-list-row${on ? ' on' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        if (on) {
                          patch({
                            groupBy: recipe.groupBy.filter(
                              (g) => g !== c.name,
                            ),
                          })
                        } else {
                          patch({ groupBy: [...recipe.groupBy, c.name] })
                        }
                      }}
                    />
                    <span className="tf-mono tf-col-name" title={c.name}>
                      {c.name}
                    </span>
                    <span className={`th-type type-${c.type}`}>{c.type}</span>
                  </label>
                )
              })}
            </div>
          </div>
          {recipe.aggregations.length === 0 ? (
            <div className="tf-empty">No metrics yet</div>
          ) : (
            <div className="tf-stack">
              {recipe.aggregations.map((agg) => (
                <div key={agg.id} className="tf-item tf-agg-row">
                  <select
                    className="select"
                    value={agg.fn}
                    onChange={(e) => {
                      const fn = e.target.value as AggFn
                      patch({
                        aggregations: recipe.aggregations.map((a) =>
                          a.id === agg.id ? { ...a, fn } : a,
                        ),
                      })
                    }}
                  >
                    {AGG_FNS.map((fn) => (
                      <option key={fn} value={fn}>
                        {AGG_FN_LABELS[fn]}
                      </option>
                    ))}
                  </select>
                  <select
                    className="select"
                    value={agg.column ?? ''}
                    onChange={(e) =>
                      patch({
                        aggregations: recipe.aggregations.map((a) =>
                          a.id === agg.id
                            ? { ...a, column: e.target.value || null }
                            : a,
                        ),
                      })
                    }
                  >
                    <option value="">
                      {agg.fn === 'count' ? '* (all)' : '—'}
                    </option>
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    value={agg.alias}
                    onChange={(e) =>
                      patch({
                        aggregations: recipe.aggregations.map((a) =>
                          a.id === agg.id
                            ? { ...a, alias: e.target.value }
                            : a,
                        ),
                      })
                    }
                    placeholder="alias"
                  />
                  <button
                    type="button"
                    className="btn-micro btn-icon"
                    onClick={() =>
                      patch({
                        aggregations: recipe.aggregations.filter(
                          (a) => a.id !== agg.id,
                        ),
                      })
                    }
                    title="Remove metric"
                    aria-label="Remove metric"
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </StepShell>
      ) : null}

      {active.has('pivot') ? (
        <StepShell
          title="Pivot"
          onRemove={() => removeStep('pivot')}
          removeTitle="Remove pivot"
        >
          {recipe.pivot ? (
            <div className="tf-pivot">
              <label className="tf-field">
                <span className="tf-label">Row keys</span>
                <select
                  className="select"
                  multiple
                  size={3}
                  value={recipe.pivot.rowKeys}
                  onChange={(e) =>
                    patch({
                      pivot: {
                        ...recipe.pivot!,
                        rowKeys: [...e.target.selectedOptions].map(
                          (o) => o.value,
                        ),
                      },
                    })
                  }
                >
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="tf-field">
                <span className="tf-label">Pivot col</span>
                <select
                  className="select"
                  value={recipe.pivot.pivotColumn}
                  onChange={(e) =>
                    patch({
                      pivot: {
                        ...recipe.pivot!,
                        pivotColumn: e.target.value,
                      },
                    })
                  }
                >
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="tf-field">
                <span className="tf-label">Value col</span>
                <select
                  className="select"
                  value={recipe.pivot.valueColumn}
                  onChange={(e) =>
                    patch({
                      pivot: {
                        ...recipe.pivot!,
                        valueColumn: e.target.value,
                      },
                    })
                  }
                >
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="tf-field">
                <span className="tf-label">Agg</span>
                <select
                  className="select"
                  value={recipe.pivot.agg}
                  onChange={(e) =>
                    patch({
                      pivot: {
                        ...recipe.pivot!,
                        agg: e.target.value as AggFn,
                      },
                    })
                  }
                >
                  {AGG_FNS.map((fn) => (
                    <option key={fn} value={fn}>
                      {AGG_FN_LABELS[fn]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="tf-empty">Off</div>
          )}
        </StepShell>
      ) : null}

      {active.has('order') ? (
        <StepShell
          title="Order"
          onRemove={() => removeStep('order')}
          removeTitle="Remove order"
        >
          {sortOptions.length === 0 ? (
            <div className="tf-empty">No columns to order by</div>
          ) : (
            <div className="tf-order-row">
              <label className="tf-field tf-field-grow">
                <span className="tf-label">Column</span>
                <select
                  className="select"
                  value={
                    recipe.sort && sortOptions.includes(recipe.sort.column)
                      ? recipe.sort.column
                      : (sortOptions[0] ?? '')
                  }
                  onChange={(e) =>
                    patch({
                      sort: {
                        column: e.target.value,
                        direction: recipe.sort?.direction ?? 'asc',
                      },
                    })
                  }
                >
                  {sortOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="tf-field">
                <span className="tf-label">Dir</span>
                <select
                  className="select"
                  value={recipe.sort?.direction ?? 'asc'}
                  onChange={(e) =>
                    patch({
                      sort: {
                        column:
                          recipe.sort?.column &&
                          sortOptions.includes(recipe.sort.column)
                            ? recipe.sort.column
                            : (sortOptions[0] ?? ''),
                        direction: e.target.value as SortDirection,
                      },
                    })
                  }
                >
                  <option value="asc">asc</option>
                  <option value="desc">desc</option>
                </select>
              </label>
            </div>
          )}
        </StepShell>
      ) : null}

      {active.has('limit') ? (
        <StepShell
          title="Limit"
          onRemove={() => removeStep('limit')}
          removeTitle="Remove limit"
        >
          <label className="tf-field">
            <span className="tf-label">Rows</span>
            <input
              className="input tf-limit-input"
              type="number"
              min={1}
              max={5000}
              value={recipe.limit}
              onChange={(e) =>
                patch({
                  limit: Math.min(
                    5000,
                    Math.max(1, Number(e.target.value) || 1),
                  ),
                })
              }
            />
          </label>
        </StepShell>
      ) : null}

      {availableSteps.length > 0 ? (
        <div className="tf-add-steps">
          <span className="tf-add-steps-label">Add step</span>
          <div className="tf-add-steps-chips">
            {availableSteps.map((id) => (
              <button
                key={id}
                type="button"
                className="btn-micro"
                onClick={() => addStep(id)}
              >
                {STEP_LABELS[id]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StepShell({
  title,
  meta,
  actions,
  onRemove,
  removeTitle,
  children,
}: {
  title: string
  meta?: ReactNode
  actions?: ReactNode
  onRemove?: () => void
  removeTitle?: string
  children: ReactNode
}) {
  return (
    <section className="tf-step">
      <div className="tf-step-head">
        <span className="tf-step-title">
          {title}
          {meta}
        </span>
        <div className="tf-step-actions">
          {actions}
          {onRemove ? (
            <button
              type="button"
              className="btn-micro btn-icon"
              onClick={onRemove}
              title={removeTitle ?? `Remove ${title}`}
              aria-label={removeTitle ?? `Remove ${title}`}
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
      </div>
      <div className="tf-step-body">{children}</div>
    </section>
  )
}

function JoinEditor({
  join,
  aliases,
  colsForAlias,
  onChange,
  onRemove,
}: {
  join: TransformJoin
  aliases: string[]
  colsForAlias: (alias: string) => string[]
  onChange: (j: TransformJoin) => void
  onRemove: () => void
}) {
  const setTarget = (patch: Partial<SelectedObject>) => {
    onChange({ ...join, target: { ...join.target, ...patch } })
  }

  return (
    <div className="tf-item tf-join">
      <div className="tf-join-top">
        <select
          className="select"
          value={join.type}
          onChange={(e) =>
            onChange({ ...join, type: e.target.value as JoinType })
          }
        >
          {JOIN_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="kind-badge">{join.alias}</span>
        <button
          type="button"
          className="btn-micro btn-icon"
          onClick={onRemove}
          title="Remove join"
          aria-label="Remove join"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="tf-join-target">
        <input
          className="input"
          placeholder="database"
          value={join.target.database}
          onChange={(e) => setTarget({ database: e.target.value })}
        />
        <input
          className="input"
          placeholder="schema"
          value={join.target.schema}
          onChange={(e) => setTarget({ schema: e.target.value })}
        />
        <input
          className="input"
          placeholder="table"
          value={join.target.name}
          onChange={(e) => setTarget({ name: e.target.value })}
        />
        <select
          className="select"
          value={join.target.kind}
          onChange={(e) =>
            setTarget({ kind: e.target.value as 'table' | 'view' })
          }
        >
          <option value="table">table</option>
          <option value="view">view</option>
        </select>
      </div>
      {join.on.map((cond, i) => (
        <div key={i} className="tf-join-on">
          <select
            className="select"
            value={cond.leftAlias}
            onChange={(e) => {
              const on = [...join.on]
              on[i] = { ...cond, leftAlias: e.target.value }
              onChange({ ...join, on })
            }}
          >
            {aliases.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={cond.leftColumn}
            onChange={(e) => {
              const on = [...join.on]
              on[i] = { ...cond, leftColumn: e.target.value }
              onChange({ ...join, on })
            }}
          >
            <option value="">col</option>
            {colsForAlias(cond.leftAlias).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="tf-muted">=</span>
          <select
            className="select"
            value={cond.rightAlias}
            onChange={(e) => {
              const on = [...join.on]
              on[i] = { ...cond, rightAlias: e.target.value }
              onChange({ ...join, on })
            }}
          >
            {aliases.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={cond.rightColumn}
            onChange={(e) => {
              const on = [...join.on]
              on[i] = { ...cond, rightColumn: e.target.value }
              onChange({ ...join, on })
            }}
          >
            <option value="">col</option>
            {colsForAlias(cond.rightAlias).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button
        type="button"
        className="btn-micro"
        onClick={() =>
          onChange({
            ...join,
            on: [
              ...join.on,
              {
                leftAlias: aliases[0] ?? 't0',
                leftColumn: '',
                rightAlias: join.alias,
                rightColumn: '',
              },
            ],
          })
        }
      >
        Add ON
      </button>
    </div>
  )
}

function FilterEditor({
  filter,
  columns,
  onChange,
  onRemove,
}: {
  filter: ColumnFilter
  columns: ColumnInfo[]
  onChange: (f: ColumnFilter) => void
  onRemove: () => void
}) {
  const facetable = columns.filter((c) => isFacetable(c.type))
  return (
    <div className="tf-item tf-filter-row">
      <select
        className="select"
        value={filter.column}
        onChange={(e) => {
          const col = columns.find((c) => c.name === e.target.value)
          if (!col || !isFacetable(col.type)) return
          onChange({
            column: col.name,
            type: col.type,
            values: filter.values,
          })
        }}
      >
        {facetable.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      <input
        className="input"
        placeholder="values (comma-separated)"
        value={filter.values
          .filter((v) => v !== null)
          .map(String)
          .join(', ')}
        onChange={(e) => {
          const raw = e.target.value
          const parts = raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
          const values: ColumnFilter['values'] = parts.map((p) => {
            if (filter.type === 'number') {
              const n = Number(p)
              return Number.isFinite(n) ? n : p
            }
            return p
          })
          if (filter.values.includes(null)) values.push(null)
          onChange({ ...filter, values })
        }}
      />
      <label className="tf-check" title="Include NULL">
        <input
          type="checkbox"
          checked={filter.values.includes(null)}
          onChange={(e) => {
            const without = filter.values.filter((v) => v !== null)
            onChange({
              ...filter,
              values: e.target.checked ? [...without, null] : without,
            })
          }}
        />
        null
      </label>
      <button
        type="button"
        className="btn-micro btn-icon"
        onClick={onRemove}
        title="Remove filter"
        aria-label="Remove filter"
      >
        <CloseIcon />
      </button>
    </div>
  )
}
