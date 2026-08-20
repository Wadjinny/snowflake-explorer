import { useMutation, useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useOutletContext, useParams } from 'react-router'
import { Group, Panel, Separator, useGroupRef, usePanelRef } from 'react-resizable-panels'
import type { Layout } from 'react-resizable-panels'
import {
  probeTransformColumns,
  runTransform,
  type TransformRunResult,
} from '../api/snowflake'
import DetailInspector, {
  type GridSelection,
} from '../components/DetailInspector'
import ResultTable from '../components/ResultTable'
import Spinner from '../components/Spinner'
import TransformBuilder, {
  type TransformCollapseApi,
} from '../components/TransformBuilder'
import {
  BookmarkIcon,
  CloseIcon,
  CsvIcon,
  DuplicateIcon,
  ExpandAllIcon,
  FoldAllIcon,
  PlayIcon,
  SidebarToggleIcon,
  SqlIcon,
  TransformIcon,
} from '../components/TreeIcons'
import { useConnections } from '../connections'
import { useDialog } from '../dialog'
import { resolveColumnOrder } from '../openTabs'
import { queryGcTime, TRANSFORM_COLUMNS_STALE_MS } from '../queryStale'
import {
  normalizeTransformLayout,
  prepareRecipeForApi,
  type ChartConfig,
  type TransformPanelLayout,
  type TransformRecipe,
} from '../transformations'
import { useTransformations } from '../transformationsContext'
import { TRANSFORM_HOME, transformPath } from '../transformTabs'
import { useTransformTabs } from '../transformTabsContext'
import { getDefaultPageSize, setDefaultPageSize } from '../pageSizePrefs'
import { transformHandle } from '../workspaceTabs'
import { useWorkspaceTabs } from '../workspaceTabsContext'
import type { WorkspaceOutletContext } from '../workspaceOutlet'

const SqlPreviewModal = lazy(
  () => import('../components/SqlPreviewModal'),
)

// Splits ECharts out of this route's chunk so opening a transform renders the
// builder and table without waiting on the charting library.
const TransformChart = lazy(() => import('../components/TransformChart'))

const PAGE_SIZES = [50, 100, 200, 500, 1000]

type TransformLocationState = {
  autoRun?: boolean
}

