import {
  useIsFetching,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { Group, Panel, Separator, useGroupRef, usePanelRef } from 'react-resizable-panels'
import type { Layout } from 'react-resizable-panels'
import {
  probeTransformColumns,
  runTransform,
  type TransformRunResult,
} from '../api/snowflake'
import ObjectTree from '../components/ObjectTree'
import ResultTable from '../components/ResultTable'
import Spinner from '../components/Spinner'
import TransformBuilder from '../components/TransformBuilder'
import TransformChart from '../components/TransformChart'
import {
  BookmarkIcon,
  CloseIcon,
  CsvIcon,
  DuplicateIcon,
  PlayIcon,
  RefreshIcon,
  SidebarToggleIcon,
  SqlIcon,
  TransformIcon,
} from '../components/TreeIcons'
import { useConnections } from '../connections'
import { objectPathFrom } from '../paths'
import type { SavedSelection } from '../selections'
import {
  defaultTransformLayout,
  defaultTransformName,
  normalizeTransformLayout,
  type ChartConfig,
  type TransformPanelLayout,
  type TransformRecipe,
} from '../transformations'
import { useTransformations } from '../transformationsContext'
import { TRANSFORM_HOME, transformPath } from '../transformTabs'
import { useTransformTabs } from '../transformTabsContext'

type TransformLocationState = {
  autoRun?: boolean
}

export default function TransformWorkspace() {
  const { transformId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { active } = useConnections()
  const {
    transformations,
    add: addSaved,
    update: updateSaved,
  } = useTransformations()
  const { tabs, openDraft, openSaved, updateTab, closeTab, getTab } =
    useTransformTabs()
  const objectsPanelRef = usePanelRef()
  const builderPanelRef = usePanelRef()
  const chartPanelRef = usePanelRef()
  const objectsGroupRef = useGroupRef()
  const stepsGroupRef = useGroupRef()
  const resultsGroupRef = useGroupRef()
  const [objectsCollapsed, setObjectsCollapsed] = useState(false)
  const [builderCollapsed, setBuilderCollapsed] = useState(false)
  const [chartCollapsed, setChartCollapsed] = useState(false)
  const [showSql, setShowSql] = useState(false)
  const [result, setResult] = useState<TransformRunResult | null>(null)
  const [hoverColumn, setHoverColumn] = useState<string | null>(null)
  const lastAutoRunKey = useRef<string | null>(null)

  const tab = transformId ? (getTab(transformId) ?? null) : null
  const autoRun =
    (location.state as TransformLocationState | null)?.autoRun === true

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

  useEffect(() => {
    setResult(null)
    setShowSql(false)
  }, [transformId])

  // Recover: old URLs used saved id; or tab missing after refresh race.
  // On /t (no id): resume the latest open draft if any.
  useEffect(() => {
    if (!transformId) {
      const latest = tabs[tabs.length - 1]
      if (latest) navigate(transformPath(latest.id), { replace: true })
      return
    }
    if (tab) return
    const asSaved = transformations.find((t) => t.id === transformId)
    if (asSaved) {
      const opened = openSaved(asSaved)
      if (opened) {
        navigate(transformPath(opened.id), {
          replace: true,
          state: { autoRun: true } satisfies TransformLocationState,
        })
      }
      return
    }
    const fallback = tabs[0]
    if (fallback) {
      navigate(transformPath(fallback.id), { replace: true })
    } else {
      navigate(TRANSFORM_HOME, { replace: true })
    }
  }, [transformId, tab, transformations, tabs, openSaved, navigate])

  const recipe = tab?.recipe ?? null
  const chart = tab?.chart ?? null
  const layout = normalizeTransformLayout(tab?.layout)

  const columnsQuery = useQuery({
    queryKey: [
      'transform-columns',
      active?.id,
      recipe?.source,
      recipe?.joins.map((j) => [j.alias, j.target]),
    ],
    queryFn: () => {
      if (!active || !recipe) throw new Error('No recipe')
      const probeRecipe = {
        ...recipe,
        joins: recipe.joins.filter((j) => j.target.name.trim()),
      }
      return probeTransformColumns(active, probeRecipe)
    },
    enabled: Boolean(active && recipe && recipe.source.name),
  })

  const runMut = useMutation({
    mutationFn: async () => {
      if (!active || !recipe) throw new Error('No recipe')
      return runTransform(active, recipe)
    },
    onSuccess: (data) => {
      setResult(data)
      if (tab && chart && !chart.x && data.columns.length > 0) {
        const x = data.columns[0]?.name ?? null
        const y =
          data.columns.find((c) => c.type === 'number')?.name ??
          data.columns[1]?.name ??
          null
        updateTab(tab.id, { chart: { ...chart, x, y } })
      }
    },
  })
  const runMutRef = useRef(runMut)
  runMutRef.current = runMut

  useEffect(() => {
    if (!autoRun || !tab || !active || !recipe?.source.name) return
    if (lastAutoRunKey.current === location.key) return
    lastAutoRunKey.current = location.key
    navigate(transformPath(tab.id), { replace: true, state: null })
    runMutRef.current.mutate()
  }, [autoRun, tab, active, recipe?.source.name, location.key, navigate])

  useEffect(() => {
    if (!tab) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return
      if (e.repeat) return
      const mut = runMutRef.current
      if (!active || !recipe?.source.name || mut.isPending) return
      e.preventDefault()
      mut.mutate()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, active, recipe])

  const patchLayout = (
    slice: keyof TransformPanelLayout,
    next: Layout,
    meta?: { isUserInteraction: boolean },
  ) => {
    if (!tab) return
    if (meta && !meta.isUserInteraction) return
    updateTab(tab.id, {
      layout: {
        ...normalizeTransformLayout(tab.layout),
        [slice]: next,
      },
    })
  }

  const syncLayoutFromGroup = (
    slice: keyof TransformPanelLayout,
    group: { getLayout: () => Layout } | null,
  ) => {
    if (!group) return
    patchLayout(slice, group.getLayout())
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
    queueMicrotask(() =>
      syncLayoutFromGroup('objects', objectsGroupRef.current),
    )
  }

  const syncBuilderCollapsed = () => {
    setBuilderCollapsed(builderPanelRef.current?.isCollapsed() ?? false)
  }

  const toggleBuilderPanel = () => {
    const panel = builderPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
    syncBuilderCollapsed()
    queueMicrotask(() => syncLayoutFromGroup('steps', stepsGroupRef.current))
  }

  const syncChartCollapsed = () => {
    setChartCollapsed(chartPanelRef.current?.isCollapsed() ?? false)
  }

  const toggleChartPanel = () => {
    const panel = chartPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
    syncChartCollapsed()
    queueMicrotask(() =>
      syncLayoutFromGroup('results', resultsGroupRef.current),
    )
  }

  const refreshTree = () => {
    if (!active) return
    void queryClient.invalidateQueries({ queryKey: ['databases', active.id] })
    void queryClient.invalidateQueries({ queryKey: ['schemas', active.id] })
    void queryClient.invalidateQueries({ queryKey: ['objects', active.id] })
  }

  const setRecipe = (next: TransformRecipe) => {
    if (!tab) return
    updateTab(tab.id, { recipe: next })
  }

  const setChart = (next: ChartConfig) => {
    if (!tab) return
    updateTab(tab.id, { chart: next })
  }

  const onOpenSelection = (sel: SavedSelection) => {
    navigate(objectPathFrom(sel.object))
  }

  const onOpenTransformation = (savedId: string) => {
    const saved = transformations.find((t) => t.id === savedId)
    if (!saved) return
    const opened = openSaved(saved)
    if (opened) {
      navigate(transformPath(opened.id), {
        state: { autoRun: true } satisfies TransformLocationState,
      })
    }
  }

  const changeSource = () => {
    if (!tab) return
    const db = window.prompt('Database', tab.recipe.source.database)
    if (db === null) return
    const schema = window.prompt('Schema', tab.recipe.source.schema)
    if (schema === null) return
    const name = window.prompt('Table / view', tab.recipe.source.name)
    if (name === null) return
    const kind =
      window.prompt('Kind (table|view)', tab.recipe.source.kind) ?? 'table'
    setRecipe({
      ...tab.recipe,
      source: {
        database: db.trim(),
        schema: schema.trim(),
        name: name.trim(),
        kind: kind.trim() === 'view' ? 'view' : 'table',
      },
    })
  }

  const onRename = () => {
    if (!tab) return
    const name = window.prompt('Name', tab.name)
    if (name === null) return
    const trimmed = name.trim()
    if (!trimmed) return
    updateTab(tab.id, { name: trimmed, dirty: true })
    if (tab.savedId) updateSaved(tab.savedId, { name: trimmed })
  }

  const onSave = () => {
    if (!tab) return
    const layoutToSave = normalizeTransformLayout(tab.layout)
    if (tab.savedId) {
      updateSaved(tab.savedId, {
        name: tab.name,
        recipe: tab.recipe,
        chart: tab.chart,
        layout: layoutToSave,
      })
      updateTab(tab.id, { dirty: false, layout: layoutToSave })
      return
    }
    const suggested = tab.name || defaultTransformName(tab.recipe)
    const name = window.prompt('Save transformation as', suggested)
    if (name === null) return
    const created = addSaved({
      name: name.trim() || suggested,
      recipe: tab.recipe,
      chart: tab.chart,
      layout: layoutToSave,
    })
    if (!created) return
    updateTab(tab.id, {
      savedId: created.id,
      name: created.name,
      dirty: false,
      layout: layoutToSave,
    })
  }

  const onDuplicateDraft = () => {
    if (!tab) return
    const copy = openDraft(tab.recipe.source)
    if (!copy) return
    updateTab(copy.id, {
      name: `${tab.name} copy`,
      recipe: structuredClone(tab.recipe),
      chart: structuredClone(tab.chart),
      layout: structuredClone(normalizeTransformLayout(tab.layout)),
      dirty: true,
      savedId: null,
    })
    navigate(transformPath(copy.id))
  }

  const onClose = () => {
    if (!tab) return
    if (tab.dirty) {
      const ok = window.confirm(
        'This transform has unsaved changes. Close without saving?',
      )
      if (!ok) return
    }
    const id = tab.id
    const idx = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    closeTab(id)
    const fallback = next[idx] ?? next[idx - 1] ?? next[0] ?? null
    navigate(fallback ? transformPath(fallback.id) : TRANSFORM_HOME, {
      replace: true,
    })
  }

  const exportCsv = () => {
    if (!result) return
    const header = result.columns.map((c) => csvEscape(c.name)).join(',')
    const lines = result.rows.map((row) =>
      row.map((cell) => csvEscape(cell == null ? '' : String(cell))).join(','),
    )
    const blob = new Blob([[header, ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${tab?.name ?? 'transform'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // If saved bookmark deleted while open, unlink
  useEffect(() => {
    if (!tab?.savedId) return
    if (transformations.some((t) => t.id === tab.savedId)) return
    updateTab(tab.id, { savedId: null, dirty: true })
  }, [tab, transformations, updateTab])

  if (!transformId || !tab) {
    const emptyLayout = defaultTransformLayout()
    return (
      <Group
        orientation="horizontal"
        style={{ height: '100%', width: '100%' }}
        defaultLayout={emptyLayout.objects}
      >
        <Panel
          id="objects"
          panelRef={objectsPanelRef}
          minSize={160}
          collapsible
          collapsedSize={0}
          onResize={syncObjectsCollapsed}
        >
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Objects</span>
              <div className="panel-header-actions">
                <Link to="/" className="btn-micro">
                  Browse
                </Link>
                <span className="btn-micro open">Transform</span>
                {active && treeFetching > 0 ? <Spinner size="sm" /> : null}
                {active ? (
                  <button
                    type="button"
                    className="btn-micro btn-icon"
                    onClick={refreshTree}
                    disabled={treeFetching > 0}
                    title="Refresh catalog"
                  >
                    <RefreshIcon />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-micro btn-icon"
                  onClick={toggleObjectsPanel}
                  title="Collapse objects panel"
                >
                  <SidebarToggleIcon collapsed={false} />
                </button>
              </div>
            </div>
            <div className="panel-body">
              {!active ? (
                <div className="empty-hint">Add a connection to browse.</div>
              ) : (
                <ObjectTree
                  connection={active}
                  selected={null}
                  onOpenSelection={onOpenSelection}
                  activeTransformId={null}
                  onOpenTransformation={onOpenTransformation}
                />
              )}
            </div>
          </div>
        </Panel>
        <Separator disabled={objectsCollapsed} />
        <Panel id="transform-main" minSize={200}>
          <div className="panel">
            <div className="panel-header">
              {objectsCollapsed ? (
                <button
                  type="button"
                  className="btn-micro btn-icon"
                  onClick={toggleObjectsPanel}
                  title="Expand objects panel"
                >
                  <SidebarToggleIcon collapsed />
                </button>
              ) : null}
              <span className="panel-title">Transform</span>
            </div>
            <div className="panel-body">
              <div className="empty-hint">
                {transformId
                  ? 'Opening…'
                  : 'Open a saved transformation, or start one from Browse with a table open.'}
              </div>
            </div>
          </div>
        </Panel>
      </Group>
    )
  }

  const isSaved = Boolean(tab.savedId)
  const saveLabel = !isSaved ? 'Save' : tab.dirty ? 'Save' : 'Saved'

  return (
    <Group
      key={tab.id}
      groupRef={objectsGroupRef}
      orientation="horizontal"
      style={{ height: '100%', width: '100%' }}
      defaultLayout={layout.objects}
      onLayoutChanged={(next, meta) => patchLayout('objects', next, meta)}
    >
      <Panel
        id="objects"
        panelRef={objectsPanelRef}
        minSize={160}
        collapsible
        collapsedSize={0}
        onResize={syncObjectsCollapsed}
      >
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Objects</span>
            <div className="panel-header-actions">
              <Link to="/" className="btn-micro">
                Browse
              </Link>
              <span className="btn-micro open">Transform</span>
              {active && treeFetching > 0 ? <Spinner size="sm" /> : null}
              {active ? (
                <button
                  type="button"
                  className="btn-micro btn-icon"
                  onClick={refreshTree}
                  disabled={treeFetching > 0}
                  title="Refresh catalog"
                >
                  <RefreshIcon />
                </button>
              ) : null}
              <button
                type="button"
                className="btn-micro btn-icon"
                onClick={toggleObjectsPanel}
                title="Collapse objects panel"
              >
                <SidebarToggleIcon collapsed={false} />
              </button>
            </div>
          </div>
          <div className="panel-body">
            {!active ? (
              <div className="empty-hint">Add a connection to browse.</div>
            ) : (
              <ObjectTree
                connection={active}
                selected={null}
                onOpenSelection={onOpenSelection}
                activeTransformId={tab.savedId}
                onOpenTransformation={onOpenTransformation}
              />
            )}
          </div>
        </div>
      </Panel>

      <Separator disabled={objectsCollapsed} />

      <Panel id="transform-main" minSize={400}>
        <div className="panel transform-workspace">
          <div className="panel-header">
            {objectsCollapsed ? (
              <button
                type="button"
                className="btn-micro btn-icon"
                onClick={toggleObjectsPanel}
                title="Expand objects panel"
              >
                <SidebarToggleIcon collapsed />
              </button>
            ) : null}
            {builderCollapsed ? (
              <button
                type="button"
                className="btn-micro btn-icon"
                onClick={toggleBuilderPanel}
                title="Expand steps"
                aria-label="Expand steps"
              >
                <SidebarToggleIcon collapsed />
              </button>
            ) : null}
            <span className="panel-title" style={{ display: 'flex', gap: 6 }}>
              <TransformIcon />
              <button
                type="button"
                className="tf-name-btn"
                onClick={onRename}
                title="Rename"
              >
                {tab.name}
                {tab.dirty ? ' •' : ''}
              </button>
              {!isSaved ? (
                <span className="kind-badge">draft</span>
              ) : null}
            </span>
            <div className="panel-header-actions">
              <button
                type="button"
                className="btn-micro btn-icon"
                onClick={onClose}
                title="Close draft"
                aria-label="Close draft"
              >
                <CloseIcon />
              </button>
              <button
                type="button"
                className="btn-micro btn-icon"
                onClick={onDuplicateDraft}
                title="Duplicate draft"
                aria-label="Duplicate draft"
              >
                <DuplicateIcon />
              </button>
              <button
                type="button"
                className={`btn-micro btn-icon${showSql ? ' open' : ''}`}
                onClick={() => setShowSql((v) => !v)}
                disabled={!result}
                title={showSql ? 'Hide SQL' : 'Show SQL'}
                aria-label={showSql ? 'Hide SQL' : 'Show SQL'}
              >
                <SqlIcon />
              </button>
              <button
                type="button"
                className="btn-micro btn-icon"
                onClick={exportCsv}
                disabled={!result}
                title="Export CSV"
                aria-label="Export CSV"
              >
                <CsvIcon />
              </button>
              <button
                type="button"
                className={`btn-micro btn-icon${tab.dirty || !isSaved ? ' open' : ''}`}
                onClick={onSave}
                disabled={isSaved && !tab.dirty}
                title={
                  isSaved
                    ? 'Update saved transformation'
                    : 'Save to Transformations list'
                }
                aria-label={saveLabel}
              >
                <BookmarkIcon filled={isSaved && !tab.dirty} />
              </button>
              <button
                type="button"
                className="btn-micro btn-icon"
                onClick={() => runMut.mutate()}
                disabled={!active || runMut.isPending}
                title={
                  runMut.isPending ? 'Running…' : 'Run (Ctrl+Enter)'
                }
                aria-label={runMut.isPending ? 'Running' : 'Run'}
              >
                {runMut.isPending ? <Spinner size="sm" /> : <PlayIcon />}
              </button>
            </div>
          </div>

          {runMut.isError ? (
            <div className="error-bar">
              {runMut.error instanceof Error
                ? runMut.error.message
                : 'Transform failed'}
            </div>
          ) : null}
          {columnsQuery.isError ? (
            <div className="error-bar">
              {columnsQuery.error instanceof Error
                ? columnsQuery.error.message
                : 'Failed to probe columns'}
            </div>
          ) : null}

          {showSql && result ? <pre className="tf-sql">{result.sql}</pre> : null}

          <Group
            groupRef={stepsGroupRef}
            orientation="horizontal"
            style={{ flex: 1, minHeight: 0, width: '100%' }}
            defaultLayout={layout.steps}
            onLayoutChanged={(next, meta) => patchLayout('steps', next, meta)}
          >
            <Panel
              id="builder"
              panelRef={builderPanelRef}
              minSize={200}
              collapsible
              collapsedSize={0}
              onResize={syncBuilderCollapsed}
            >
              <div
                className="panel"
                style={{
                  height: '100%',
                  borderRight: '1px solid var(--border)',
                }}
              >
                <div className="panel-header">
                  <span className="panel-title">Steps</span>
                  <div className="panel-header-actions">
                    <button
                      type="button"
                      className="btn-micro btn-icon"
                      onClick={toggleBuilderPanel}
                      title="Collapse steps"
                      aria-label="Collapse steps"
                    >
                      <SidebarToggleIcon collapsed={false} />
                    </button>
                  </div>
                </div>
                <div className="panel-body">
                  {columnsQuery.isLoading ? (
                    <div className="empty-hint">
                      <Spinner size="md" label="Loading columns…" block />
                    </div>
                  ) : (
                    <TransformBuilder
                      recipe={recipe!}
                      columns={columnsQuery.data ?? []}
                      onChange={setRecipe}
                      onPickSource={changeSource}
                      onHoverColumn={setHoverColumn}
                    />
                  )}
                </div>
              </div>
            </Panel>
            <Separator
              className="resize-separator"
              disabled={builderCollapsed}
            />
            <Panel id="results" minSize={280}>
              <Group
                groupRef={resultsGroupRef}
                orientation="vertical"
                style={{ height: '100%', width: '100%' }}
                defaultLayout={layout.results}
                onLayoutChanged={(next, meta) =>
                  patchLayout('results', next, meta)
                }
              >
                <Panel id="table" minSize={120}>
                  <div className="panel data-grid-panel">
                    <div className="panel-body">
                      {result ? (
                        <ResultTable
                          data={result}
                          connection={active!}
                          recipe={recipe!}
                          probeColumns={columnsQuery.data ?? []}
                          onFiltersChange={(filters) =>
                            setRecipe({ ...recipe!, filters })
                          }
                          highlightColumn={hoverColumn}
                        />
                      ) : (
                        <div className="empty-hint">
                          Configure the recipe and press Run
                        </div>
                      )}
                    </div>
                    <div className="pager">
                      {result ? (
                        <span className="pager-meta">
                          {result.columns.length.toLocaleString()} col
                          {result.columns.length === 1 ? '' : 's'}
                          {' · '}
                          {result.rows.length.toLocaleString()} row
                          {result.rows.length === 1 ? '' : 's'}
                          {result.total >= 0
                            ? ` · ${result.total.toLocaleString()} total`
                            : ''}
                        </span>
                      ) : (
                        <span className="pager-meta" />
                      )}
                      {chartCollapsed ? (
                        <button
                          type="button"
                          className="btn-micro btn-icon"
                          onClick={toggleChartPanel}
                          title="Expand chart"
                          aria-label="Expand chart"
                        >
                          <span className="tf-chart-toggle">
                            <SidebarToggleIcon collapsed />
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                </Panel>
                <Separator
                  className="resize-separator"
                  disabled={chartCollapsed}
                />
                <Panel
                  id="chart"
                  panelRef={chartPanelRef}
                  minSize={140}
                  collapsible
                  collapsedSize={0}
                  onResize={syncChartCollapsed}
                >
                  <div className="panel-header">
                    <span className="panel-title">Chart</span>
                    <div className="panel-header-actions">
                      <button
                        type="button"
                        className="btn-micro btn-icon"
                        onClick={toggleChartPanel}
                        title="Collapse chart"
                        aria-label="Collapse chart"
                      >
                        <span className="tf-chart-toggle">
                          <SidebarToggleIcon collapsed={false} />
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="panel-body">
                    <TransformChart
                      data={result}
                      chart={chart!}
                      onChange={setChart}
                    />
                  </div>
                </Panel>
              </Group>
            </Panel>
          </Group>
        </div>
      </Panel>
    </Group>
  )
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}
