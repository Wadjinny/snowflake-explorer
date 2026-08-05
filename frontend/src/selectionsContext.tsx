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

export type SelectionUpdate = {
  name?: string
  object?: SelectedObject
  filters?: ColumnFilter[]
  sort?: SortSpec | null
  hiddenColumns?: string[]
  columnOrder?: string[]
  columnWidths?: Record<string, number>
  limit?: number
}

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
  update: (id: string, patch: SelectionUpdate) => void
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

  const persist = (next: SavedSelection[]) => {
    if (!activeId) return
    saveSelections(activeId, next)
  }

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
      persist(next)
      return next
    })
    return created
  }

  const update = (id: string, patch: SelectionUpdate) => {
    if (!activeId) return
    setSelections((prev) => {
      const next = prev.map((s) => {
        if (s.id !== id) return s
        return {
          ...s,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.object !== undefined ? { object: patch.object } : {}),
          ...(patch.filters !== undefined ? { filters: patch.filters } : {}),
          ...(patch.sort !== undefined ? { sort: patch.sort } : {}),
          ...(patch.hiddenColumns !== undefined
            ? { hiddenColumns: patch.hiddenColumns }
            : {}),
          ...(patch.columnOrder !== undefined
            ? { columnOrder: patch.columnOrder }
            : {}),
          ...(patch.columnWidths !== undefined
            ? { columnWidths: patch.columnWidths }
            : {}),
          ...(patch.limit !== undefined ? { limit: patch.limit } : {}),
        }
      })
      persist(next)
      return next
    })
  }

  const remove = (id: string) => {
    if (!activeId) return
    setSelections((prev) => {
      const next = prev.filter((s) => s.id !== id)
      persist(next)
      return next
    })
  }

  const rename = (id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    update(id, { name: trimmed })
  }

  return (
    <SelectionsContext.Provider
      value={{ selections, add, update, remove, rename }}
    >
      {children}
    </SelectionsContext.Provider>
  )
}

export function useSelections(): SelectionsContextValue {
  const ctx = useContext(SelectionsContext)
  if (!ctx) throw new Error('useSelections requires SelectionsProvider')
  return ctx
}