export default function TransformWorkspace() {
  const { transformId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { active } = useConnections()
  const dialog = useDialog()
  const { transformations, update: updateSaved } = useTransformations()
  const { tabs, openDraft, openSaved, updateTab, getTab } =
    useTransformTabs()
  const { closeUnified, saveTransformTab } = useWorkspaceTabs()
  const { objectsCollapsed, toggleObjectsPanel } =
    useOutletContext<WorkspaceOutletContext>()
  const builderPanelRef = usePanelRef()
  const chartPanelRef = usePanelRef()
  const inspectorPanelRef = usePanelRef()
  const stepsGroupRef = useGroupRef()
  const resultsGroupRef = useGroupRef()
  const [showSql, setShowSql] = useState(false)
  const [result, setResult] = useState<TransformRunResult | null>(null)
  const [hoverColumn, setHoverColumn] = useState<string | null>(null)
  const [gridSelection, setGridSelection] = useState<GridSelection | null>(
    null,
  )
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [stepCollapse, setStepCollapse] =
    useState<TransformCollapseApi | null>(null)
  const lastAutoRunTabId = useRef<string | null>(null)

  const tab = transformId ? (getTab(transformId) ?? null) : null
  const autoRun =
    (location.state as TransformLocationState | null)?.autoRun === true

  useEffect(() => {
    setResult(null)
    setShowSql(false)
    setGridSelection(null)
    setInspectorOpen(false)
    inspectorPanelRef.current?.collapse()
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
      return probeTransformColumns(
        active,
        prepareRecipeForApi(recipe, {
          requireJoinOn: false,
          applyDisabled: false,
        }),
      )
    },
    enabled: Boolean(active && recipe && recipe.source.name),
    staleTime: TRANSFORM_COLUMNS_STALE_MS,
    gcTime: queryGcTime(TRANSFORM_COLUMNS_STALE_MS),
  })

  const runMut = useMutation({
    mutationFn: async (
      vars: { offset?: number; pageSize?: number } = {},
    ) => {
      if (!active || !recipe || !tab) throw new Error('No recipe')
      const pageSize = vars.pageSize ?? tab.pageSize ?? getDefaultPageSize()
      const offset = vars.offset ?? tab.offset ?? 0
      return runTransform(
        active,
        prepareRecipeForApi(recipe, { requireJoinOn: true }),
        { limit: pageSize, offset },
      )
    },
    onSuccess: (data) => {
      setResult(data)
      if (tab && chart && !chart.x && data.columns.length > 0) {
        const x = data.columns[0]?.name ?? null
        const yCol =
          data.columns.find((c) => c.type === 'number')?.name ??
          data.columns[1]?.name ??
          null
        updateTab(tab.id, {
          chart: { ...chart, x, y: yCol ? [yCol] : [] },
        })
      }
    },
  })
  const runMutRef = useRef(runMut)
  runMutRef.current = runMut

  useEffect(() => {
    if (!tab || !active || !recipe?.source.name) return
    if (!autoRun && lastAutoRunTabId.current === tab.id) return
    lastAutoRunTabId.current = tab.id
    if (autoRun) {
      navigate(transformPath(tab.id), { replace: true, state: null })
    }
    runMutRef.current.mutate({
      offset: tab.offset ?? 0,
      pageSize: tab.pageSize ?? getDefaultPageSize(),
    })
  }, [autoRun, tab, active, recipe?.source.name, location.key, navigate])

  useEffect(() => {
    if (!tab) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return
      if (e.repeat) return
      const mut = runMutRef.current
      if (!active || !recipe?.source.name || mut.isPending) return
      e.preventDefault()
      mut.mutate({})
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

  const {
    collapsed: builderCollapsed,
    syncCollapsed: syncBuilderCollapsed,
    toggle: toggleBuilderPanel,
  } = usePanelToggle(builderPanelRef, stepsGroupRef, 'steps', patchLayout)
  const {
    collapsed: chartCollapsed,
    syncCollapsed: syncChartCollapsed,
    toggle: toggleChartPanel,
  } = usePanelToggle(chartPanelRef, resultsGroupRef, 'results', patchLayout)

  const setRecipe = (next: TransformRecipe) => {
    if (!tab) return
    updateTab(tab.id, { recipe: next, offset: 0 })
  }

  const setPage = (next: { pageSize?: number; offset: number }) => {
    if (!tab) return
    const pageSize = next.pageSize ?? tab.pageSize ?? getDefaultPageSize()
    const offset = Math.max(0, next.offset)
    if (next.pageSize !== undefined) setDefaultPageSize(pageSize)
    setGridSelection(null)
    updateTab(tab.id, {
      ...(next.pageSize !== undefined ? { pageSize } : {}),
      offset,
      dirty: next.pageSize !== undefined ? true : tab.dirty,
    })
    runMut.mutate({ offset, pageSize })
  }

  const setChart = (next: ChartConfig) => {
    if (!tab) return
    updateTab(tab.id, { chart: next })
  }

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
    setGridSelection(null)
  }, [result])

  useEffect(() => {
    if (!inspectorOpen && !gridSelection) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      closeInspector()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspectorOpen, gridSelection])

  const onRename = async () => {
    if (!tab) return
    const name = await dialog.prompt({
      title: 'Rename',
      defaultValue: tab.name,
      confirmLabel: 'Rename',
    })
    if (name === null) return
    const trimmed = name.trim()
    if (!trimmed) return
    updateTab(tab.id, { name: trimmed, dirty: true })
    if (tab.savedId) updateSaved(tab.savedId, { name: trimmed })
  }

  const onSave = async () => {
    if (!tab) return
    await saveTransformTab(tab)
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
      columnOrder: [...(tab.columnOrder ?? [])],
      columnWidths: { ...(tab.columnWidths ?? {}) },
      pageSize: tab.pageSize ?? getDefaultPageSize(),
      offset: 0,
      dirty: true,
      savedId: null,
    })
    navigate(transformPath(copy.id))
  }

  const exportCsv = () => {
    if (!result || !tab) return
    const names = resolveColumnOrder(
      result.columns.map((c) => c.name),
      tab.columnOrder ?? [],
    )
    const indexByName = new Map(
      result.columns.map((c, i) => [c.name, i] as const),
    )
    const header = names.map((n) => csvEscape(n)).join(',')
    const lines = result.rows.map((row) =>
      names
        .map((n) => {
          const cell = row[indexByName.get(n) ?? -1]
          return csvEscape(cell == null ? '' : String(cell))
        })
        .join(','),
    )
    const blob = new Blob([[header, ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${tab.name ?? 'transform'}.csv`
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
    return (
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
              : 'Open a saved transformation, or start one from a table tab.'}
          </div>
        </div>
      </div>
    )
  }

  const isSaved = Boolean(tab.savedId)
  const saveLabel = !isSaved ? 'Save' : tab.dirty ? 'Save' : 'Saved'
  const pageLimit = tab.pageSize ?? getDefaultPageSize()
  const pageOffset = tab.offset ?? 0
  const pageFrom = result ? pageOffset + (result.rows.length > 0 ? 1 : 0) : 0
  const pageTo = result ? pageOffset + result.rows.length : 0
  const pageTotal = result?.total ?? -1
  const canPrev = pageOffset > 0 && !runMut.isPending
  const canNext =
    Boolean(result) &&
    !runMut.isPending &&
    (pageTotal >= 0
      ? pageOffset + (result?.rows.length ?? 0) < pageTotal
      : (result?.rows.length ?? 0) >= pageLimit)
  const pageSizeOptions = PAGE_SIZES.includes(pageLimit)
    ? PAGE_SIZES
    : [...PAGE_SIZES, pageLimit].sort((a, b) => a - b)

  return (
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
            onClick={() => void closeUnified(transformHandle(tab.id))}
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
            onClick={() => setShowSql(true)}
            disabled={!result}
            title="Show SQL"
            aria-label="Show SQL"
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
            onClick={() => void onSave()}
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
            onClick={() => runMut.mutate({})}
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

      {showSql && result ? (
        <Suspense fallback={null}>
          <SqlPreviewModal
            open={showSql}
            sql={result.sql}
            onClose={() => setShowSql(false)}
            title="Compiled SQL"
          />
        </Suspense>
      ) : null}

      <Group
        key={tab.id}
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
                {stepCollapse ? (
                  <>
                    <button
                      type="button"
                      className="btn-micro btn-icon"
                      onClick={stepCollapse.expandAll}
                      disabled={!stepCollapse.canExpand}
                      title="Expand all steps"
                      aria-label="Expand all steps"
                    >
                      <ExpandAllIcon />
                    </button>
                    <button
                      type="button"
                      className="btn-micro btn-icon"
                      onClick={stepCollapse.collapseAll}
                      disabled={!stepCollapse.canCollapse}
                      title="Collapse all steps"
                      aria-label="Collapse all steps"
                    >
                      <FoldAllIcon />
                    </button>
                  </>
                ) : null}
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
                connection={active!}
                onChange={setRecipe}
                onHoverColumn={setHoverColumn}
                onCollapseApi={setStepCollapse}
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
              <Group
                orientation="horizontal"
                style={{ height: '100%', width: '100%' }}
              >
                <Panel id="grid" minSize={200}>
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
                          columnOrder={tab.columnOrder ?? []}
                          onColumnOrderChange={(order) =>
                            updateTab(tab.id, { columnOrder: order })
                          }
                          columnWidths={tab.columnWidths ?? {}}
                          onColumnWidthsChange={(widths) =>
                            updateTab(tab.id, { columnWidths: widths })
                          }
                          highlightColumn={hoverColumn}
                          selection={gridSelection}
                          onSelectionChange={onGridSelectionChange}
                          rowOffset={pageOffset + 1}
                        />
                      ) : (
                        <div className="empty-hint">
                          {!recipe?.source.name ? (
                            'Pick a source table'
                          ) : runMut.isError ? (
                            'Run failed'
                          ) : (
                            <Spinner size="md" label="Running…" block />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="pager">
                      <span className="pager-meta">
                        {runMut.isPending ? <Spinner size="sm" /> : null}
                        {result ? (
                          <span>
                            Rows {pageFrom.toLocaleString()}–
                            {pageTo.toLocaleString()}
                            {pageTotal >= 0 ? (
                              <>
                                {' '}
                                of{' '}
                                <span className="pager-total">
                                  {pageTotal.toLocaleString()}
                                </span>
                              </>
                            ) : null}
                            {' · '}
                            {result.columns.length.toLocaleString()} col
                            {result.columns.length === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </span>
                      <div className="toolbar">
                        <button
                          type="button"
                          className="btn-micro"
                          disabled={!canPrev}
                          onClick={() =>
                            setPage({
                              offset: Math.max(0, pageOffset - pageLimit),
                            })
                          }
                        >
                          ◀
                        </button>
                        <button
                          type="button"
                          className="btn-micro"
                          disabled={!canNext}
                          onClick={() =>
                            setPage({ offset: pageOffset + pageLimit })
                          }
                        >
                          ▶
                        </button>
                        <select
                          className="select"
                          value={pageLimit}
                          disabled={runMut.isPending}
                          onChange={(e) =>
                            setPage({
                              pageSize: Number(e.target.value),
                              offset: 0,
                            })
                          }
                          title="Rows per page"
                          aria-label="Rows per page"
                        >
                          {pageSizeOptions.map((size) => (
                            <option key={size} value={size}>
                              {size}
                            </option>
                          ))}
                        </select>
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
                  {result ? (
                    <DetailInspector
                      data={result}
                      selection={gridSelection}
                      rowNumber={
                        gridSelection
                          ? pageOffset + 1 + gridSelection.rowIndex
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
            </Panel>
            <Separator
              className="resize-separator"
              disabled={chartCollapsed}
            />
            <Panel
              id="chart"
              panelRef={chartPanelRef}
              defaultSize={0}
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
                <Suspense
                  fallback={
                    <div className="empty-hint">
                      <Spinner size="md" label="Loading chart…" block />
                    </div>
                  }
                >
                  <TransformChart
                    data={result}
                    chart={chart!}
                    onChange={setChart}
                  />
                </Suspense>
              </div>
            </Panel>
          </Group>
        </Panel>
      </Group>
    </div>
  )
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/**
 * Collapse/expand state for one resizable panel, syncing the committed layout
 * back into the tab whenever the user toggles it.
 */
function usePanelToggle(
  panelRef: ReturnType<typeof usePanelRef>,
  groupRef: ReturnType<typeof useGroupRef>,
  slice: keyof TransformPanelLayout,
  patchLayout: (slice: keyof TransformPanelLayout, next: Layout) => void,
) {
  const [collapsed, setCollapsed] = useState(false)
  const syncCollapsed = () => {
    setCollapsed(panelRef.current?.isCollapsed() ?? false)
  }
  const toggle = () => {
    const panel = panelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
    syncCollapsed()
    queueMicrotask(() => {
      const group = groupRef.current
      if (group) patchLayout(slice, group.getLayout())
    })
  }
  return { collapsed, syncCollapsed, toggle }
}
