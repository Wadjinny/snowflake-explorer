import { useCallback, useEffect, useRef } from 'react'

/** Quiet period before tab state is written to Web Storage. */
export const PERSIST_DEBOUNCE_MS = 300

/**
 * Persist `value` under `key` after a quiet period instead of on every change.
 *
 * Tab state is rewritten on every grid scroll tick, filter edit and transform
 * builder keystroke. Serializing it synchronously inside the state updater put
 * a full `JSON.stringify` of every open tab on the interaction path (and ran it
 * twice under StrictMode, since a reducer must not have side effects).
 *
 * Pending writes are flushed when `key` changes (connection switch), when the
 * provider unmounts, and when the page is hidden, so nothing is dropped.
 */
export function useDebouncedPersist<T>(
  key: string | null,
  value: T,
  save: (key: string, value: T) => void,
): void {
  const pending = useRef<{ key: string; value: T } | null>(null)
  const saveRef = useRef(save)
  saveRef.current = save

  const flush = useCallback(() => {
    const entry = pending.current
    if (!entry) return
    pending.current = null
    saveRef.current(entry.key, entry.value)
  }, [])

  useEffect(() => {
    if (key == null) return
    pending.current = { key, value }
    const timer = setTimeout(flush, PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [key, value, flush])

  // Runs before the next effect for a changed key, so the outgoing
  // connection's pending write lands under its own key.
  useEffect(() => flush, [key, flush])

  useEffect(() => {
    const onHide = () => flush()
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [flush])
}
