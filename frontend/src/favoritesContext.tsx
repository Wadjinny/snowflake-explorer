import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useConnections } from './connections'
import {
  favoriteKey,
  favoritesEqual,
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

  const toggle = useCallback(
    (fav: Favorite) => {
      if (!activeId) return
      setFavorites((prev) => {
        const next = toggleFavorite(prev, fav)
        saveFavorites(activeId, next)
        return next
      })
    },
    [activeId],
  )

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

  // The object tree asks once per row; a linear scan per call made favorite
  // lookup O(rows x favorites).
  const keys = useMemo(() => new Set(favorites.map(favoriteKey)), [favorites])
  const isFavorite = useCallback(
    (fav: Favorite) => keys.has(favoriteKey(fav)),
    [keys],
  )

  const value = useMemo(
    () => ({ favorites, isFavorite, toggle, replace }),
    [favorites, isFavorite, toggle, replace],
  )

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  )
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error('useFavorites requires FavoritesProvider')
  return ctx
}
