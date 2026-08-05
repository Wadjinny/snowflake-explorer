import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
  useLocation,
} from 'react-router'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { previewObject } from '../api/snowflake'
import ColumnPicker from '../components/ColumnPicker'
import DataGrid from '../components/DataGrid'
import DetailInspector, {
  type GridSelection,
} from '../components/DetailInspector'
import Spinner from '../components/Spinner'
import {
  BookmarkIcon,
  ColumnsIcon,
  RefreshIcon,
  SidebarToggleIcon,
  StarIcon,
  TransformIcon,
} from '../components/TreeIcons'
import { PREVIEW_STALE_MS, queryGcTime } from '../queryStale'
import { useBrowseTabs } from '../browseTabsContext'
import { useConnections } from '../connections'
import { useDialog } from '../dialog'
import { useFavorites } from '../favoritesContext'
import {
  makeSelectionTab,
  selectionTabKey,
  type OpenTab,
} from '../openTabs'
import {
  BROWSE_PAGE_SIZE_MAX,
  getDefaultPageSize,
  setDefaultPageSize,
} from '../pageSizePrefs'
import {
  filtersParamEqual,
  objectKeyFrom,
  objectPathFrom,
  objectTitle,
  parseFiltersParam,
} from '../paths'
import {
  defaultSelectionName,
  selectionPath,
} from '../selections'
import { useSelections } from '../selectionsContext'
import { transformPath } from '../transformTabs'
import { useTransformTabs } from '../transformTabsContext'
import type {
  ColumnFilter,
  ObjectKind,
  SelectedObject,
  SortSpec,
} from '../types'
import { filterChipLabels, filterIsActive, normalizeColumnFilter, normalizeFilterOp } from '../types'
import { useWorkspaceTabs } from '../workspaceTabsContext'
import type { WorkspaceOutletContext } from '../workspaceOutlet'

const PAGE_SIZES = [50, 100, 200, 500, 1000]
const DATA_FILTER_INFO_MAX = 5

function formatFilterInfoLabel(filter: ColumnFilter): string {
  const chips = filterChipLabels(filter)
  if (chips.length === 0) return normalizeFilterOp(filter.op)
  if (chips.length === 1) return chips[0]!
  if (chips.length === 2) return chips.join(', ')
  return `${chips[0]}, ${chips[1]} +${chips.length - 2}`
}

function useSelectedFromUrl(): SelectedObject | null {
  const params = useParams()
  const [search] = useSearchParams()
  return useMemo(() => {
    const database = params.database
    const schema = params.schema
    const name = params.name
    if (!database || !schema || !name) return null
    const kindParam = search.get('kind')
    const kind: ObjectKind = kindParam === 'view' ? 'view' : 'table'
    return { database, schema, name, kind }
  }, [params.database, params.schema, params.name, search])
}

