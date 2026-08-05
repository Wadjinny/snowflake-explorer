import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Outlet,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import type { Layout } from 'react-resizable-panels'
import ObjectsPanel from '../components/ObjectsPanel'
import UnifiedTabBar from '../components/UnifiedTabBar'
import { useBrowseTabs } from '../browseTabsContext'
import { useConnections } from '../connections'
import { objectKeyFrom } from '../paths'
import { selectionTabKey } from '../openTabs'
import { selectionPath, type SavedSelection } from '../selections'
import { useTransformations } from '../transformationsContext'
import { transformPath } from '../transformTabs'
import { useTransformTabs } from '../transformTabsContext'
import { browseHandle, transformHandle } from '../workspaceTabs'
import { useWorkspaceTabs, WorkspaceTabsProvider } from '../workspaceTabsContext'
import type { WorkspaceOutletContext } from '../workspaceOutlet'
import type { ObjectKind, SelectedObject } from '../types'

const WORKSPACE_LAYOUT_KEY = 'sf-explorer.workspaceLayout'

function loadObjectsLayout(): Layout | undefined {
  try {
    const raw = localStorage.getItem(WORKSPACE_LAYOUT_KEY)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return undefined
    return parsed as Layout
  } catch {
    return undefined
  }
}

function saveObjectsLayout(layout: Layout) {
  try {
    localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // ignore
  }
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

function WorkspaceShellInner() {
  const { active } = useConnections()
  const navigate = useNavigate()
  const params = useParams()
  const urlObject = useSelectedFromUrl()
  const urlSelectionId = params.selectionId ?? null
  const transformId = params.transformId ?? null
  const { tabs: browseTabs, openSelection } = useBrowseTabs()
  const { openSaved, getTab: getTransformTab } = useTransformTabs()
  const { transformations } = useTransformations()
  const { items, closeUnified, reorderTabs } = useWorkspaceTabs()
  const objectsPanelRef = usePanelRef()
  const [objectsCollapsed, setObjectsCollapsed] = useState(false)
  const [objectsLayout] = useState<Layout | undefined>(() => loadObjectsLayout())
  const prevConnectionId = useRef<string | undefined>(undefined)

  useEffect(() => {
    const prev = prevConnectionId.current
    prevConnectionId.current = active?.id
    if (prev && active?.id && prev !== active.id) {
      navigate('/', { replace: true })
    }
  }, [active?.id, navigate])

  const syncObjectsCollapsed = () => {
    setObjectsCollapsed(objectsPanelRef.current?.isCollapsed() ?? false)
  }

  const toggleObjectsPanel = () => {
    const panel = objectsPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }

  const activeBrowseKey = urlSelectionId
    ? selectionTabKey(urlSelectionId)
    : urlObject
      ? objectKeyFrom(urlObject)
      : null

  const activeHandle = transformId
    ? transformHandle(transformId)
    : activeBrowseKey
      ? browseHandle(activeBrowseKey)
      : null

  const selectedForTree = useMemo(() => {
    if (transformId) return null
    if (urlSelectionId) {
      const tab = browseTabs.find(
        (t) => t.key === selectionTabKey(urlSelectionId),
      )
      return tab?.object ?? null
    }
    return urlObject
  }, [transformId, urlSelectionId, browseTabs, urlObject])

  const activeTransformId = transformId
    ? (getTransformTab(transformId)?.savedId ?? null)
    : null

  const onOpenSelection = (sel: SavedSelection) => {
    openSelection(sel)
    navigate(selectionPath(sel.id))
  }

  const onOpenTransformation = (savedId: string) => {
    const saved = transformations.find((t) => t.id === savedId)
    if (!saved) return
    const tab = openSaved(saved)
    if (tab) {
      navigate(transformPath(tab.id), { state: { autoRun: true } })
    }
  }

  const outletContext: WorkspaceOutletContext = {
    objectsCollapsed,
    toggleObjectsPanel,
  }

  return (
    <Group
      orientation="horizontal"
      style={{ height: '100%', width: '100%' }}
      defaultLayout={objectsLayout ?? { objects: 22, main: 78 }}
      onLayoutChanged={(next) => saveObjectsLayout(next)}
    >
      <Panel
        id="objects"
        panelRef={objectsPanelRef}
        minSize={160}
        collapsible
        collapsedSize={0}
        onResize={syncObjectsCollapsed}
      >
        <ObjectsPanel
          connection={active}
          selected={selectedForTree}
          activeSelectionId={urlSelectionId}
          onOpenSelection={onOpenSelection}
          onOpenTransformation={onOpenTransformation}
          activeTransformId={activeTransformId}
          onCollapse={toggleObjectsPanel}
        />
      </Panel>
      <Separator disabled={objectsCollapsed} />
      <Panel id="main" minSize={200}>
        <div className="panel workspace-main">
          <UnifiedTabBar
            items={items}
            activeHandle={activeHandle}
            onClose={closeUnified}
            onReorder={reorderTabs}
          />
          <div className="workspace-outlet">
            <Outlet context={outletContext} />
          </div>
        </div>
      </Panel>
    </Group>
  )
}

export default function WorkspaceShell() {
  return (
    <WorkspaceTabsProvider>
      <WorkspaceShellInner />
    </WorkspaceTabsProvider>
  )
}
