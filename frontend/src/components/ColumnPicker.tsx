import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveColumnOrder } from '../openTabs'
import type { ColumnInfo } from '../types'

type Props = {
  columns: ColumnInfo[]
  hiddenColumns: string[]
  columnOrder?: string[]
  onChange: (hidden: string[]) => void
  onClose: () => void
  onHoverColumn?: (name: string | null) => void
}

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  )
}

export default function ColumnPicker({
  columns,
  hiddenColumns,
  columnOrder = [],
  onChange,
  onClose,
  onHoverColumn,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [hovered, setHovered] = useState<string | null>(null)
  const [seeThrough, setSeeThrough] = useState(false)
  const hidden = new Set(hiddenColumns)
  const visibleCount = columns.filter((c) => !hidden.has(c.name)).length

  const orderedColumns = useMemo(() => {
    const byName = new Map(columns.map((c) => [c.name, c]))
    return resolveColumnOrder(
      columns.map((c) => c.name),
      columnOrder,
    )
      .map((name) => byName.get(name))
      .filter((c): c is ColumnInfo => Boolean(c))
  }, [columns, columnOrder])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return orderedColumns
    return orderedColumns.filter((c) => c.name.toLowerCase().includes(q))
  }, [orderedColumns, query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDoc)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDoc)
    }
  }, [onClose])

  useEffect(() => {
    return () => onHoverColumn?.(null)
  }, [onHoverColumn])

  // Fade the panel when it covers the highlighted table column.
  useEffect(() => {
    if (!hovered) {
      setSeeThrough(false)
      return
    }

    let cancelled = false
    const check = () => {
      if (cancelled) return
      const panel = rootRef.current
      if (!panel) {
        setSeeThrough(false)
        return
      }
      const th = document.querySelector(
        `.data-table th[data-col="${CSS.escape(hovered)}"]`,
      )
      if (!(th instanceof HTMLElement)) {
        setSeeThrough(false)
        return
      }
      setSeeThrough(
        rectsOverlap(panel.getBoundingClientRect(), th.getBoundingClientRect()),
      )
    }

    const timers: number[] = []
    // After React paints the (possibly ghost) column + smooth scroll.
    const raf = requestAnimationFrame(() => {
      check()
      timers.push(window.setTimeout(check, 80), window.setTimeout(check, 350))
    })

    const onScroll = () => check()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      for (const t of timers) window.clearTimeout(t)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [hovered, filtered.length, hiddenColumns])

  const setHover = (name: string | null) => {
    setHovered(name)
    onHoverColumn?.(name)
  }

  const toggle = (name: string) => {
    if (hidden.has(name)) {
      onChange(hiddenColumns.filter((c) => c !== name))
      return
    }
    // Keep at least one column visible
    if (visibleCount <= 1) return
    onChange([...hiddenColumns, name])
  }

  const showAll = () => onChange([])

  const hideAllButFirst = () => {
    if (columns.length === 0) return
    onChange(columns.slice(1).map((c) => c.name))
  }

  return (
    <div
      ref={rootRef}
      className={`column-picker${seeThrough ? ' column-picker-see-through' : ''}`}
      role="dialog"
      aria-label="Visible columns"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="column-picker-head">
        <span className="facet-title">Columns</span>
        <span className="kind-badge">
          {visibleCount}/{columns.length}
        </span>
      </div>

      <div className="column-picker-actions">
        <button type="button" className="btn-micro" onClick={showAll}>
          Show all
        </button>
        <button type="button" className="btn-micro" onClick={hideAllButFirst}>
          First only
        </button>
      </div>

      <input
        className="column-picker-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter columns…"
        aria-label="Filter columns"
        autoFocus
      />

      <div className="facet-list">
        {filtered.length === 0 ? (
          <div className="facet-empty">No matching columns</div>
        ) : (
          filtered.map((col) => {
            const checked = !hidden.has(col.name)
            const disableUncheck = checked && visibleCount <= 1
            return (
              <label
                key={col.name}
                className={`facet-row${checked ? '' : ' facet-row-hidden'}`}
                onMouseEnter={() => setHover(col.name)}
                onMouseLeave={() => setHover(null)}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disableUncheck}
                  onChange={() => toggle(col.name)}
                />
                <span className="facet-value" title={col.name}>
                  {col.name}
                </span>
                <span className={`kind-badge type-${col.type}`}>{col.type}</span>
              </label>
            )
          })
        )}
      </div>
    </div>
  )
}
