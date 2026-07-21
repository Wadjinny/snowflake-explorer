import {
  keepPreviousData,
  useIsFetching,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { previewObject } from '../api/snowflake'
import ColumnPicker from '../components/ColumnPicker'
import DataGrid from '../components/DataGrid'
import ObjectTree from '../components/ObjectTree'
import Spinner from '../components/Spinner'
import TabBar from '../components/TabBar'
import {
  ColumnsIcon,
  RefreshIcon,
  SidebarToggleIcon,
  StarIcon,
} from '../components/TreeIcons'
import { useConnections } from '../connections'
import { useFavorites } from '../favoritesContext'
import {
  loadTabs,
  saveTabs,
  upsertTab,
  type OpenTab,
} from '../openTabs'
import { objectKeyFrom, objectPathFrom, objectTitle } from '../paths'
import type {
  ColumnFilter,
  ObjectKind,
  SelectedObject,
  SortSpec,
} from '../types'

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
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { active } = useConnections()
  const { isFavorite, toggle: toggleFavorite } = useFavorites()
  const urlObject = useSelectedFromUrl()
  const objectsPanelRef = usePanelRef()
  const [objectsCollapsed, setObjectsCollapsed] = useState(false)
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [columnsOpen, setColumnsOpen] = useState(false)

  const activeKey = urlObject ? objectKeyFrom(urlObject) : null
  const activeTab = tabs.find((t) => t.key === activeKey) ?? null

  const treeFetching = useIsFetching({
    predicate: (q) => {
      const key = q.queryKey
      return (
        Boolean(active) &&
        (key[0] === 'databases' ||
          key[0] === 'schemas' ||
          key[0] === 'objects') &&
        key[1] === active?.id
      )
    },
  })

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

  const refreshTree = () => {
    if (!active) return
    void queryClient.invalidateQueries({ queryKey: ['databases', active.id] })
    void queryClient.invalidateQueries({ queryKey: ['schemas', active.id] })
    void queryClient.invalidateQueries({ queryKey: ['objects', active.id] })
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

  useEffect(() => {
    setColumnsOpen(false)
  }, [activeKey])

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
    placeholderData: keepPreviousData,
  })

  const rowCount = preview.data?.rows.length ?? 0
  const total = preview.data?.total ?? 0
  const from = rowCount === 0 ? 0 : offset + 1
  const to = offset + rowCount
  const canPrev = offset > 0
  const canNext = total < 0 ? rowCount >= limit : offset + rowCount < total
  const filterCount = filters.reduce((n, f) => n + f.values.length, 0)
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
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Objects</span>
            <div className="panel-header-actions">
              {active && treeFetching > 0 ? <Spinner size="sm" /> : null}
              {active ? (
                <button
                  type="button"
                  className="btn-micro btn-icon"
                  onClick={refreshTree}
                  disabled={treeFetching > 0}
                  title="Refresh catalog"
                  aria-label="Refresh catalog"
                >
                  <RefreshIcon />
                </button>
              ) : null}
              <button
                type="button"
                className="btn-micro btn-icon"
                onClick={toggleObjectsPanel}
                title="Collapse objects panel"
                aria-label="Collapse objects panel"
              >
                <SidebarToggleIcon collapsed={false} />
              </button>
            </div>
          </div>
          <div className="panel-body">
            {!active ? (
              <div className="empty-hint">Add a connection to browse.</div>
            ) : (
              <ObjectTree connection={active} selected={selected} />
            )}
          </div>
        </div>
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
                      onChange={(hidden) =>
                        updateActiveTab({ hiddenColumns: hidden })
                      }
                      onClose={() => setColumnsOpen(false)}
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
            </>
          )}
        </div>
      </Panel>
    </Group>
  )
}
