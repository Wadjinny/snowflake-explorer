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
  loadTransformations,
  makeTransformation,
  saveTransformations,
  type ChartConfig,
  type SavedTransformation,
  type TransformPanelLayout,
  type TransformRecipe,
} from './transformations'
import { getDefaultPageSize } from './pageSizePrefs'

type TransformationsContextValue = {
  transformations: SavedTransformation[]
  add: (input: {
    name?: string
    recipe: TransformRecipe
    chart?: ChartConfig
    layout?: TransformPanelLayout
    columnOrder?: string[]
    columnWidths?: Record<string, number>
    pageSize?: number
  }) => SavedTransformation | null
  update: (
    id: string,
    patch: Partial<
      Pick<
        SavedTransformation,
        | 'name'
        | 'recipe'
        | 'chart'
        | 'layout'
        | 'columnOrder'
        | 'columnWidths'
        | 'pageSize'
      >
    >,
  ) => void
  remove: (id: string) => void
  rename: (id: string, name: string) => void
  duplicate: (id: string) => SavedTransformation | null
}

const TransformationsContext =
  createContext<TransformationsContextValue | null>(null)

export function TransformationsProvider({ children }: { children: ReactNode }) {
  const { activeId } = useConnections()
  const [transformations, setTransformations] = useState<
    SavedTransformation[]
  >([])
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const itemsRef = useRef(transformations)
  itemsRef.current = transformations

  useEffect(() => {
    if (!activeId) {
      setTransformations([])
      return
    }
    setTransformations(loadTransformations(activeId))
  }, [activeId])

  const persist = (next: SavedTransformation[]) => {
    const id = activeIdRef.current
    if (!id) return
    saveTransformations(id, next)
  }

  const add = useCallback<TransformationsContextValue['add']>((input) => {
    if (!activeIdRef.current) return null
    const created = makeTransformation(input)
    setTransformations((prev) => {
      const next = [created, ...prev]
      persist(next)
      return next
    })
    return created
  }, [])

  const update = useCallback<TransformationsContextValue['update']>((id, patch) => {
    if (!activeIdRef.current) return
    setTransformations((prev) => {
      const next = prev.map((t) => {
        if (t.id !== id) return t
        return {
          ...t,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.recipe !== undefined ? { recipe: patch.recipe } : {}),
          ...(patch.chart !== undefined ? { chart: patch.chart } : {}),
          ...(patch.layout !== undefined ? { layout: patch.layout } : {}),
          ...(patch.columnOrder !== undefined
            ? { columnOrder: patch.columnOrder }
            : {}),
          ...(patch.columnWidths !== undefined
            ? { columnWidths: patch.columnWidths }
            : {}),
          ...(patch.pageSize !== undefined ? { pageSize: patch.pageSize } : {}),
        }
      })
      persist(next)
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    if (!activeIdRef.current) return
    setTransformations((prev) => {
      const next = prev.filter((t) => t.id !== id)
      persist(next)
      return next
    })
  }, [])

  const rename = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      update(id, { name: trimmed })
    },
    [update],
  )

  const duplicate = useCallback((id: string): SavedTransformation | null => {
    if (!activeIdRef.current) return null
    const src = itemsRef.current.find((t) => t.id === id)
    if (!src) return null
    return add({
      name: `${src.name} copy`,
      recipe: structuredClone(src.recipe),
      chart: structuredClone(src.chart),
      layout: structuredClone(src.layout),
      columnOrder: [...(src.columnOrder ?? [])],
      columnWidths: { ...(src.columnWidths ?? {}) },
      pageSize: src.pageSize ?? getDefaultPageSize(),
    })
  }, [add])

  const value = useMemo(
    () => ({ transformations, add, update, remove, rename, duplicate }),
    [transformations, add, update, remove, rename, duplicate],
  )

  return (
    <TransformationsContext.Provider value={value}>
      {children}
    </TransformationsContext.Provider>
  )
}

export function useTransformations(): TransformationsContextValue {
  const ctx = useContext(TransformationsContext)
  if (!ctx)
    throw new Error('useTransformations requires TransformationsProvider')
  return ctx
}
