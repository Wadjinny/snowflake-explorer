/** Global preferred page size (browse + transform). Persisted in localStorage. */

const STORAGE_KEY = 'sf-explorer.defaultPageSize'

export const FALLBACK_PAGE_SIZE = 100
export const PAGE_SIZE_MAX = 5000
/** Preview API max (`PreviewRequest.limit`). */
export const BROWSE_PAGE_SIZE_MAX = 1000

export function clampPageSize(
  value: number,
  max: number = PAGE_SIZE_MAX,
): number {
  return Math.min(max, Math.max(1, Math.floor(value)))
}

export function getDefaultPageSize(max: number = PAGE_SIZE_MAX): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null) return Math.min(FALLBACK_PAGE_SIZE, max)
    const n = Number(raw)
    if (!Number.isFinite(n)) return Math.min(FALLBACK_PAGE_SIZE, max)
    return clampPageSize(n, max)
  } catch {
    return Math.min(FALLBACK_PAGE_SIZE, max)
  }
}

export function setDefaultPageSize(value: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampPageSize(value)))
  } catch {
    // ignore quota / private mode
  }
}
