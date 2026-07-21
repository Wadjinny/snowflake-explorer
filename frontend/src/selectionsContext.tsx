import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useConnections } from './connections'
import {
  loadSelections,
  makeSelection,
  saveSelections,
  type SavedSelection,
} from './selections'
import type { ColumnFilter, SelectedObject, SortSpec } from './types'

type SelectionsContextValue = {
  selections: SavedSelection[]
  add: (input: {
    name?: string
    object: SelectedObject
    filters: ColumnFilter[]
    sort: SortSpec | null
    hiddenColumns: string[]
    columnOrder: string[]
    columnWidths: Record<string, number>
    limit: number
  }) => SavedSelection | null
  remove: (id: string) => void
  rename: (id: string, name: string) => void
}

const SelectionsContext = createContext<SelectionsContextValue | null>(null)

export function SelectionsProvider({ children }: { children: ReactNode }) {
  const { activeId } = useConnections()
  const [selections, setSelections] = useState<SavedSelection[]>([])

  useEffect(() => {
    if (!activeId) {
      setSelections([])
      return
    }
    setSelections(loadSelections(activeId))
  }, [activeId])

  const add: SelectionsContextValue['add'] = (input) => {
    if (!activeId) return null
    const created = makeSelection({
      name: input.name ?? '',
      object: input.object,
      filters: input.filters,
      sort: input.sort,
      hiddenColumns: input.hiddenColumns,
      columnOrder: input.columnOrder,
      columnWidths: input.columnWidths,
      limit: input.limit,
    })
    setSelections((prev) => {
      const next = [created, ...prev]
      saveSelections(activeId, next)
      return next
    })
    return created
  }

  const remove = (id: string) => {
    if (!activeId) return
    setSelections((prev) => {
      const next = prev.filter((s) => s.id !== id)
      saveSelections(activeId, next)
      return next
    })
  }

  const rename = (id: string, name: string) => {
    if (!activeId) return
    const trimmed = name.trim()
    if (!trimmed) return
    setSelections((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, name: trimmed } : s))
      saveSelections(activeId, next)
      return next
    })
  }

  return (
    <SelectionsContext.Provider value={{ selections, add, remove, rename }}>
      {children}
    </SelectionsContext.Provider>
  )
}

export function useSelections(): SelectionsContextValue {
  const ctx = useContext(SelectionsContext)
  if (!ctx) throw new Error('useSelections requires SelectionsProvider')
  return ctx
}
