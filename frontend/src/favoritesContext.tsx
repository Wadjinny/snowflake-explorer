import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useConnections } from './connections'
import {
  favoritesEqual,
  hasFavorite,
  loadFavorites,
  saveFavorites,
  toggleFavorite,
  type Favorite,
} from './favorites'

type FavoritesContextValue = {
  favorites: Favorite[]
  isFavorite: (fav: Favorite) => boolean
  toggle: (fav: Favorite) => void
  /** Replace the full list (used to drop stale catalog entries). */
  replace: (next: Favorite[]) => void
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null)

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { activeId } = useConnections()
  const [favorites, setFavorites] = useState<Favorite[]>([])

  useEffect(() => {
    if (!activeId) {
      setFavorites([])
      return
    }
    setFavorites(loadFavorites(activeId))
  }, [activeId])

  const toggle = (fav: Favorite) => {
    if (!activeId) return
    setFavorites((prev) => {
      const next = toggleFavorite(prev, fav)
      saveFavorites(activeId, next)
      return next
    })
  }

  const replace = useCallback(
    (next: Favorite[]) => {
      if (!activeId) return
      setFavorites((prev) => {
        if (favoritesEqual(prev, next)) return prev
        saveFavorites(activeId, next)
        return next
      })
    },
    [activeId],
  )

  const isFavorite = (fav: Favorite) => hasFavorite(favorites, fav)

  return (
    <FavoritesContext.Provider value={{ favorites, isFavorite, toggle, replace }}>
      {children}
    </FavoritesContext.Provider>
  )
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error('useFavorites requires FavoritesProvider')
  return ctx
}
