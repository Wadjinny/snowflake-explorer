import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useConnections } from './connections'
import type { SavedTransformation } from './transformations'
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
  openDraft: (source: SelectedObject) => OpenTransformTab | null
  openSaved: (saved: SavedTransformation) => OpenTransformTab | null
  updateTab: (
    id: string,
    patch: Partial<
      Pick<
        OpenTransformTab,
        'name' | 'recipe' | 'chart' | 'layout' | 'savedId' | 'dirty'
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

  useEffect(() => {
    if (!activeId) {
      setTabs([])
      return
    }
    setTabs(loadTransformTabs(activeId))
  }, [activeId])

  const persist = (next: OpenTransformTab[]) => {
    if (!activeId) return
    saveTransformTabs(activeId, next)
  }

  const openDraft = (source: SelectedObject): OpenTransformTab | null => {
    if (!activeId) return null
    const tab = makeDraftTab(source)
    setTabs((prev) => {
      const next = [...prev, tab]
      persist(next)
      return next
    })
    return tab
  }

  const openSaved = (saved: SavedTransformation): OpenTransformTab | null => {
    if (!activeId) return null
    const existing = tabs.find((t) => t.savedId === saved.id)
    if (existing) return existing
    const tab = makeTabFromSaved(saved)
    setTabs((prev) => {
      if (prev.some((t) => t.savedId === saved.id)) return prev
      const next = [...prev, tab]
      persist(next)
      return next
    })
    return tab
  }

  const updateTab: TransformTabsContextValue['updateTab'] = (id, patch) => {
    if (!activeId) return
    setTabs((prev) => {
      const next = prev.map((t) => {
        if (t.id !== id) return t
        return {
          ...t,
          ...patch,
          dirty: patch.dirty !== undefined ? patch.dirty : true,
        }
      })
      persist(next)
      return next
    })
  }

  const closeTab = (id: string) => {
    if (!activeId) return
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id)
      persist(next)
      return next
    })
  }

  const getTab = (id: string) => tabs.find((t) => t.id === id)

  return (
    <TransformTabsContext.Provider
      value={{ tabs, openDraft, openSaved, updateTab, closeTab, getTab }}
    >
      {children}
    </TransformTabsContext.Provider>
  )
}

export function useTransformTabs(): TransformTabsContextValue {
  const ctx = useContext(TransformTabsContext)
  if (!ctx) throw new Error('useTransformTabs requires TransformTabsProvider')
  return ctx
}
