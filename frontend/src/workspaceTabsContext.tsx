import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useBrowseTabs } from './browseTabsContext'
import { useConnections } from './connections'
import { useDialog } from './dialog'
import { objectPathFrom } from './paths'
import { getDefaultPageSize } from './pageSizePrefs'
import { selectionPath } from './selections'
import { useSelections } from './selectionsContext'
import {
  defaultTransformName,
  normalizeTransformLayout,
} from './transformations'
import { useTransformations } from './transformationsContext'
import type { OpenTransformTab } from './transformTabs'
import { transformPath } from './transformTabs'
import { useTransformTabs } from './transformTabsContext'
import {
  browseHandle,
  buildUnifiedItems,
  fallbackPathAfterClose,
  loadTabOrder,
  parseHandle,
  renameHandleInOrder,
  saveTabOrder,
  syncTabOrder,
  transformHandle,
  type UnifiedTabItem,
} from './workspaceTabs'

type WorkspaceTabsContextValue = {
  items: UnifiedTabItem[]
  order: string[]
  renameBrowseHandle: (oldKey: string, newKey: string) => void
  closeUnified: (handle: string) => Promise<void>
  /** Persist a transform tab (for close-with-save). Returns false if cancelled. */
  saveTransformTab: (target: OpenTransformTab) => Promise<boolean>
}

const WorkspaceTabsContext =
  createContext<WorkspaceTabsContextValue | null>(null)

