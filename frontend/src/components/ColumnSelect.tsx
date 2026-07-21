import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ColumnInfo, ColumnType } from '../types'

export type ColumnSelectOption = {
  name: string
  type?: ColumnType
}

type Pos = { top: number; left: number; width: number; maxHeight: number }

type Props = {
  columns: readonly ColumnSelectOption[] | readonly ColumnInfo[]
  value: string
  onChange: (name: string) => void
  /** Shown when value is empty. */
  placeholder?: string
  /** Extra empty option (e.g. count → "* (all)"). */
  emptyOption?: { value: ''; label: string }
  /** Mark trigger when required value is missing. */
  incomplete?: boolean
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

function optionLabel(name: string): string {
  const i = name.indexOf('.')
  return i > 0 ? name.slice(i + 1) : name
}

export default function ColumnSelect({
  columns,
  value,
  onChange,
  placeholder = 'Pick column…',
  emptyOption,
  incomplete = false,
  className = '',
  disabled = false,
  'aria-label': ariaLabel = 'Pick column',
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<Pos | null>(null)

  const selected = columns.find((c) => c.name === value)
  const display =
    value === '' && emptyOption
      ? emptyOption.label
      : selected
        ? selected.name
        : value || placeholder

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return [...columns]
    return columns.filter((c) => {
      const bare = optionLabel(c.name).toLowerCase()
      return (
        c.name.toLowerCase().includes(needle) || bare.includes(needle)
      )
    })
  }, [columns, q])

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const update = () => {
      const el = triggerRef.current
      if (!el) {
        setPos(null)
        return
      }
      const r = el.getBoundingClientRect()
      const width = Math.max(r.width, 240)
      const left = Math.max(
        8,
        Math.min(r.left, window.innerWidth - width - 8),
      )
      const spaceBelow = window.innerHeight - r.bottom - 8
      const spaceAbove = r.top - 8
      const placeBelow = spaceBelow >= 200 || spaceBelow >= spaceAbove
      const maxHeight = Math.min(320, placeBelow ? spaceBelow : spaceAbove)
      const top = placeBelow
        ? r.bottom + 4
        : Math.max(8, r.top - maxHeight - 4)
      setPos({ top, left, width, maxHeight })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setQ('')
    const t = window.setTimeout(() => searchRef.current?.focus(), 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      setOpen(false)
    }
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDoc)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDoc)
    }
  }, [open])

  const pick = (name: string) => {
    onChange(name)
    setOpen(false)
  }

  return (
    <div className={`column-select${className ? ` ${className}` : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`column-select-trigger${open ? ' open' : ''}${incomplete ? ' incomplete' : ''}${!value && !emptyOption ? ' empty' : ''}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={display}
      >
        <span className="column-select-value tf-mono">{display}</span>
        <span className="column-select-chevron" aria-hidden>
          ▾
        </span>
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={rootRef}
              className="column-select-popover"
              style={{
                top: pos.top,
                left: pos.left,
                width: pos.width,
                maxHeight: pos.maxHeight,
              }}
              role="listbox"
              aria-label={ariaLabel}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={searchRef}
                className="input column-select-search"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter columns…"
                aria-label="Filter columns"
              />
              <div className="column-select-list">
                {emptyOption ? (
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === ''}
                    className={`column-select-option${value === '' ? ' on' : ''}`}
                    onClick={() => pick('')}
                  >
                    <span className="column-select-name">{emptyOption.label}</span>
                  </button>
                ) : null}
                {filtered.length === 0 ? (
                  <div className="facet-status">No matching columns</div>
                ) : (
                  filtered.map((c) => {
                    const on = c.name === value
                    return (
                      <button
                        key={c.name}
                        type="button"
                        role="option"
                        aria-selected={on}
                        className={`column-select-option${on ? ' on' : ''}`}
                        onClick={() => pick(c.name)}
                        title={c.name}
                      >
                        <span className="column-select-name tf-mono">
                          {c.name}
                        </span>
                        {c.type ? (
                          <span className={`th-type type-${c.type}`}>
                            {c.type}
                          </span>
                        ) : null}
                      </button>
                    )
                  })
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