export default function Explorer() {
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const [searchParams] = useSearchParams()
  const dialog = useDialog()
  const { active } = useConnections()
  const { isFavorite, toggle: toggleFavorite } = useFavorites()
  const {
    selections,
    add: addSelection,
    update: updateSelection,
    rename: renameSelection,
  } = useSelections()
  const { openDraft } = useTransformTabs()
  const { renameBrowseHandle } = useWorkspaceTabs()
  const {
    tabs,
    setTabs,
    updateTab,
    upsertObject,
  } = useBrowseTabs()
  const { objectsCollapsed, toggleObjectsPanel } =
    useOutletContext<WorkspaceOutletContext>()
  const urlObject = useSelectedFromUrl()
  const urlSelectionId = params.selectionId ?? null
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [hoverColumn, setHoverColumn] = useState<string | null>(null)
  const [gridSelection, setGridSelection] = useState<GridSelection | null>(
    null,
  )
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const inspectorPanelRef = usePanelRef()
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const scrollPosByTab = useRef(
    new Map<string, { top: number; left: number }>(),
  )
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeKey = urlSelectionId
    ? selectionTabKey(urlSelectionId)
    : urlObject
      ? objectKeyFrom(urlObject)
      : null
  const activeTab = tabs.find((t) => t.key === activeKey) ?? null
  const filtersSearchRaw = searchParams.get('f')
  const urlHasFiltersParam = searchParams.has('f')
  const isSelectionRoute = Boolean(urlSelectionId)

  // Clear scroll state when connection changes
  useEffect(() => {
    scrollPosByTab.current.clear()
    if (scrollSaveTimer.current) {
      clearTimeout(scrollSaveTimer.current)
      scrollSaveTimer.current = null
    }
  }, [active?.id])

  useEffect(() => {
    return () => {
      if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current)
    }
  }, [])

  // Seed live scroll map from persisted tab state (first time we see a key).
  useEffect(() => {
    for (const t of tabs) {
      if (scrollPosByTab.current.has(t.key)) continue
      scrollPosByTab.current.set(t.key, {
        top: t.scrollTop,
        left: t.scrollLeft,
      })
    }
  }, [tabs])

  // URL object → ensure open as tab (browse routes only)
  useEffect(() => {
    if (!urlObject || !active?.id || isSelectionRoute) return
    upsertObject(urlObject)
  }, [urlObject, active?.id, isSelectionRoute, upsertObject])

  // URL selection → ensure open as tab / redirect if missing
  useEffect(() => {
    if (!urlSelectionId || !active?.id) return
    const sel = selections.find((s) => s.id === urlSelectionId)
    if (!sel) {
      setTabs((prev) =>
        prev.filter((t) => t.key !== selectionTabKey(urlSelectionId)),
      )
      navigate('/', { replace: true })
      return
    }
    setTabs((prev) => {
      const key = selectionTabKey(sel.id)
      const exists = prev.find((t) => t.key === key)
      if (!exists) return [...prev, makeSelectionTab(sel)]
      if (exists.selectionName !== sel.name) {
        return prev.map((t) =>
          t.key === key ? { ...t, selectionName: sel.name } : t,
        )
      }
      return prev
    })
  }, [urlSelectionId, active?.id, selections, navigate, setTabs])

  // URL `f` → active tab filters (object routes only, when the param is present).
  useEffect(() => {
    if (!activeKey || !urlHasFiltersParam || isSelectionRoute) return
    if (activeTab?.selectionId) return
    const parsed = parseFiltersParam(filtersSearchRaw)
    setTabs((prev) =>
      prev.map((t) => {
        if (t.key !== activeKey) return t
        if (filtersParamEqual(t.filters, parsed)) return t
        return { ...t, filters: parsed, offset: 0 }
      }),
    )
  }, [
    activeKey,
    activeTab?.selectionId,
    urlHasFiltersParam,
    filtersSearchRaw,
    isSelectionRoute,
    setTabs,
  ])

  // Active tab filters → URL (object browse only; selection tabs keep /s/:id).
  useEffect(() => {
    if (isSelectionRoute) return
    if (!urlObject || !activeTab || activeTab.key !== activeKey) return
    if (activeTab.selectionId) return
    const desired = objectPathFrom(urlObject, { filters: activeTab.filters })
    const current = `${location.pathname}${location.search}`
    if (desired === current) return
    navigate(desired, { replace: true })
  }, [
    activeKey,
    activeTab,
    isSelectionRoute,
    location.pathname,
    location.search,
    navigate,
    urlObject,
  ])

  const selected = activeTab?.object ?? urlObject
  const filters = activeTab?.filters ?? []
  const sort = activeTab?.sort ?? null
  const limit = activeTab?.limit ?? getDefaultPageSize(BROWSE_PAGE_SIZE_MAX)
  const offset = activeTab?.offset ?? 0
  const hiddenColumns = activeTab?.hiddenColumns ?? []
  const columnOrder = activeTab?.columnOrder ?? []
  const columnWidths = activeTab?.columnWidths ?? {}
  const linkedSelectionId = activeTab?.selectionId ?? urlSelectionId
  const selectionDirty = Boolean(activeTab?.selectionId && activeTab.dirty)
  const selectionName = activeTab?.selectionName

  const updateActiveTab = (patch: Partial<OpenTab>) => {
    if (!activeKey) return
    updateTab(activeKey, patch)
  }

  const onFiltersChange = (next: ColumnFilter[]) => {
    updateActiveTab({
      filters: next.map(normalizeColumnFilter),
      offset: 0,
    })
  }

  const onSortChange = (next: SortSpec | null) => {
    updateActiveTab({ sort: next, offset: 0 })
  }

  const saveCurrentSelection = async () => {
    if (!selected || !activeKey) return

    if (activeTab?.selectionId) {
      if (!activeTab.dirty) return
      updateSelection(activeTab.selectionId, {
        name: activeTab.selectionName ?? undefined,
        object: selected,
        filters,
        sort,
        hiddenColumns,
        columnOrder,
        columnWidths,
        limit,
      })
      updateTab(activeKey, { dirty: false })
      return
    }

    const suggested = defaultSelectionName(selected, filters, sort)
    const name = await dialog.prompt({
      title: 'Save selection',
      message: 'Name for the Selections list.',
      defaultValue: suggested,
      confirmLabel: 'Save',
    })
    if (name === null) return
    const created = addSelection({
      name: name.trim() || suggested,
      object: selected,
      filters,
      sort,
      hiddenColumns,
      columnOrder,
      columnWidths,
      limit,
    })
    if (!created) return
    const newKey = selectionTabKey(created.id)
    setTabs((prev) =>
      prev.map((t) =>
        t.key === activeKey
          ? {
              ...t,
              key: newKey,
              selectionId: created.id,
              selectionName: created.name,
              dirty: false,
            }
          : t,
      ),
    )
    renameBrowseHandle(activeKey, newKey)
    navigate(selectionPath(created.id))
  }

  const onRenameActiveSelection = async () => {
    if (!activeTab?.selectionId) return
    const current = activeTab.selectionName ?? ''
    const name = await dialog.prompt({
      title: 'Rename selection',
      defaultValue: current,
      confirmLabel: 'Rename',
    })
    if (name === null) return
    const trimmed = name.trim()
    if (!trimmed) return
    renameSelection(activeTab.selectionId, trimmed)
    updateActiveTab({ selectionName: trimmed })
  }

  const newTransform = () => {
    if (!selected) return
    const tab = openDraft(selected)
    if (tab) navigate(transformPath(tab.id))
  }

  useEffect(() => {
    setColumnsOpen(false)
    setHoverColumn(null)
    setGridSelection(null)
  }, [activeKey])

  const filterKey = JSON.stringify(filters)
  const sortKey = sort ? `${sort.column}:${sort.direction}` : ''
  useEffect(() => {
    setGridSelection(null)
  }, [offset, limit, sortKey, activeKey, filterKey])

  const onGridSelectionChange = (sel: GridSelection) => {
    setGridSelection(sel)
    setInspectorOpen(true)
    const panel = inspectorPanelRef.current
    if (panel?.isCollapsed()) panel.expand()
  }

  const closeInspector = () => {
    setGridSelection(null)
    setInspectorOpen(false)
    inspectorPanelRef.current?.collapse()
  }

  useEffect(() => {
    if (!inspectorOpen && !gridSelection) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (columnsOpen) return
      e.preventDefault()
      closeInspector()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspectorOpen, gridSelection, columnsOpen])

  useEffect(() => {
    if (!columnsOpen) setHoverColumn(null)
  }, [columnsOpen])

  const preview = useQuery({
    queryKey: [
      'preview',
      active?.id,
      selected?.database,
      selected?.schema,
      selected?.name,
      limit,
      offset,
      filters,
      sort,
    ],
    queryFn: () => {
      if (!active || !selected) throw new Error('No selection')
      return previewObject(
        active,
        selected.database,
        selected.schema,
        selected.name,
        limit,
        offset,
        filters,
        sort,
      )
    },
    enabled: Boolean(active && selected),
    staleTime: PREVIEW_STALE_MS,
    gcTime: queryGcTime(PREVIEW_STALE_MS),
    placeholderData: (previousData, previousQuery) => {
      const prevKey = previousQuery?.queryKey
      if (
        previousData &&
        prevKey?.[1] === active?.id &&
        prevKey?.[2] === selected?.database &&
        prevKey?.[3] === selected?.schema &&
        prevKey?.[4] === selected?.name
      ) {
        return previousData
      }
      return undefined
    },
  })

  useLayoutEffect(() => {
    const el = gridScrollRef.current
    if (!el || !activeKey) return
    const pos = scrollPosByTab.current.get(activeKey) ?? { top: 0, left: 0 }
    el.scrollTop = pos.top
    el.scrollLeft = pos.left
  }, [activeKey])

  useLayoutEffect(() => {
    if (!preview.data || !activeKey) return
    const el = gridScrollRef.current
    if (!el) return
    const pos = scrollPosByTab.current.get(activeKey) ?? { top: 0, left: 0 }
    el.scrollTop = pos.top
    el.scrollLeft = pos.left
  }, [activeKey, preview.data])

  const onGridScroll = () => {
    const el = gridScrollRef.current
    if (!el || !activeKey) return
    const pos = { top: el.scrollTop, left: el.scrollLeft }
    scrollPosByTab.current.set(activeKey, pos)
    if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current)
    const key = activeKey
    scrollSaveTimer.current = setTimeout(() => {
      updateTab(key, { scrollTop: pos.top, scrollLeft: pos.left })
    }, 150)
  }

  const rowCount = preview.data?.rows.length ?? 0
  const total = preview.data?.total ?? 0
  const from = rowCount === 0 ? 0 : offset + 1
  const to = offset + rowCount
  const canPrev = offset > 0
  const canNext = total < 0 ? rowCount >= limit : offset + rowCount < total
  const pageSizeOptions = PAGE_SIZES.includes(limit)
    ? PAGE_SIZES
    : [...PAGE_SIZES, limit].sort((a, b) => a - b)
  const filterCount = filters.filter(filterIsActive).length
  const activeFilters = filters.filter(filterIsActive)
  const visibleFilters = activeFilters.slice(0, DATA_FILTER_INFO_MAX)
  const hiddenFilterCount = Math.max(
    0,
    activeFilters.length - DATA_FILTER_INFO_MAX,
  )
  const totalLabel =
    total < 0 ? '?' : total.toLocaleString()
  const selectedFavorite = selected
    ? ({
        kind: 'object' as const,
        database: selected.database,
        schema: selected.schema,
        name: selected.name,
        objectKind: selected.kind,
      })
    : null
  const selectedIsFavorite = selectedFavorite
    ? isFavorite(selectedFavorite)
    : false
  const isLinkedSelection = Boolean(linkedSelectionId && selectionName)
  const bookmarkTitle = isLinkedSelection
    ? selectionDirty
      ? 'Update saved selection'
      : 'Selection saved'
    : 'Save selection view'
  const bookmarkDisabled = isLinkedSelection && !selectionDirty

  return (
    <div className="panel">
      <div className="panel-header">
        {objectsCollapsed ? (
          <button
            type="button"
            className="btn-micro btn-icon"
            onClick={toggleObjectsPanel}
            title="Expand objects panel"
            aria-label="Expand objects panel"
          >
            <SidebarToggleIcon collapsed />
          </button>
        ) : null}
        <span className="panel-title">Data</span>
        {isLinkedSelection ? (
          <button
            type="button"
            className="sel-name-btn"
            onDoubleClick={() => void onRenameActiveSelection()}
            title={`${objectTitle(selected!)}\nDouble-click to rename`}
          >
            {selectionName}
            {selectionDirty ? ' •' : ''}
          </button>
        ) : null}
        {selected ? (
          <span
            className={`data-fqn${isLinkedSelection ? ' data-fqn-secondary' : ''}`}
            title={objectTitle(selected)}
          >
            {objectTitle(selected)}
          </span>
        ) : null}
        {selectedFavorite ? (
          <button
            type="button"
            className={`btn-micro btn-icon tree-fav${selectedIsFavorite ? ' on' : ''}`}
            title={
              selectedIsFavorite ? 'Remove favorite' : 'Add favorite'
            }
            aria-label={
              selectedIsFavorite ? 'Remove favorite' : 'Add favorite'
            }
            onClick={() => toggleFavorite(selectedFavorite)}
          >
            <StarIcon filled={selectedIsFavorite} />
          </button>
        ) : null}
        {selected ? (
          <span className="kind-badge">{selected.kind}</span>
        ) : null}
        {isLinkedSelection ? (
          <span className="kind-badge">selection</span>
        ) : null}
        {visibleFilters.length > 0 ? (
          <div
            className="data-filter-info"
            title={activeFilters
              .map(
                (f) => `${f.column}: ${formatFilterInfoLabel(f)}`,
              )
              .join('\n')}
          >
            {visibleFilters.map((f) => {
              const label = formatFilterInfoLabel(f)
              return (
                <span
                  key={`${f.column}\0${normalizeFilterOp(f.op)}\0${label}`}
                  className="data-filter-chip"
                  title={`${f.column}: ${label}`}
                >
                  <span className="data-filter-col">{f.column}</span>
                  <span className="data-filter-val">{label}</span>
                </span>
              )
            })}
            {hiddenFilterCount > 0 ? (
              <span className="data-filter-more">
                +{hiddenFilterCount}
              </span>
            ) : null}
          </div>
        ) : null}
        {filterCount > 0 ? (
          <button
            type="button"
            className="btn-micro"
            title="Clear all filters"
            onClick={() => onFiltersChange([])}
          >
            Clear
          </button>
        ) : null}
        <div className="panel-header-actions">
          {selected && preview.isFetching ? <Spinner size="sm" /> : null}
          {selected ? (
            <button
              type="button"
              className="btn-micro btn-icon"
              onClick={newTransform}
              title="New transformation"
              aria-label="New transformation"
            >
              <TransformIcon />
            </button>
          ) : null}
          {selected ? (
            <button
              type="button"
              className={`btn-micro btn-icon${
                isLinkedSelection
                  ? selectionDirty
                    ? ' open'
                    : ''
                  : ''
              }`}
              onClick={() => void saveCurrentSelection()}
              disabled={bookmarkDisabled}
              title={bookmarkTitle}
              aria-label={bookmarkTitle}
            >
              <BookmarkIcon
                filled={isLinkedSelection && !selectionDirty}
              />
            </button>
          ) : null}
          {preview.data && selected ? (
            <div className="column-picker-anchor">
              <button
                type="button"
                className={`btn-micro btn-icon${columnsOpen ? ' open' : ''}${hiddenColumns.length > 0 ? ' active' : ''}`}
                onClick={() => setColumnsOpen((v) => !v)}
                title="Show / hide columns"
                aria-label="Show or hide columns"
                aria-expanded={columnsOpen}
              >
                <ColumnsIcon />
              </button>
              {columnsOpen ? (
                <ColumnPicker
                  columns={preview.data.columns}
                  hiddenColumns={hiddenColumns}
                  columnOrder={columnOrder}
                  onChange={(hidden) =>
                    updateActiveTab({ hiddenColumns: hidden })
                  }
                  onClose={() => setColumnsOpen(false)}
                  onHoverColumn={setHoverColumn}
                />
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className="btn-micro btn-icon"
            onClick={() => void preview.refetch()}
            disabled={!selected || preview.isFetching}
            title="Refresh preview"
            aria-label="Refresh preview"
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      {!active ? (
        <div className="panel-body">
          <div className="empty-hint">
            Add a connection to browse Snowflake
          </div>
        </div>
      ) : !selected ? (
        <div className="panel-body">
          <div className="empty-hint">
            {tabs.length > 0
              ? 'Select a tab or open a table from the tree'
              : 'Select a table or view'}
          </div>
        </div>
      ) : (
        <>
          {preview.isError ? (
            <div className="error-bar">
              {preview.error instanceof Error
                ? preview.error.message
                : 'Failed to load preview'}
            </div>
          ) : null}
          <Group
            orientation="horizontal"
            style={{ flex: 1, minHeight: 0, width: '100%' }}
          >
            <Panel id="grid" minSize={200}>
              <div className="panel data-grid-panel">
                <div
                  className="panel-body"
                  ref={gridScrollRef}
                  onScroll={onGridScroll}
                >
                  {preview.isLoading && !preview.data ? (
                    <div className="empty-hint">
                      <Spinner size="md" label="Loading rows…" block />
                    </div>
                  ) : preview.data ? (
                    <DataGrid
                      data={preview.data}
                      connection={active}
                      database={selected.database}
                      schema={selected.schema}
                      table={selected.name}
                      filters={filters}
                      onFiltersChange={onFiltersChange}
                      sort={sort}
                      onSortChange={onSortChange}
                      hiddenColumns={hiddenColumns}
                      columnOrder={columnOrder}
                      onColumnOrderChange={(order) =>
                        updateActiveTab({ columnOrder: order })
                      }
                      columnWidths={columnWidths}
                      onColumnWidthsChange={(widths) =>
                        updateActiveTab({ columnWidths: widths })
                      }
                      highlightColumn={hoverColumn}
                      selection={gridSelection}
                      onSelectionChange={onGridSelectionChange}
                      rowOffset={offset + 1}
                    />
                  ) : null}
                </div>
                <div className="pager">
                  <span className="pager-meta">
                    {preview.isFetching ? <Spinner size="sm" /> : null}
                    <span>
                      Rows {from.toLocaleString()}–{to.toLocaleString()} of{' '}
                      <span className="pager-total">{totalLabel}</span>
                      {filters.length > 0 ? ' (filtered)' : ''}
                    </span>
                  </span>
                  <div className="toolbar">
                    <button
                      type="button"
                      className="btn-micro"
                      disabled={!canPrev || preview.isFetching}
                      onClick={() =>
                        updateActiveTab({
                          offset: Math.max(0, offset - limit),
                        })
                      }
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      className="btn-micro"
                      disabled={!canNext || preview.isFetching}
                      onClick={() =>
                        updateActiveTab({ offset: offset + limit })
                      }
                    >
                      ▶
                    </button>
                    <select
                      className="select"
                      value={limit}
                      onChange={(e) => {
                        const nextLimit = Number(e.target.value)
                        setDefaultPageSize(nextLimit)
                        updateActiveTab({
                          limit: nextLimit,
                          offset: 0,
                        })
                      }}
                    >
                      {pageSizeOptions.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </Panel>
            <Separator />
            <Panel
              id="inspector"
              panelRef={inspectorPanelRef}
              defaultSize={0}
              minSize={220}
              collapsible
              collapsedSize={0}
              onResize={() => {
                setInspectorOpen(
                  !(inspectorPanelRef.current?.isCollapsed() ?? true),
                )
              }}
            >
              {preview.data ? (
                <DetailInspector
                  data={preview.data}
                  selection={gridSelection}
                  rowNumber={
                    gridSelection
                      ? offset + 1 + gridSelection.rowIndex
                      : null
                  }
                  onSelectColumn={(column) => {
                    if (!gridSelection) return
                    onGridSelectionChange({
                      ...gridSelection,
                      column,
                    })
                  }}
                  onClose={closeInspector}
                />
              ) : (
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Inspector</span>
                  </div>
                  <div className="panel-body">
                    <div className="empty-hint">No data</div>
                  </div>
                </div>
              )}
            </Panel>
          </Group>
        </>
      )}
    </div>
  )
}
