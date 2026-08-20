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
import { useDebouncedPersist } from './persistTabs'
import type {
  BrowseTransformSeed,
  SavedTransformation,
} from './transformations'
import {
  loadTransformTabs,
  makeDraftTab,
  makeTabFromSaved,
  saveTransformTabs,
  type OpenTransformTab,
} from './transformTabs'
import type { SelectedObject } from './types'

type TransformTabsContextValue = {
  tabs: OpenTransformTab[]
  openDraft: (
    source: SelectedObject,
    seed?: BrowseTransformSeed,
  ) => OpenTransformTab | null
  openSaved: (saved: SavedTransformation) => OpenTransformTab | null
  updateTab: (
    id: string,
    patch: Partial<
      Pick<
        OpenTransformTab,
        | 'name'
        | 'recipe'
        | 'chart'
        | 'layout'
        | 'columnOrder'
        | 'columnWidths'
        | 'pageSize'
        | 'offset'
        | 'savedId'
        | 'dirty'
      >
    >,
  ) => void
  closeTab: (id: string) => void
  getTab: (id: string) => OpenTransformTab | undefined
}

const TransformTabsContext = createContext<TransformTabsContextValue | null>(
  null,
)

export function TransformTabsProvider({ children }: { children: ReactNode }) {
  const { activeId } = useConnections()
  const [tabs, setTabs] = useState<OpenTransformTab[]>([])
  /** Lets the actions below read current tabs without depending on them. */
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  useEffect(() => {
    if (!activeId) {
      setTabs([])
      return
    }
    setTabs(loadTransformTabs(activeId))
  }, [activeId])

  // Recipes are rewritten on every builder keystroke; debounce the write.
  useDebouncedPersist(activeId, tabs, saveTransformTabs)

  const openDraft = useCallback(
    (
      source: SelectedObject,
      seed?: BrowseTransformSeed,
    ): OpenTransformTab | null => {
      if (!activeIdRef.current) return null
      const tab = makeDraftTab(source, seed)
      setTabs((prev) => [...prev, tab])
      return tab
    },
    [],
  )

  const openSaved = useCallback(
    (saved: SavedTransformation): OpenTransformTab | null => {
      if (!activeIdRef.current) return null
      const existing = tabsRef.current.find((t) => t.savedId === saved.id)
      if (existing) return existing
      const tab = makeTabFromSaved(saved)
      setTabs((prev) =>
        prev.some((t) => t.savedId === saved.id) ? prev : [...prev, tab],
      )
      return tab
    },
    [],
  )

  const updateTab = useCallback<TransformTabsContextValue['updateTab']>(
    (id, patch) => {
      if (!activeIdRef.current) return
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                dirty: patch.dirty !== undefined ? patch.dirty : true,
              }
            : t,
        ),
      )
    },
    [],
  )

  const closeTab = useCallback((id: string) => {
    if (!activeIdRef.current) return
    setTabs((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const getTab = useCallback(
    (id: string) => tabsRef.current.find((t) => t.id === id),
    [],
  )

  const value = useMemo<TransformTabsContextValue>(
    () => ({ tabs, openDraft, openSaved, updateTab, closeTab, getTab }),
    [tabs, openDraft, openSaved, updateTab, closeTab, getTab],
  )

  return (
    <TransformTabsContext.Provider value={value}>
      {children}
    </TransformTabsContext.Provider>
  )
}

export function useTransformTabs(): TransformTabsContextValue {
  const ctx = useContext(TransformTabsContext)
  if (!ctx) throw new Error('useTransformTabs requires TransformTabsProvider')
  return ctx
}
