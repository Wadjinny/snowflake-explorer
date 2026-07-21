import type { Connection } from './types'

export const CONNECTIONS_KEY = 'sf-explorer.connections'
export const ACTIVE_KEY = 'sf-explorer.activeConnectionId'

export function newConnectionId(): string {
  return crypto.randomUUID()
}

export function emptyConnection(): Connection {
  return {
    id: newConnectionId(),
    name: '',
    account: '',
    user: '',
    password: '',
    warehouse: '',
    role: '',
  }
}

export function loadConnections(): Connection[] {
  try {
    const raw = localStorage.getItem(CONNECTIONS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isConnection)
  } catch {
    return []
  }
}

export function loadActiveId(connections: Connection[]): string | null {
  try {
    const id = localStorage.getItem(ACTIVE_KEY)
    if (!id) return connections[0]?.id ?? null
    if (connections.some((c) => c.id === id)) return id
    return connections[0]?.id ?? null
  } catch {
    return connections[0]?.id ?? null
  }
}

function isConnection(value: unknown): value is Connection {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    typeof c.account === 'string' &&
    typeof c.user === 'string' &&
    typeof c.password === 'string' &&
    typeof c.warehouse === 'string' &&
    (c.role === undefined || typeof c.role === 'string')
  )
}