export function WorkspaceTabsProvider({ children }: { children: ReactNode }) {
  const { activeId } = useConnections()
  const navigate = useNavigate()
  const location = useLocation()
  const dialog = useDialog()
  const { tabs: browseTabs, updateTab, removeTab } = useBrowseTabs()
  const {
    tabs: transformTabs,
    updateTab: updateTransformTab,
    closeTab: closeTransformTab,
  } = useTransformTabs()
  const { update: updateSelection } = useSelections()
  const { add: addSaved, update: updateSaved } = useTransformations()
  const [order, setOrder] = useState<string[]>([])

  useEffect(() => {
    if (!activeId) {
      setOrder([])
      return
    }
    setOrder(loadTabOrder(activeId))
  }, [activeId])

  useEffect(() => {
    if (!activeId) return
    setOrder((prev) => {
      const next = syncTabOrder(prev, browseTabs, transformTabs)
      if (
        next.length === prev.length &&
        next.every((h, i) => h === prev[i])
      ) {
        return prev
      }
      saveTabOrder(activeId, next)
      return next
    })
  }, [activeId, browseTabs, transformTabs])

  const items = buildUnifiedItems(order, browseTabs, transformTabs)

  const renameBrowseHandle = (oldKey: string, newKey: string) => {
    if (!activeId || oldKey === newKey) return
    setOrder((prev) => {
      const next = renameHandleInOrder(
        prev,
        browseHandle(oldKey),
        browseHandle(newKey),
      )
      saveTabOrder(activeId, next)
      return next
    })
  }

  const saveTransformTab = async (
    target: OpenTransformTab,
  ): Promise<boolean> => {
    const layoutToSave = normalizeTransformLayout(target.layout)
    const columnOrderToSave = target.columnOrder ?? []
    const columnWidthsToSave = target.columnWidths ?? {}
    const pageSizeToSave = target.pageSize ?? getDefaultPageSize()
    if (target.savedId) {
      updateSaved(target.savedId, {
        name: target.name,
        recipe: target.recipe,
        chart: target.chart,
        layout: layoutToSave,
        columnOrder: columnOrderToSave,
        columnWidths: columnWidthsToSave,
        pageSize: pageSizeToSave,
      })
      updateTransformTab(target.id, {
        dirty: false,
        layout: layoutToSave,
        columnOrder: columnOrderToSave,
        columnWidths: columnWidthsToSave,
        pageSize: pageSizeToSave,
      })
      return true
    }
    const suggested = target.name || defaultTransformName(target.recipe)
    const name = await dialog.prompt({
      title: 'Save transformation',
      message: 'Name for the Transformations list.',
      defaultValue: suggested,
      confirmLabel: 'Save',
    })
    if (name === null) return false
    const created = addSaved({
      name: name.trim() || suggested,
      recipe: target.recipe,
      chart: target.chart,
      layout: layoutToSave,
      columnOrder: columnOrderToSave,
      columnWidths: columnWidthsToSave,
      pageSize: pageSizeToSave,
    })
    if (!created) return false
    updateTransformTab(target.id, {
      savedId: created.id,
      name: created.name,
      dirty: false,
      layout: layoutToSave,
      columnOrder: columnOrderToSave,
      columnWidths: columnWidthsToSave,
      pageSize: pageSizeToSave,
    })
    return true
  }

  const isHandleActive = (handle: string): boolean => {
    const parsed = parseHandle(handle)
    if (!parsed) return false
    if (parsed.kind === 'transform') {
      return location.pathname === transformPath(parsed.id)
    }
    const tab = browseTabs.find((t) => t.key === parsed.id)
    if (!tab) return false
    if (tab.selectionId) {
      return location.pathname === selectionPath(tab.selectionId)
    }
    const basePath = objectPathFrom(tab.object).split('?')[0] ?? ''
    return location.pathname === basePath
  }

  const closeUnified = async (handle: string) => {
    const parsed = parseHandle(handle)
    if (!parsed) return
    const isActive = isHandleActive(handle)

    if (parsed.kind === 'browse') {
      const target = browseTabs.find((t) => t.key === parsed.id)
      if (!target) return
      if (target.selectionId && target.dirty) {
        const label = target.selectionName ?? 'Selection'
        const choice = await dialog.unsaved({
          title: 'Unsaved changes',
          message: `"${label}" has unsaved changes. Save before closing?`,
        })
        if (choice === 'cancel') return
        if (choice === 'save') {
          updateSelection(target.selectionId, {
            name: target.selectionName ?? undefined,
            object: target.object,
            filters: target.filters,
            sort: target.sort,
            distinct: target.distinct,
            hiddenColumns: target.hiddenColumns,
            columnOrder: target.columnOrder,
            columnWidths: target.columnWidths,
            limit: target.limit,
          })
          updateTab(target.key, { dirty: false })
        }
      }
      const nextBrowse = browseTabs.filter((t) => t.key !== parsed.id)
      const nextPath = fallbackPathAfterClose(
        order,
        handle,
        nextBrowse,
        transformTabs,
      )
      removeTab(parsed.id)
      if (activeId) {
        setOrder((prev) => {
          const next = prev.filter((h) => h !== handle)
          saveTabOrder(activeId, next)
          return next
        })
      }
      if (isActive) navigate(nextPath, { replace: true })
      return
    }

    const target = transformTabs.find((t) => t.id === parsed.id)
    if (!target) return
    if (target.dirty) {
      const choice = await dialog.unsaved({
        title: 'Unsaved changes',
        message: `"${target.name}" has unsaved changes. Save before closing?`,
      })
      if (choice === 'cancel') return
      if (choice === 'save') {
        const saved = await saveTransformTab(target)
        if (!saved) return
      }
    }
    const nextTransform = transformTabs.filter((t) => t.id !== parsed.id)
    const nextPath = fallbackPathAfterClose(
      order,
      handle,
      browseTabs,
      nextTransform,
    )
    closeTransformTab(parsed.id)
    if (activeId) {
      setOrder((prev) => {
        const next = prev.filter((h) => h !== handle)
        saveTabOrder(activeId, next)
        return next
      })
    }
    if (isActive) navigate(nextPath, { replace: true })
  }

  return (
    <WorkspaceTabsContext.Provider
      value={{
        items,
        order,
        renameBrowseHandle,
        closeUnified,
        saveTransformTab,
      }}
    >
      {children}
    </WorkspaceTabsContext.Provider>
  )
}

export function useWorkspaceTabs(): WorkspaceTabsContextValue {
  const ctx = useContext(WorkspaceTabsContext)
  if (!ctx) throw new Error('useWorkspaceTabs requires WorkspaceTabsProvider')
  return ctx
}

export { transformHandle, browseHandle }
