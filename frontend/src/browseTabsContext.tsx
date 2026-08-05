import {
  createContext,
  useContext,
  useEffect,
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
import type { SavedSelection } from './selections'
import type { SelectedObject } from './types'

/** View-state fields that dirty a linked selection when changed. */
export const SELECTION_DIRTY_KEYS: ReadonlyArray<keyof OpenTab> = [
  'filters',
  'sort',
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
  upsertObject: (object: SelectedObject) => void
  openSelection: (sel: SavedSelection) => void
  removeTab: (key: string) => void
  setTabs: (updater: OpenTab[] | ((prev: OpenTab[]) => OpenTab[])) => void
}

const BrowseTabsContext = createContext<BrowseTabsContextValue | null>(null)

export function BrowseTabsProvider({ children }: { children: ReactNode }) {
  const { activeId } = useConnections()
  const [tabs, setTabsState] = useState<OpenTab[]>([])

  useEffect(() => {
    if (!activeId) {
      setTabsState([])
      return
    }
    setTabsState(loadTabs(activeId))
  }, [activeId])

  const persist = (next: OpenTab[]) => {
    if (!activeId) return
    saveTabs(activeId, next)
  }

  const setTabs = (updater: OpenTab[] | ((prev: OpenTab[]) => OpenTab[])) => {
    setTabsState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      persist(next)
      return next
    })
  }

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

  const upsertObject = (object: SelectedObject) => {
    if (!activeId) return
    setTabs((prev) => upsertTab(prev, object))
  }

  const openSelection = (sel: SavedSelection) => {
    if (!activeId) return
    const tab = makeSelectionTab(sel)
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
