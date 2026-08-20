import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  ACTIVE_KEY,
  CONNECTIONS_KEY,
  loadActiveId,
  loadConnections,
} from './connectionStorage'
import type { Connection } from './types'

type ConnectionsContextValue = {
  connections: Connection[]
  activeId: string | null
  active: Connection | null
  setActiveId: (id: string | null) => void
  upsert: (connection: Connection) => void
  remove: (id: string) => void
}

const ConnectionsContext = createContext<ConnectionsContextValue | null>(null)

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const [connections, setConnections] = useState<Connection[]>(() =>
    loadConnections(),
  )
  const [activeId, setActiveIdState] = useState<string | null>(() =>
    loadActiveId(loadConnections()),
  )

  useEffect(() => {
    localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections))
  }, [connections])

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId)
    else localStorage.removeItem(ACTIVE_KEY)
  }, [activeId])

  const setActiveId = useCallback((id: string | null) => {
    setActiveIdState(id)
  }, [])

  const upsert = useCallback((connection: Connection) => {
    setConnections((prev) => {
      const idx = prev.findIndex((c) => c.id === connection.id)
      if (idx === -1) return [...prev, connection]
      const next = [...prev]
      next[idx] = connection
      return next
    })
    setActiveIdState((current) => current ?? connection.id)
  }, [])

  const remove = useCallback((id: string) => {
    setConnections((prev) => {
      const next = prev.filter((c) => c.id !== id)
      setActiveIdState((current) => {
        if (current !== id) return current
        return next[0]?.id ?? null
      })
      return next
    })
  }, [])

  const active = useMemo(
    () => connections.find((c) => c.id === activeId) ?? null,
    [connections, activeId],
  )

  const value = useMemo(
    () => ({ connections, activeId, active, setActiveId, upsert, remove }),
    [connections, activeId, active, setActiveId, upsert, remove],
  )

  return (
    <ConnectionsContext.Provider value={value}>
      {children}
    </ConnectionsContext.Provider>
  )
}

export function useConnections(): ConnectionsContextValue {
  const ctx = useContext(ConnectionsContext)
  if (!ctx) {
    throw new Error('useConnections must be used within ConnectionsProvider')
  }
  return ctx
}
