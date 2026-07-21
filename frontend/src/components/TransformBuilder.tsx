import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  ColumnInfo,
  ColumnFilter,
  Connection,
  FacetableType,
  SortDirection,
} from '../types'
import { isFacetable, filterChipLabels, filterIsActive } from '../types'
import { objectTitle } from '../paths'
import {
  MAX_JOINS,
  nextJoinAlias,
  parseColumnRef,
  type AggFn,
  type Aggregation,
  type JoinType,
  type TransformJoin,
  type TransformRecipe,
  type TransformStepId,
} from '../transformations'
import { facetTargetFromRecipe, tableFiltersForTarget } from '../facetTarget'
import ColumnFilterPopover from './ColumnFilterPopover'
import ColumnSelect from './ColumnSelect'
import TablePicker from './TablePicker'
import { ChevronIcon, CheckIcon, CloseIcon, EyeIcon, EyeOffIcon, FilterIcon, ListAllIcon } from './TreeIcons'

type Props = {
  recipe: TransformRecipe
  columns: ColumnInfo[]
  connection: Connection
  onChange: (recipe: TransformRecipe) => void
  onHoverColumn?: (columnRef: string | null) => void
  /** Register expand/collapse-all controls for the Steps panel header. */
  onCollapseApi?: (api: TransformCollapseApi | null) => void
}

export type TransformCollapseApi = {
  expandAll: () => void
  collapseAll: () => void
  canExpand: boolean
  canCollapse: boolean
}

type StepId = TransformStepId

/** Source plus optional recipe steps — all collapsible shells. */
type ShellId = 'source' | StepId

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
}

