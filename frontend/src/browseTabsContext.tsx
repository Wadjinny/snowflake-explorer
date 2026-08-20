import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import { useDebouncedPersist } from './persistTabs'
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

/**
 * Everything that mutates browse tabs. Split from the tab list so consumers
 * that only act on tabs — every row of the object tree calls `upsertObject` —
 * do not re-render each time a tab's scroll position or filters change.
 */
type BrowseTabActions = {
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

type BrowseTabsContextValue = BrowseTabActions & {
  tabs: OpenTab[]
}

const BrowseTabsContext = createContext<BrowseTabsContextValue | null>(null)
const BrowseTabActionsContext = createContext<BrowseTabActions | null>(null)

export function BrowseTabsProvider({ children }: { children: ReactNode }) {
  const { activeId } = useConnections()
  const [tabs, setTabsState] = useState<OpenTab[]>([])
  /** Keys closed while URL may still point at them; block URL auto-reopen. */
  const closeSuppressRef = useRef<Set<string>>(new Set())
  /** Lets the actions below read current tabs without depending on them. */
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  useEffect(() => {
    if (!activeId) {
      setTabsState([])
      closeSuppressRef.current.clear()
      return
    }
    setTabsState(loadTabs(activeId))
    closeSuppressRef.current.clear()
  }, [activeId])

  useDebouncedPersist(activeId, tabs, saveTabs)

  const setTabs = useCallback(
    (updater: OpenTab[] | ((prev: OpenTab[]) => OpenTab[])) => {
      setTabsState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        return next === prev ? prev : next
      })
    },
    [],
  )

  const getTab = useCallback(
    (key: string) => tabsRef.current.find((t) => t.key === key),
    [],
  )

  const updateTab = useCallback(
    (key: string, patch: Partial<OpenTab>) => {
      if (!activeIdRef.current) return
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
    },
    [setTabs],
  )

  const replaceTab = useCallback(
    (oldKey: string, next: OpenTab) => {
      if (!activeIdRef.current) return
      setTabs((prev) => prev.map((t) => (t.key === oldKey ? next : t)))
    },
    [setTabs],
  )

  const upsertObject = useCallback(
    (object: SelectedObject) => {
      if (!activeIdRef.current) return
      closeSuppressRef.current.delete(objectKeyFrom(object))
      setTabs((prev) => upsertTab(prev, object))
    },
    [setTabs],
  )

  const ensureUrlObject = useCallback(
    (object: SelectedObject) => {
      if (!activeIdRef.current) return
      const key = objectKeyFrom(object)
      if (closeSuppressRef.current.has(key)) return
      setTabs((prev) => upsertTab(prev, object))
    },
    [setTabs],
  )

  const syncCloseSuppress = useCallback((urlKey: string | null) => {
    for (const key of [...closeSuppressRef.current]) {
      if (key !== urlKey) closeSuppressRef.current.delete(key)
    }
  }, [])

  const openSelection = useCallback(
    (sel: SavedSelection) => {
      if (!activeIdRef.current) return
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
    },
    [setTabs],
  )

  const removeTab = useCallback(
    (key: string) => {
      if (!activeIdRef.current) return
      closeSuppressRef.current.add(key)
      setTabs((prev) => prev.filter((t) => t.key !== key))
    },
    [setTabs],
  )

  const actions = useMemo<BrowseTabActions>(
    () => ({
      getTab,
      updateTab,
      replaceTab,
      upsertObject,
      ensureUrlObject,
      syncCloseSuppress,
      openSelection,
      removeTab,
      setTabs,
    }),
    [
      getTab,
      updateTab,
      replaceTab,
      upsertObject,
      ensureUrlObject,
      syncCloseSuppress,
      openSelection,
      removeTab,
      setTabs,
    ],
  )

  const value = useMemo<BrowseTabsContextValue>(
    () => ({ tabs, ...actions }),
    [tabs, actions],
  )

  return (
    <BrowseTabActionsContext.Provider value={actions}>
      <BrowseTabsContext.Provider value={value}>
        {children}
      </BrowseTabsContext.Provider>
    </BrowseTabActionsContext.Provider>
  )
}

export function useBrowseTabs(): BrowseTabsContextValue {
  const ctx = useContext(BrowseTabsContext)
  if (!ctx) throw new Error('useBrowseTabs requires BrowseTabsProvider')
  return ctx
}

/**
 * Actions only — this context value never changes, so subscribing does not
 * re-render when a tab is updated. Use it anywhere the tab list is not read.
 */
export function useBrowseTabActions(): BrowseTabActions {
  const ctx = useContext(BrowseTabActionsContext)
  if (!ctx) {
    throw new Error('useBrowseTabActions requires BrowseTabsProvider')
  }
  return ctx
}
