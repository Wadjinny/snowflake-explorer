import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useConnections } from './connections'
import {
  loadTabs,
  makeSelectionTab,
  saveTabs,
  upsertTab,
  type OpenTab,
} from './openTabs'
import { objectKeyFrom } from './paths'
import type { SavedSelection } from './selections'
import type { SelectedObject } from './types'

/** View-state fields that dirty a linked selection when changed. */
export const SELECTION_DIRTY_KEYS: ReadonlyArray<keyof OpenTab> = [
  'filters',
  'sort',
  'distinct',
  'hiddenColumns',
  'columnOrder',
  'columnWidths',
  'limit',
]

type BrowseTabsContextValue = {
  tabs: OpenTab[]
  getTab: (key: string) => OpenTab | undefined
  updateTab: (key: string, patch: Partial<OpenTab>) => void
  /** Replace a tab in place (e.g. object key → selection key). */
  replaceTab: (oldKey: string, next: OpenTab) => void
  /** Open/focus an object tab (clears close-suppress for that key). */
  upsertObject: (object: SelectedObject) => void
  /**
   * Ensure a tab exists for the current URL object.
   * Skips keys that were just closed while the URL still points at them.
   */
  ensureUrlObject: (object: SelectedObject) => void
  /** Drop close-suppress for keys that are no longer the active URL object. */
  syncCloseSuppress: (urlKey: string | null) => void
  openSelection: (sel: SavedSelection) => void
  removeTab: (key: string) => void
  setTabs: (updater: OpenTab[] | ((prev: OpenTab[]) => OpenTab[])) => void
}

const BrowseTabsContext = createContext<BrowseTabsContextValue | null>(null)

export function BrowseTabsProvider({ children }: { children: ReactNode }) {
  const { activeId } = useConnections()
  const [tabs, setTabsState] = useState<OpenTab[]>([])
  /** Keys closed while URL may still point at them; block URL auto-reopen. */
  const closeSuppressRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!activeId) {
      setTabsState([])
      closeSuppressRef.current.clear()
      return
    }
    setTabsState(loadTabs(activeId))
    closeSuppressRef.current.clear()
  }, [activeId])

  const setTabs = useCallback(
    (updater: OpenTab[] | ((prev: OpenTab[]) => OpenTab[])) => {
      setTabsState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        if (next === prev) return prev
        if (activeId) saveTabs(activeId, next)
        return next
      })
    },
    [activeId],
  )

  const getTab = (key: string) => tabs.find((t) => t.key === key)

  const updateTab = (key: string, patch: Partial<OpenTab>) => {
    if (!activeId) return
    setTabs((prev) =>
      prev.map((t) => {
        if (t.key !== key) return t
        const next: OpenTab = { ...t, ...patch }
        if (
          t.selectionId &&
          patch.dirty === undefined &&
          SELECTION_DIRTY_KEYS.some((k) => k in patch)
        ) {
          next.dirty = true
        }
        return next
      }),
    )
  }

  const replaceTab = (oldKey: string, next: OpenTab) => {
    if (!activeId) return
    setTabs((prev) =>
      prev.map((t) => (t.key === oldKey ? next : t)),
    )
  }

  const upsertObject = useCallback(
    (object: SelectedObject) => {
      if (!activeId) return
      closeSuppressRef.current.delete(objectKeyFrom(object))
      setTabs((prev) => upsertTab(prev, object))
    },
    [activeId, setTabs],
  )

  const ensureUrlObject = useCallback(
    (object: SelectedObject) => {
      if (!activeId) return
      const key = objectKeyFrom(object)
      if (closeSuppressRef.current.has(key)) return
      setTabs((prev) => upsertTab(prev, object))
    },
    [activeId, setTabs],
  )

  const syncCloseSuppress = useCallback((urlKey: string | null) => {
    for (const key of [...closeSuppressRef.current]) {
      if (key !== urlKey) closeSuppressRef.current.delete(key)
    }
  }, [])

  const openSelection = (sel: SavedSelection) => {
    if (!activeId) return
    const tab = makeSelectionTab(sel)
    closeSuppressRef.current.delete(tab.key)
    setTabs((prev) => {
      const exists = prev.find((t) => t.key === tab.key)
      if (!exists) return [...prev, tab]
      return prev.map((t) =>
        t.key === tab.key
          ? {
              ...tab,
              ...(t.dirty
                ? {
                    filters: t.filters,
                    sort: t.sort,
                    distinct: t.distinct,
                    limit: t.limit,
                    offset: t.offset,
                    hiddenColumns: t.hiddenColumns,
                    columnOrder: t.columnOrder,
                    columnWidths: t.columnWidths,
                    scrollTop: t.scrollTop,
                    scrollLeft: t.scrollLeft,
                    dirty: t.dirty,
                    selectionName: sel.name,
                  }
                : { selectionName: sel.name }),
            }
          : t,
      )
    })
  }

  const removeTab = (key: string) => {
    if (!activeId) return
    closeSuppressRef.current.add(key)
    setTabs((prev) => prev.filter((t) => t.key !== key))
  }

  return (
    <BrowseTabsContext.Provider
      value={{
        tabs,
        getTab,
        updateTab,
        replaceTab,
        upsertObject,
        ensureUrlObject,
        syncCloseSuppress,
        openSelection,
        removeTab,
        setTabs,
      }}
    >
      {children}
    </BrowseTabsContext.Provider>
  )
}

export function useBrowseTabs(): BrowseTabsContextValue {
  const ctx = useContext(BrowseTabsContext)
  if (!ctx) throw new Error('useBrowseTabs requires BrowseTabsProvider')
  return ctx
}
