import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { listDatabases, listObjects, listSchemas } from '../api/snowflake'
import type { Connection, ObjectItem, SelectedObject } from '../types'
import Spinner from './Spinner'
import {
  ChevronIcon,
  CloseIcon,
  DatabaseIcon,
  FolderIcon,
  TableIcon,
  ViewIcon,
} from './TreeIcons'

type Props = {
  connection: Connection
  value: SelectedObject
  onChange: (next: SelectedObject) => void
  onClose: () => void
  /** Anchor element for fixed positioning (avoids overflow clipping). */
  anchorRef?: React.RefObject<HTMLElement | null>
}

type Pos = { top: number; left: number; width: number }

export default function TablePicker({
  connection,
  value,
  onChange,
  onClose,
  anchorRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<Pos | null>(null)
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(
    () => new Set(value.database ? [value.database] : []),
  )
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(
    () =>
      new Set(
        value.database && value.schema
          ? [`${value.database}\0${value.schema}`]
          : [],
      ),
  )

  const databases = useQuery({
    queryKey: ['databases', connection.id],
    queryFn: () => listDatabases(connection),
  })

  useLayoutEffect(() => {
    const update = () => {
      const el = anchorRef?.current
      if (!el) {
        setPos(null)
        return
      }
      const r = el.getBoundingClientRect()
      const width = Math.max(r.width, 320)
      const left = Math.min(r.left, window.innerWidth - width - 8)
      setPos({
        top: r.bottom + 4,
        left: Math.max(8, left),
        width,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorRef])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (anchorRef?.current?.contains(t)) return
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDoc)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDoc)
    }
  }, [onClose, anchorRef])

  const needle = q.trim().toLowerCase()

  const filteredDbs = useMemo(() => {
    const list = databases.data ?? []
    if (!needle) return list
    // Prefer DB name matches; otherwise keep full catalog (search applies to tables).
    const byName = list.filter((d) => d.name.toLowerCase().includes(needle))
    return byName.length > 0 ? byName : list
  }, [databases.data, needle])

  const toggleDb = (name: string) => {
    setExpandedDbs((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleSchema = (database: string, schema: string) => {
    const key = `${database}\0${schema}`
    setExpandedSchemas((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const pick = (next: SelectedObject) => {
    onChange(next)
    onClose()
  }

  const body = (
    <div
      ref={rootRef}
      className={`table-picker${pos ? ' table-picker-fixed' : ''}`}
      style={
        pos
          ? {
              top: pos.top,
              left: pos.left,
              width: pos.width,
            }
          : undefined
      }
      role="dialog"
      aria-label="Pick table or view"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="table-picker-head">
        <span className="table-picker-title">Pick table / view</span>
        <button
          type="button"
          className="btn-micro btn-icon"
          onClick={onClose}
          title="Close"
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </div>

      <input
        className="input table-picker-search"
        type="search"
        placeholder="Filter tables / views…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />

      {value.name ? (
        <div className="table-picker-current">
          <span className="tf-label">Current</span>
          <span className="tf-mono table-picker-current-fqn">
            {value.database}.{value.schema}.{value.name}
          </span>
        </div>
      ) : null}

      <div className="table-picker-tree">
        {databases.isLoading && !databases.data ? (
          <div className="facet-status">
            <Spinner size="sm" label="Loading databases…" />
          </div>
        ) : databases.isError ? (
          <div className="facet-status error">
            {databases.error instanceof Error
              ? databases.error.message
              : 'Failed to load databases'}
          </div>
        ) : filteredDbs.length === 0 ? (
          <div className="facet-status">No databases</div>
        ) : (
          filteredDbs.map((db) => {
            const open = expandedDbs.has(db.name)
            const activeDb = db.name === value.database
            return (
              <div key={db.name} className="table-picker-node">
                <button
                  type="button"
                  className={`table-picker-row depth-0${activeDb ? ' path' : ''}`}
                  onClick={() => toggleDb(db.name)}
                >
                  <span className="table-picker-chevron">
                    <ChevronIcon open={open} />
                  </span>
                  <DatabaseIcon />
                  <span className="table-picker-name">{db.name}</span>
                </button>
                {open ? (
                  <SchemaBranch
                    connection={connection}
                    database={db.name}
                    value={value}
                    expandedSchemas={expandedSchemas}
                    objectFilter={needle}
                    onToggleSchema={toggleSchema}
                    onPick={pick}
                  />
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )

  if (anchorRef) {
    return createPortal(body, document.body)
  }
  return body
}

function SchemaBranch({
  connection,
  database,
  value,
  expandedSchemas,
  objectFilter,
  onToggleSchema,
  onPick,
}: {
  connection: Connection
  database: string
  value: SelectedObject
  expandedSchemas: Set<string>
  objectFilter: string
  onToggleSchema: (database: string, schema: string) => void
  onPick: (next: SelectedObject) => void
}) {
  const schemas = useQuery({
    queryKey: ['schemas', connection.id, database],
    queryFn: () => listSchemas(connection, database),
  })

  // Never hide schemas while filtering — filter applies to table/view names only.
  const list = schemas.data ?? []

  if (schemas.isLoading && !schemas.data) {
    return (
      <div className="facet-status table-picker-nested">
        <Spinner size="sm" label="Loading schemas…" />
      </div>
    )
  }
  if (schemas.isError) {
    return (
      <div className="facet-status error table-picker-nested">
        {schemas.error instanceof Error
          ? schemas.error.message
          : 'Failed to load schemas'}
      </div>
    )
  }
  if (list.length === 0) {
    return (
      <div className="facet-status table-picker-nested">No schemas</div>
    )
  }

  return (
    <>
      {list.map((s) => {
        const key = `${database}\0${s.name}`
        const open = expandedSchemas.has(key)
        const activeSchema =
          database === value.database && s.name === value.schema
        return (
          <div key={s.name} className="table-picker-node">
            <button
              type="button"
              className={`table-picker-row depth-1${activeSchema ? ' path' : ''}`}
              onClick={() => onToggleSchema(database, s.name)}
            >
              <span className="table-picker-chevron">
                <ChevronIcon open={open} />
              </span>
              <FolderIcon open={open} />
              <span className="table-picker-name">{s.name}</span>
            </button>
            {open ? (
              <ObjectBranch
                connection={connection}
                database={database}
                schema={s.name}
                value={value}
                objectFilter={objectFilter}
                onPick={onPick}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function ObjectBranch({
  connection,
  database,
  schema,
  value,
  objectFilter,
  onPick,
}: {
  connection: Connection
  database: string
  schema: string
  value: SelectedObject
  objectFilter: string
  onPick: (next: SelectedObject) => void
}) {
  const objects = useQuery({
    queryKey: ['objects', connection.id, database, schema],
    queryFn: () => listObjects(connection, database, schema),
  })

  const filtered = useMemo(() => {
    const list = objects.data ?? []
    if (!objectFilter) return list
    return list.filter((o) => o.name.toLowerCase().includes(objectFilter))
  }, [objects.data, objectFilter])

  if (objects.isLoading && !objects.data) {
    return (
      <div className="facet-status table-picker-nested">
        <Spinner size="sm" label="Loading…" />
      </div>
    )
  }
  if (objects.isError) {
    return (
      <div className="facet-status error table-picker-nested">
        {objects.error instanceof Error
          ? objects.error.message
          : 'Failed to load objects'}
      </div>
    )
  }
  if (filtered.length === 0) {
    return (
      <div className="facet-status table-picker-nested">
        {objectFilter ? 'No matching tables / views' : 'No tables / views'}
      </div>
    )
  }

  return (
    <>
      {filtered.map((o: ObjectItem) => {
        const selected =
          database === value.database &&
          schema === value.schema &&
          o.name === value.name
        return (
          <button
            key={`${o.kind}:${o.name}`}
            type="button"
            className={`table-picker-row depth-2 leaf${selected ? ' on' : ''}`}
            onClick={() =>
              onPick({
                database,
                schema,
                name: o.name,
                kind: o.kind,
              })
            }
          >
            <span className="table-picker-chevron spacer" />
            {o.kind === 'view' ? <ViewIcon /> : <TableIcon />}
            <span className="table-picker-name">{o.name}</span>
            <span className="kind-badge">{o.kind}</span>
          </button>
        )
      })}
    </>
  )
}
