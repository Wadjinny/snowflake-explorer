import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { previewObject } from '../api/snowflake'
import ColumnPicker from '../components/ColumnPicker'
import DataGrid from '../components/DataGrid'
import DetailInspector, {
  type GridSelection,
} from '../components/DetailInspector'
import ObjectsPanel from '../components/ObjectsPanel'
import Spinner from '../components/Spinner'
import TabBar from '../components/TabBar'
import {
  BookmarkIcon,
  ColumnsIcon,
  RefreshIcon,
  SidebarToggleIcon,
  StarIcon,
  TransformIcon,
} from '../components/TreeIcons'
import { useConnections } from '../connections'
import { useDialog } from '../dialog'
import { useFavorites } from '../favoritesContext'
import {
  loadTabs,
  saveTabs,
  upsertTab,
  type OpenTab,
} from '../openTabs'
import { objectKeyFrom, objectPathFrom, objectTitle } from '../paths'
import {
  defaultSelectionName,
  type SavedSelection,
} from '../selections'
import { useSelections } from '../selectionsContext'
import { useTransformations } from '../transformationsContext'
import { transformPath } from '../transformTabs'
import { useTransformTabs } from '../transformTabsContext'
import type {
  ColumnFilter,
  ObjectKind,
  SelectedObject,
  SortSpec,
} from '../types'
import { filterIsActive } from '../types'