const ALL_STEPS: StepId[] = [
  'joins',
  'columns',
  'filters',
  'aggregate',
  'pivot',
  'order',
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
  connection,
  onChange,
  onHoverColumn,
  onCollapseApi,
}: Props) {
  const [opened, setOpened] = useState<Set<StepId>>(() => new Set())
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const sourcePickRef = useRef<HTMLButtonElement>(null)
  /** Empty `recipe.columns` means all unless this is true (explicit none/partial). */
  const [columnsSelectMode, setColumnsSelectMode] = useState(
    () => recipe.columns.length > 0,
  )
  const [columnSearch, setColumnSearch] = useState('')
  /** Refs with the rename field open (even before an alias is typed). */
  const [renamingRefs, setRenamingRefs] = useState<Set<string>>(() => new Set())
  const [columnView, setColumnView] = useState<'all' | 'selected' | 'hidden'>(
    'all',
  )
  const [groupByView, setGroupByView] = useState<'all' | 'selected' | 'hidden'>(
    'all',
  )
  const [collapsedSteps, setCollapsedSteps] = useState<Set<ShellId>>(
    () => new Set(),
  )

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
    setCollapsedSteps((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
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

  const toggleStepCollapsed = (id: ShellId) => {
    setCollapsedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const shellProps = (id: ShellId) => ({
    collapsed: collapsedSteps.has(id),
    onToggleCollapsed: () => toggleStepCollapsed(id),
  })

  const stepDisabled = (id: StepId) =>
    (recipe.disabledSteps ?? []).includes(id)

  const toggleStepDisabled = (id: StepId) => {
    const cur = new Set(recipe.disabledSteps ?? [])
    if (cur.has(id)) cur.delete(id)
    else cur.add(id)
    patch({ disabledSteps: [...cur] })
  }

  const stepShellProps = (id: StepId) => ({
    ...shellProps(id),
    disabled: stepDisabled(id),
    onToggleDisabled: () => toggleStepDisabled(id),
  })

  const clearDisabled = (
    id: StepId,
    partial: Partial<TransformRecipe>,
  ): Partial<TransformRecipe> => ({
    ...partial,
    disabledSteps: (recipe.disabledSteps ?? []).filter((s) => s !== id),
  })

  const selectedRefs = new Set(recipe.columns.map((c) => c.ref))
  const hasColumnSelection = columnsSelectMode

  const columnEntries = columns.map((col) => {
    const checked = !hasColumnSelection || selectedRefs.has(col.name)
    const rename = recipe.columns.find((c) => c.ref === col.name)?.as ?? ''
    return { col, checked, rename }
  })

  const columnSearchQ = columnSearch.trim().toLowerCase()
  const visibleColumnEntries = columnEntries.filter(({ col, checked, rename }) => {
    if (columnView === 'selected' && !checked) return false
    if (columnView === 'hidden' && checked) return false
    if (!columnSearchQ) return true
    const { column: bare } = parseColumnRef(col.name, recipe.sourceAlias)
    return (
      bare.toLowerCase().includes(columnSearchQ) ||
      col.name.toLowerCase().includes(columnSearchQ) ||
      rename.toLowerCase().includes(columnSearchQ)
    )
  })

  const selectedCount = hasColumnSelection
    ? recipe.columns.length
    : columns.length
  const hiddenCount = hasColumnSelection
    ? columns.length - recipe.columns.length
    : 0
  const isVisibleInColumns = (name: string) =>
    !hasColumnSelection || selectedRefs.has(name)
  const visibleGroupByColumns = columns.filter((c) => {
    const inCols = isVisibleInColumns(c.name)
    if (groupByView === 'selected') return inCols
    if (groupByView === 'hidden') return !inCols
    return true
  })

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
    const trimmed = asName.trim()
    const next = recipe.columns.map((c) =>
      c.ref === ref ? { ...c, as: trimmed || undefined } : c,
    )
    patch({ columns: next })
  }

  const startRename = (ref: string) => {
    setRenamingRefs((prev) => {
      if (prev.has(ref)) return prev
      const next = new Set(prev)
      next.add(ref)
      return next
    })
  }

  const stopRename = (ref: string) => {
    setRenamingRefs((prev) => {
      if (!prev.has(ref)) return prev
      const next = new Set(prev)
      next.delete(ref)
      return next
    })
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
        patch(clearDisabled(id, { joins: [] }))
        break
      case 'columns':
        patch(clearDisabled(id, { columns: [] }))
        setColumnsSelectMode(false)
        break
      case 'filters':
        patch(clearDisabled(id, { filters: [] }))
        break
      case 'aggregate':
        patch(clearDisabled(id, { groupBy: [], aggregations: [] }))
        break
      case 'pivot':
        patch(clearDisabled(id, { pivot: null }))
        break
      case 'order':
        patch(clearDisabled(id, { sort: null }))
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
    }
  }

  const aliases = [recipe.sourceAlias, ...recipe.joins.map((j) => j.alias)]
  const columnsForAlias = (alias: string) =>
    columns
      .filter((c) => parseColumnRef(c.name).alias === alias)
      .map((c) => ({
        name: parseColumnRef(c.name).column,
        type: c.type,
      }))

  const sortOptions = orderColumnOptions(recipe, columns)
  const sortColumnInfos = sortOptions.map((name) => {
    const col = columns.find((c) => c.name === name)
    return { name, type: col?.type }
  })
  const availableSteps = ALL_STEPS.filter((id) => !active.has(id))
  const visibleShellIds: ShellId[] = [
    'source',
    ...ALL_STEPS.filter((id) => active.has(id)),
  ]
  const visibleShellKey = visibleShellIds.join('|')
  const allCollapsed =
    visibleShellIds.length > 0 &&
    visibleShellIds.every((id) => collapsedSteps.has(id))
  const noneCollapsed = visibleShellIds.every((id) => !collapsedSteps.has(id))

  useEffect(() => {
    if (!onCollapseApi) return
    const shells = visibleShellKey.split('|') as ShellId[]
    onCollapseApi({
      expandAll: () => setCollapsedSteps(new Set()),
      collapseAll: () => setCollapsedSteps(new Set(shells)),
      canExpand: !noneCollapsed,
      canCollapse: !allCollapsed,
    })
    return () => onCollapseApi(null)
  }, [onCollapseApi, allCollapsed, noneCollapsed, visibleShellKey])

  return (
    <div className="transform-builder">
      <StepShell title="Source" {...shellProps('source')}>
        <div className="tf-source-row">
          <button
            ref={sourcePickRef}
            type="button"
            className={`tf-join-pick-btn tf-source-pick${sourcePickerOpen ? ' open' : ''}`}
            onClick={() => setSourcePickerOpen((v) => !v)}
            title={objectTitle(recipe.source)}
            aria-expanded={sourcePickerOpen}
          >
            <span className="tf-mono tf-join-fqn">
              {objectTitle(recipe.source)}
            </span>
            <span className="kind-badge">{recipe.sourceAlias}</span>
          </button>
          <button
            type="button"
            className="btn-micro"
            onClick={() => setSourcePickerOpen((v) => !v)}
          >
            Change
          </button>
        </div>
        {sourcePickerOpen ? (
          <TablePicker
            connection={connection}
            value={recipe.source}
            anchorRef={sourcePickRef}
            onChange={(source) => {
              onChange({ ...recipe, source })
              setSourcePickerOpen(false)
            }}
            onClose={() => setSourcePickerOpen(false)}
          />
        ) : null}
      </StepShell>

      {active.has('joins') ? (
        <StepShell
          title="Joins"
          {...stepShellProps('joins')}
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
                  connection={connection}
                  aliases={aliases}
                  columnsForAlias={columnsForAlias}
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
          {...stepShellProps('columns')}
          actions={
            <>
              <div
                className="tf-col-views"
                role="tablist"
                aria-label="Column list"
              >
                <ColumnListViewButtons
                  view={columnView}
                  onChange={setColumnView}
                  allCount={columns.length}
                  selectedCount={selectedCount}
                  hiddenCount={hiddenCount}
                />
              </div>
              <button
                type="button"
                className="btn-micro btn-icon"
                onClick={selectAllColumns}
                title="Select all columns"
                aria-label="Select all columns"
                disabled={!hasColumnSelection}
              >
                <CheckIcon />
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
              <div className="tf-empty tf-list-empty">
                {columnSearchQ
                  ? 'No matching columns'
                  : columnView === 'selected'
                    ? 'No selected columns'
                    : columnView === 'hidden'
                      ? 'No hidden columns'
                      : 'No columns'}
              </div>
            ) : (
              visibleColumnEntries.map(({ col, checked, rename }) => {
                const ref = col.name
                const { alias, column: bare } = parseColumnRef(
                  ref,
                  recipe.sourceAlias,
                )
                const renaming = renamingRefs.has(ref)
                const showRenameInput =
                  checked && hasColumnSelection && renaming
                return (
                  <div
                    key={ref}
                    className={`tf-list-row tf-col-row${checked ? ' on' : ''}${hasColumnSelection && !checked ? ' off' : ''}`}
                    onMouseEnter={() => onHoverColumn?.(ref)}
                    onMouseLeave={() => onHoverColumn?.(null)}
                  >
                    <div className="tf-col-check">
                      <label className="tf-col-check-main">
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
                              stopRename(ref)
                            }
                          }}
                        />
                        <span className="kind-badge">{alias}</span>
                        <span className="tf-mono tf-col-name" title={ref}>
                          {bare}
                        </span>
                      </label>
                      {checked &&
                      hasColumnSelection &&
                      rename &&
                      !renaming ? (
                        <button
                          type="button"
                          className="tf-col-alias"
                          title="Edit alias"
                          aria-label={`Edit alias for ${bare}`}
                          onClick={() => startRename(ref)}
                        >
                          → {rename}
                        </button>
                      ) : null}
                      {checked &&
                      hasColumnSelection &&
                      !rename &&
                      !renaming ? (
                        <button
                          type="button"
                          className="btn-micro tf-col-rename-btn"
                          title="Rename column"
                          aria-label={`Rename ${bare}`}
                          onClick={() => startRename(ref)}
                        >
                          as
                        </button>
                      ) : null}
                      <span className={`th-type type-${col.type}`}>
                        {col.type}
                      </span>
                    </div>
                    {showRenameInput ? (
                      <label className="tf-col-as">
                        <span className="tf-col-as-label">as</span>
                        <input
                          className="input tf-rename"
                          placeholder={bare}
                          value={rename}
                          autoFocus
                          onChange={(e) => setRename(ref, e.target.value)}
                          onBlur={() => stopRename(ref)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              stopRename(ref)
                              ;(e.target as HTMLInputElement).blur()
                            }
                          }}
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
          {...stepShellProps('filters')}
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
                  connection={connection}
                  recipe={recipe}
                  allFilters={recipe.filters}
                  onChange={(next) => {
                    if (Array.isArray(next)) {
                      const column = f.column
                      patch({
                        filters: [
                          ...recipe.filters.filter((x) => x.column !== column),
                          ...next,
                        ],
                      })
                      return
                    }
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
          {...stepShellProps('aggregate')}
          meta={
            recipe.groupBy.length > 0 || recipe.aggregations.length > 0 ? (
              <span className="tf-step-meta">
                {recipe.groupBy.length}g · {recipe.aggregations.length}m
              </span>
            ) : null
          }
          actions={
            <>
              <div
                className="tf-col-views"
                role="tablist"
                aria-label="Group by list"
              >
                <ColumnListViewButtons
                  view={groupByView}
                  onChange={setGroupByView}
                  allCount={columns.length}
                  selectedCount={selectedCount}
                  hiddenCount={hiddenCount}
                  labels={{
                    all: 'All',
                    selected: 'Visible in Columns',
                    hidden: 'Hidden in Columns',
                  }}
                />
              </div>
              <button type="button" className="btn-micro" onClick={addAgg}>
                Add metric
              </button>
            </>
          }
          onRemove={() => removeStep('aggregate')}
          removeTitle="Remove aggregate"
        >
          <div className="tf-block">
            <div className="tf-block-label">Group by</div>
            <div className="tf-list tf-list-sm">
              {visibleGroupByColumns.length === 0 ? (
                <div className="tf-empty tf-list-empty">
                  {groupByView === 'selected'
                    ? 'No columns visible in Columns'
                    : groupByView === 'hidden'
                      ? 'No columns hidden in Columns'
                      : 'No columns'}
                </div>
              ) : (
                visibleGroupByColumns.map((c) => {
                  const on = recipe.groupBy.includes(c.name)
                  const fromColumns = isVisibleInColumns(c.name)
                  return (
                    <label
                      key={c.name}
                      className={`tf-list-row${on ? ' on' : ''}${fromColumns && hasColumnSelection ? ' from-cols' : ''}`}
                      title={
                        fromColumns && hasColumnSelection
                          ? `${c.name} — visible in Columns`
                          : c.name
                      }
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
                })
              )}
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
                  <ColumnSelect
                    columns={columns}
                    value={agg.column ?? ''}
                    emptyOption={{
                      value: '',
                      label: agg.fn === 'count' ? '* (all)' : '—',
                    }}
                    aria-label="Aggregation column"
                    onChange={(name) =>
                      patch({
                        aggregations: recipe.aggregations.map((a) =>
                          a.id === agg.id
                            ? { ...a, column: name || null }
                            : a,
                        ),
                      })
                    }
                  />
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
          {...stepShellProps('pivot')}
          onRemove={() => removeStep('pivot')}
          removeTitle="Remove pivot"
        >
          {recipe.pivot ? (
            <div className="tf-pivot">
              <div className="tf-block">
                <div className="tf-block-label">Row keys</div>
                <div className="tf-list tf-list-sm">
                  {columns.map((c) => {
                    const on = recipe.pivot!.rowKeys.includes(c.name)
                    const fromColumns =
                      hasColumnSelection && selectedRefs.has(c.name)
                    return (
                      <label
                        key={c.name}
                        className={`tf-list-row${on ? ' on' : ''}${fromColumns ? ' from-cols' : ''}`}
                        title={
                          fromColumns
                            ? `${c.name} — selected in Columns`
                            : c.name
                        }
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            const rowKeys = on
                              ? recipe.pivot!.rowKeys.filter(
                                  (k) => k !== c.name,
                                )
                              : [...recipe.pivot!.rowKeys, c.name]
                            patch({
                              pivot: { ...recipe.pivot!, rowKeys },
                            })
                          }}
                        />
                        <span className="tf-mono tf-col-name" title={c.name}>
                          {c.name}
                        </span>
                        <span className={`th-type type-${c.type}`}>
                          {c.type}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <label className="tf-field">
                <span className="tf-label">Pivot col</span>
                <ColumnSelect
                  columns={columns}
                  value={recipe.pivot.pivotColumn}
                  aria-label="Pivot column"
                  onChange={(name) =>
                    patch({
                      pivot: {
                        ...recipe.pivot!,
                        pivotColumn: name,
                      },
                    })
                  }
                />
              </label>
              <label className="tf-field">
                <span className="tf-label">Value col</span>
                <ColumnSelect
                  columns={columns}
                  value={recipe.pivot.valueColumn}
                  aria-label="Value column"
                  onChange={(name) =>
                    patch({
                      pivot: {
                        ...recipe.pivot!,
                        valueColumn: name,
                      },
                    })
                  }
                />
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
          {...stepShellProps('order')}
          onRemove={() => removeStep('order')}
          removeTitle="Remove order"
        >
          {sortOptions.length === 0 ? (
            <div className="tf-empty">No columns to order by</div>
          ) : (
            <div className="tf-order-row">
              <label className="tf-field tf-field-grow">
                <span className="tf-label">Column</span>
                <ColumnSelect
                  columns={sortColumnInfos}
                  value={
                    recipe.sort && sortOptions.includes(recipe.sort.column)
                      ? recipe.sort.column
                      : (sortOptions[0] ?? '')
                  }
                  aria-label="Order by column"
                  onChange={(name) =>
                    patch({
                      sort: {
                        column: name,
                        direction: recipe.sort?.direction ?? 'asc',
                      },
                    })
                  }
                />
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

function ColumnListViewButtons({
  view,
  onChange,
  allCount,
  selectedCount,
  hiddenCount,
  labels = {
    all: 'All',
    selected: 'Selected',
    hidden: 'Hidden',
  },
}: {
  view: 'all' | 'selected' | 'hidden'
  onChange: (view: 'all' | 'selected' | 'hidden') => void
  allCount: number
  selectedCount: number
  hiddenCount: number
  labels?: {
    all: string
    selected: string
    hidden: string
  }
}) {
  return (
    <>
      {(
        [
          {
            id: 'all' as const,
            label: labels.all,
            count: allCount,
            icon: <ListAllIcon />,
          },
          {
            id: 'selected' as const,
            label: labels.selected,
            count: selectedCount,
            icon: <EyeIcon />,
          },
          {
            id: 'hidden' as const,
            label: labels.hidden,
            count: hiddenCount,
            icon: <EyeOffIcon />,
          },
        ] as const
      ).map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={view === v.id}
          className={`btn-micro tf-col-view-btn${view === v.id ? ' open' : ''}`}
          title={`${v.label} (${v.count})`}
          aria-label={`${v.label}, ${v.count}`}
          onClick={() => onChange(v.id)}
        >
          {v.icon}
          <span className="tf-col-view-count">{v.count}</span>
        </button>
      ))}
    </>
  )
}

function StepShell({
  title,
  meta,
  actions,
  collapsed = false,
  onToggleCollapsed,
  disabled = false,
  onToggleDisabled,
  onRemove,
  removeTitle,
  children,
}: {
  title: string
  meta?: ReactNode
  actions?: ReactNode
  collapsed?: boolean
  onToggleCollapsed?: () => void
  disabled?: boolean
  onToggleDisabled?: () => void
  onRemove?: () => void
  removeTitle?: string
  children: ReactNode
}) {
  return (
    <section
      className={`tf-step${collapsed ? ' collapsed' : ''}${disabled ? ' disabled' : ''}`}
    >
      <div className="tf-step-head">
        {onToggleDisabled ? (
          <button
            type="button"
            className={`btn-micro btn-icon tf-step-disable${disabled ? ' active' : ''}`}
            onClick={onToggleDisabled}
            title={disabled ? `Enable ${title}` : `Disable ${title}`}
            aria-label={disabled ? `Enable ${title}` : `Disable ${title}`}
            aria-pressed={disabled}
          >
            {disabled ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        ) : null}
        <button
          type="button"
          className="tf-step-toggle"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          <ChevronIcon open={!collapsed} />
          <span className="tf-step-title">
            {title}
            {meta}
          </span>
        </button>
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
      {collapsed ? null : <div className="tf-step-body">{children}</div>}
    </section>
  )
}

function JoinEditor({
  join,
  connection,
  aliases,
  columnsForAlias,
  onChange,
  onRemove,
}: {
  join: TransformJoin
  connection: Connection
  aliases: string[]
  columnsForAlias: (alias: string) => { name: string; type: ColumnInfo['type'] }[]
  onChange: (j: TransformJoin) => void
  onRemove: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickRef = useRef<HTMLButtonElement>(null)
  const hasTable = Boolean(join.target.name.trim())

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

      <div className="tf-join-target-picker">
        <button
          ref={pickRef}
          type="button"
          className={`tf-join-pick-btn${pickerOpen ? ' open' : ''}${hasTable ? '' : ' empty'}`}
          onClick={() => setPickerOpen((v) => !v)}
          title={hasTable ? objectTitle(join.target) : 'Pick table or view'}
          aria-expanded={pickerOpen}
        >
          {hasTable ? (
            <>
              <span className="tf-mono tf-join-fqn">
                {objectTitle(join.target)}
              </span>
              <span className="kind-badge">{join.target.kind}</span>
            </>
          ) : (
            <span className="tf-muted">Pick table / view…</span>
          )}
        </button>
        {pickerOpen ? (
          <TablePicker
            connection={connection}
            value={join.target}
            anchorRef={pickRef}
            onChange={(target) => onChange({ ...join, target })}
            onClose={() => setPickerOpen(false)}
          />
        ) : null}
      </div>

      {join.on.map((cond, i) => (
        <div key={i} className="tf-join-on">
          <select
            className="select"
            value={cond.leftAlias}
            onChange={(e) => {
              const on = [...join.on]
              on[i] = { ...cond, leftAlias: e.target.value, leftColumn: '' }
              onChange({ ...join, on })
            }}
          >
            {aliases.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <ColumnSelect
            columns={columnsForAlias(cond.leftAlias)}
            value={cond.leftColumn}
            placeholder="col"
            incomplete={!cond.leftColumn}
            aria-label="Left join column"
            onChange={(name) => {
              const on = [...join.on]
              on[i] = { ...cond, leftColumn: name }
              onChange({ ...join, on })
            }}
          />
          <span className="tf-muted">=</span>
          <select
            className="select"
            value={cond.rightAlias}
            onChange={(e) => {
              const on = [...join.on]
              on[i] = { ...cond, rightAlias: e.target.value, rightColumn: '' }
              onChange({ ...join, on })
            }}
          >
            {aliases.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <ColumnSelect
            columns={columnsForAlias(cond.rightAlias)}
            value={cond.rightColumn}
            placeholder="col"
            incomplete={!cond.rightColumn}
            aria-label="Right join column"
            onChange={(name) => {
              const on = [...join.on]
              on[i] = { ...cond, rightColumn: name }
              onChange({ ...join, on })
            }}
          />
          <button
            type="button"
            className="btn-micro btn-icon"
            onClick={() =>
              onChange({
                ...join,
                on: join.on.filter((_, j) => j !== i),
              })
            }
            title="Remove ON"
            aria-label="Remove ON condition"
          >
            <CloseIcon />
          </button>
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
  connection,
  recipe,
  allFilters,
  onChange,
  onRemove,
}: {
  filter: ColumnFilter
  columns: ColumnInfo[]
  connection: Connection
  recipe: TransformRecipe
  allFilters: ColumnFilter[]
  onChange: (f: ColumnFilter | ColumnFilter[]) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const editAnchorRef = useRef<HTMLDivElement>(null)
  const facetable = columns.filter((c) => isFacetable(c.type))
  const colMeta = columns.find((c) => c.name === filter.column)
  const target = colMeta
    ? facetTargetFromRecipe(filter.column, colMeta.type, recipe, columns)
    : null

  const tableFilters: ColumnFilter[] =
    target == null ? [] : tableFiltersForTarget(recipe, target)

  const chips = filterChipLabels(filter)
  const active = filterIsActive(filter)
  const columnFilters = allFilters.filter((f) => f.column === filter.column)

  return (
    <div className="tf-item tf-filter-row">
      <ColumnSelect
        columns={facetable}
        value={filter.column}
        aria-label="Filter column"
        onChange={(name) => {
          const col = columns.find((c) => c.name === name)
          if (!col || !isFacetable(col.type)) return
          onChange({
            column: col.name,
            type: col.type,
            values: [],
            op: 'in',
          })
          setOpen(false)
        }}
      />

      <div className="tf-filter-values">
        {!active ? (
          <span className="tf-muted">No condition</span>
        ) : (
          <div className="tf-filter-chips">
            {chips.map((label) => (
              <span key={label} className="tf-filter-chip">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="tf-filter-edit-wrap" ref={editAnchorRef}>
        <button
          type="button"
          className={`btn-micro btn-icon${open ? ' open' : ''}${active ? ' active' : ''}`}
          onClick={() => setOpen((v) => !v)}
          disabled={!target}
          title="Edit filter"
          aria-label="Edit filter"
          aria-expanded={open}
        >
          <FilterIcon />
        </button>
        {open && target ? (
          <ColumnFilterPopover
            connection={connection}
            database={target.object.database}
            schema={target.object.schema}
            table={target.object.name}
            column={target.bareColumn}
            type={target.type}
            appliedFilters={columnFilters.map((f) => ({
              column: target.bareColumn,
              type: f.type,
              values: f.values,
              op: f.op,
            }))}
            filters={tableFilters}
            anchorRef={editAnchorRef}
            onApply={(next) => {
              onChange(
                next.map((f) => ({
                  column: filter.column,
                  type: filter.type,
                  values: f.values,
                  op: f.op ?? 'in',
                })),
              )
              setOpen(false)
            }}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </div>

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
