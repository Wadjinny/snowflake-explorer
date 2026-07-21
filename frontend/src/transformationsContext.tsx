import {
  createContext,
  useContext,
  useEffect,
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

type TransformationsContextValue = {
  transformations: SavedTransformation[]
  add: (input: {
    name?: string
    recipe: TransformRecipe
    chart?: ChartConfig
    layout?: TransformPanelLayout
  }) => SavedTransformation | null
  update: (
    id: string,
    patch: Partial<
      Pick<SavedTransformation, 'name' | 'recipe' | 'chart' | 'layout'>
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

  useEffect(() => {
    if (!activeId) {
      setTransformations([])
      return
    }
    setTransformations(loadTransformations(activeId))
  }, [activeId])

  const persist = (next: SavedTransformation[]) => {
    if (!activeId) return
    saveTransformations(activeId, next)
  }

  const add: TransformationsContextValue['add'] = (input) => {
    if (!activeId) return null
    const created = makeTransformation(input)
    setTransformations((prev) => {
      const next = [created, ...prev]
      persist(next)
      return next
    })
    return created
  }

  const update: TransformationsContextValue['update'] = (id, patch) => {
    if (!activeId) return
    setTransformations((prev) => {
      const next = prev.map((t) => {
        if (t.id !== id) return t
        return {
          ...t,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.recipe !== undefined ? { recipe: patch.recipe } : {}),
          ...(patch.chart !== undefined ? { chart: patch.chart } : {}),
          ...(patch.layout !== undefined ? { layout: patch.layout } : {}),
        }
      })
      persist(next)
      return next
    })
  }

  const remove = (id: string) => {
    if (!activeId) return
    setTransformations((prev) => {
      const next = prev.filter((t) => t.id !== id)
      persist(next)
      return next
    })
  }

  const rename = (id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    update(id, { name: trimmed })
  }

  const duplicate = (id: string): SavedTransformation | null => {
    if (!activeId) return null
    const src = transformations.find((t) => t.id === id)
    if (!src) return null
    return add({
      name: `${src.name} copy`,
      recipe: structuredClone(src.recipe),
      chart: structuredClone(src.chart),
      layout: structuredClone(src.layout),
    })
  }

  return (
    <TransformationsContext.Provider
      value={{ transformations, add, update, remove, rename, duplicate }}
    >
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