const PAGE_SIZES = [50, 100, 200, 500]

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
  const dialog = useDialog()
  const { active } = useConnections()
  const { isFavorite, toggle: toggleFavorite } = useFavorites()
  const { add: addSelection } = useSelections()
  const { transformations } = useTransformations()
  const { openDraft, openSaved } = useTransformTabs()
  const urlObject = useSelectedFromUrl()
  const objectsPanelRef = usePanelRef()
  const [objectsCollapsed, setObjectsCollapsed] = useState(false)
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [hoverColumn, setHoverColumn] = useState<string | null>(null)
  const [gridSelection, setGridSelection] = useState<GridSelection | null>(
    null,
  )
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const inspectorPanelRef = usePanelRef()

  const activeKey = urlObject ? objectKeyFrom(urlObject) : null
  const activeTab = tabs.find((t) => t.key === activeKey) ?? null

  // Load tabs when connection changes
  const prevConnectionId = useRef<string | undefined>(undefined)
  useEffect(() => {
    const prev = prevConnectionId.current
    prevConnectionId.current = active?.id
    if (!active?.id) {
      setTabs([])
      return
    }
    setTabs(loadTabs(active.id))
    if (prev && prev !== active.id) {
      navigate('/', { replace: true })
    }
  }, [active?.id, navigate])

  // Persist tabs
  useEffect(() => {
    if (!active?.id) return
    saveTabs(active.id, tabs)
  }, [active?.id, tabs])

  // URL object → ensure open as tab
  useEffect(() => {
    if (!urlObject || !active?.id) return
    setTabs((prev) => upsertTab(prev, urlObject))
  }, [urlObject, active?.id])

  const updateActiveTab = (patch: Partial<OpenTab>) => {
    if (!activeKey) return
    setTabs((prev) =>
      prev.map((t) => (t.key === activeKey ? { ...t, ...patch } : t)),
    )
  }

  const onFiltersChange = (next: ColumnFilter[]) => {
    updateActiveTab({ filters: next, offset: 0 })
  }

  const onSortChange = (next: SortSpec | null) => {
    updateActiveTab({ sort: next, offset: 0 })
  }

  const closeTab = (key: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.key === key)
      if (idx === -1) return prev
      const next = prev.filter((t) => t.key !== key)
      if (key === activeKey) {
        const fallback = next[idx] ?? next[idx - 1] ?? null
        navigate(fallback ? objectPathFrom(fallback.object) : '/', {
          replace: true,
        })
      }
      return next
    })
  }

  const openSelection = (sel: SavedSelection) => {
    const key = objectKeyFrom(sel.object)
    const tab: OpenTab = {
      key,
      object: sel.object,
      filters: sel.filters,
      sort: sel.sort,
      limit: sel.limit,
      offset: 0,
      hiddenColumns: sel.hiddenColumns,
      columnOrder: sel.columnOrder,
      columnWidths: sel.columnWidths ?? {},
    }
    setTabs((prev) => {
      const exists = prev.some((t) => t.key === key)
      if (exists) return prev.map((t) => (t.key === key ? tab : t))
      return [...prev, tab]
    })
    navigate(objectPathFrom(sel.object))
  }

  const saveCurrentSelection = async () => {
    if (!selected) return
    const suggested = defaultSelectionName(selected, filters, sort)
    const name = await dialog.prompt({
      title: 'Save selection',
      message: 'Name for the Selections list.',
      defaultValue: suggested,
      confirmLabel: 'Save',
    })
    if (name === null) return
    addSelection({
      name: name.trim() || suggested,
      object: selected,
      filters,
      sort,
      hiddenColumns,
      columnOrder,
      columnWidths,
      limit,
    })
  }

  const newTransform = () => {
    if (!selected) return
    const tab = openDraft(selected)
    if (tab) navigate(transformPath(tab.id))
  }

  const openTransformation = (savedId: string) => {
    const saved = transformations.find((t) => t.id === savedId)
    if (!saved) return
    const tab = openSaved(saved)
    if (tab) navigate(transformPath(tab.id), { state: { autoRun: true } })
  }

  const syncObjectsCollapsed = () => {
    setObjectsCollapsed(objectsPanelRef.current?.isCollapsed() ?? false)
  }

  const toggleObjectsPanel = () => {
    const panel = objectsPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
    syncObjectsCollapsed()
  }

  const selected = activeTab?.object ?? urlObject
  const filters = activeTab?.filters ?? []
  const sort = activeTab?.sort ?? null
  const limit = activeTab?.limit ?? 100
  const offset = activeTab?.offset ?? 0
  const hiddenColumns = activeTab?.hiddenColumns ?? []
  const columnOrder = activeTab?.columnOrder ?? []
  const columnWidths = activeTab?.columnWidths ?? {}

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
    // Keep prior rows only when paging/filtering the same table — not when switching objects.
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

  const rowCount = preview.data?.rows.length ?? 0
  const total = preview.data?.total ?? 0
  const from = rowCount === 0 ? 0 : offset + 1
  const to = offset + rowCount
  const canPrev = offset > 0
  const canNext = total < 0 ? rowCount >= limit : offset + rowCount < total
  const filterCount = filters.filter(filterIsActive).length
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

  return (
    <Group orientation="horizontal" style={{ height: '100%', width: '100%' }}>
      <Panel
        id="objects"
        panelRef={objectsPanelRef}
        defaultSize={280}
        minSize={160}
        collapsible
        collapsedSize={0}
        onResize={syncObjectsCollapsed}
      >
        <ObjectsPanel
          connection={active}
          mode="browse"
          selected={selected}
          onOpenSelection={openSelection}
          onOpenTransformation={openTransformation}
          onCollapse={toggleObjectsPanel}
        />
      </Panel>
      <Separator disabled={objectsCollapsed} />
      <Panel id="data" minSize={200}>
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
            {selected ? (
              <span className="data-fqn" title={objectTitle(selected)}>
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
            {filterCount > 0 ? (
              <button
                type="button"
                className="btn-micro"
                title="Clear all filters"
                onClick={() => onFiltersChange([])}
              >
                Clear filters ({filterCount})
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
                  className="btn-micro btn-icon"
                  onClick={saveCurrentSelection}
                  title="Save selection view"
                  aria-label="Save selection view"
                >
                  <BookmarkIcon />
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

          {active && tabs.length > 0 ? (
            <TabBar tabs={tabs} activeKey={activeKey} onClose={closeTab} />
          ) : null}

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
                    <div className="panel-body">
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
                            updateActiveTab({
                              limit: Number(e.target.value),
                              offset: 0,
                            })
                          }}
                        >
                          {PAGE_SIZES.map((size) => (
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
      </Panel>
    </Group>
  )
}
