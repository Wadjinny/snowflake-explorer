import { useEffect, useRef } from 'react'
import type { ColumnInfo } from '../types'

type Props = {
  columns: ColumnInfo[]
  hiddenColumns: string[]
  onChange: (hidden: string[]) => void
  onClose: () => void
}

export default function ColumnPicker({
  columns,
  hiddenColumns,
  onChange,
  onClose,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const hidden = new Set(hiddenColumns)
  const visibleCount = columns.filter((c) => !hidden.has(c.name)).length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDoc)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDoc)
    }
  }, [onClose])

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
      className="column-picker"
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

      <div className="facet-list">
        {columns.map((col) => {
          const checked = !hidden.has(col.name)
          const disableUncheck = checked && visibleCount <= 1
          return (
            <label key={col.name} className="facet-row">
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
        })}
      </div>
    </div>
  )
}
