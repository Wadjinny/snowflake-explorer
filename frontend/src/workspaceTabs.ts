import { shortObjectLabel } from './paths'
import { tabPath, type OpenTab } from './openTabs'
import { transformPath, type OpenTransformTab } from './transformTabs'

export type UnifiedTabKind = 'browse' | 'transform'

export type UnifiedTabIcon = 'table' | 'view' | 'bookmark' | 'transform'

export type UnifiedTabItem = {
  handle: string
  kind: UnifiedTabKind
  icon: UnifiedTabIcon
  label: string
  dirty: boolean
  draft: boolean
  path: string
  title: string
  /** Browse tab key or transform session id. */
  id: string
}

export function browseHandle(key: string): string {
  return `b:${key}`
}

export function transformHandle(id: string): string {
  return `t:${id}`
}

export function parseHandle(
  handle: string,
): { kind: UnifiedTabKind; id: string } | null {
  if (handle.startsWith('b:')) return { kind: 'browse', id: handle.slice(2) }
  if (handle.startsWith('t:')) return { kind: 'transform', id: handle.slice(2) }
  return null
}

function orderStorageKey(connectionId: string): string {
  return `sf-explorer.tabOrder:${connectionId}`
}

export function loadTabOrder(connectionId: string): string[] {
  try {
    const raw = sessionStorage.getItem(orderStorageKey(connectionId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((h): h is string => typeof h === 'string')
  } catch {
    return []
  }
}

export function saveTabOrder(connectionId: string, order: string[]): void {
  try {
    sessionStorage.setItem(orderStorageKey(connectionId), JSON.stringify(order))
  } catch {
    // ignore quota errors
  }
}

/** Sync persisted order with live tabs: drop stale, append new at end. */
export function syncTabOrder(
  prev: string[],
  browseTabs: OpenTab[],
  transformTabs: OpenTransformTab[],
): string[] {
  const browseHandles = browseTabs.map((t) => browseHandle(t.key))
  const transformHandles = transformTabs.map((t) => transformHandle(t.id))
  const known = new Set([...browseHandles, ...transformHandles])
  const kept = prev.filter((h) => known.has(h))
  const keptSet = new Set(kept)

  if (prev.length === 0 && known.size > 0) {
    return [...browseHandles, ...transformHandles]
  }

  const additions: string[] = []
  for (const h of browseHandles) {
    if (!keptSet.has(h) && !additions.includes(h)) additions.push(h)
  }
  for (const h of transformHandles) {
    if (!keptSet.has(h) && !additions.includes(h)) additions.push(h)
  }
  return [...kept, ...additions]
}

export function renameHandleInOrder(
  order: string[],
  oldHandle: string,
  newHandle: string,
): string[] {
  if (oldHandle === newHandle) return order
  return order.map((h) => (h === oldHandle ? newHandle : h))
}

export function browseTabItem(tab: OpenTab): UnifiedTabItem {
  const isSelection = Boolean(tab.selectionId)
  const label = isSelection
    ? (tab.selectionName ?? shortObjectLabel(tab.object))
    : shortObjectLabel(tab.object)
  return {
    handle: browseHandle(tab.key),
    kind: 'browse',
    icon: isSelection
      ? 'bookmark'
      : tab.object.kind === 'view'
        ? 'view'
        : 'table',
    label,
    dirty: Boolean(tab.selectionId && tab.dirty),
    draft: false,
    path: tabPath(tab),
    title: isSelection
      ? `${label}${tab.dirty ? ' (unsaved)' : ''}`
      : label,
    id: tab.key,
  }
}

export function transformTabItem(tab: OpenTransformTab): UnifiedTabItem {
  return {
    handle: transformHandle(tab.id),
    kind: 'transform',
    icon: 'transform',
    label: tab.name,
    dirty: tab.dirty,
    draft: !tab.savedId,
    path: transformPath(tab.id),
    title: tab.name,
    id: tab.id,
  }
}

export function buildUnifiedItems(
  order: string[],
  browseTabs: OpenTab[],
  transformTabs: OpenTransformTab[],
): UnifiedTabItem[] {
  const browseByKey = new Map(browseTabs.map((t) => [t.key, t]))
  const transformById = new Map(transformTabs.map((t) => [t.id, t]))
  const items: UnifiedTabItem[] = []
  for (const handle of order) {
    const parsed = parseHandle(handle)
    if (!parsed) continue
    if (parsed.kind === 'browse') {
      const tab = browseByKey.get(parsed.id)
      if (tab) items.push(browseTabItem(tab))
    } else {
      const tab = transformById.get(parsed.id)
      if (tab) items.push(transformTabItem(tab))
    }
  }
  return items
}

/** Neighbor path after closing `handle`, or `/` if none. */
export function fallbackPathAfterClose(
  order: string[],
  handle: string,
  browseTabs: OpenTab[],
  transformTabs: OpenTransformTab[],
): string {
  const idx = order.indexOf(handle)
  const nextOrder = order.filter((h) => h !== handle)
  const pick =
    (idx >= 0 ? nextOrder[idx] : undefined) ??
    (idx > 0 ? nextOrder[idx - 1] : undefined) ??
    nextOrder[0]
  if (!pick) return '/'
  const items = buildUnifiedItems(nextOrder, browseTabs, transformTabs)
  return items.find((i) => i.handle === pick)?.path ?? '/'
}
