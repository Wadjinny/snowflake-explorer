import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { listDatabases, listObjects, listSchemas } from '../api/snowflake'
import {
  favoriteLabel,
  favoriteTitle,
  type Favorite,
  type RevealPath,
} from '../favorites'
import { useFavorites } from '../favoritesContext'
import { objectPath } from '../paths'
import type {
  Connection,
  ObjectItem,
  ObjectKind,
  SelectedObject,
} from '../types'
import Spinner from './Spinner'
import {
  ChevronIcon,
  DatabaseIcon,
  FolderIcon,
  StarIcon,
  TableIcon,
  ViewIcon,
} from './TreeIcons'

type Props = {
  connection: Connection
  selected: SelectedObject | null
}

/** Ancestor “still has more siblings” flags for guide rails (depth-1 entries). */
type Rails = boolean[]

export default function ObjectTree({ connection, selected }: Props) {
  const { favorites, isFavorite, toggle } = useFavorites()
  const [reveal, setReveal] = useState<RevealPath | null>(null)

  const databases = useQuery({
    queryKey: ['databases', connection.id],
    queryFn: () => listDatabases(connection),
  })

  if (databases.isLoading) {
    return (
      <div className="empty-hint">
        <Spinner size="md" label="Loading databases…" block />
      </div>
    )
  }

  if (databases.isError) {
    return (
      <div className="error-bar">
        {databases.error instanceof Error
          ? databases.error.message
          : 'Failed to load databases'}
      </div>
    )
  }

  const items = databases.data ?? []
  if (items.length === 0 && favorites.length === 0) {
    return <div className="empty-hint">No databases</div>
  }

  return (
    <div className="tree" role="tree">
      {favorites.length > 0 ? (
        <FavoritesSection
          favorites={favorites}
          selected={selected}
          isFavorite={isFavorite}
          onToggle={toggle}
          onReveal={setReveal}
        />
      ) : null}
      {items.map((db, i) => (
        <DatabaseNode
          key={db.name}
          connection={connection}
          database={db.name}
          selected={selected}
          reveal={reveal}
          isLast={i === items.length - 1}
          rails={[]}
          isFavorite={isFavorite}
          onToggleFavorite={toggle}
        />
      ))}
    </div>
  )
}

function FavoritesSection({
  favorites,
  selected,
  isFavorite,
  onToggle,
  onReveal,
}: {
  favorites: Favorite[]
  selected: SelectedObject | null
  isFavorite: (fav: Favorite) => boolean
  onToggle: (fav: Favorite) => void
  onReveal: (path: RevealPath) => void
}) {
  return (
    <div className="favorites-section" role="group" aria-label="Favorites">
      <div className="favorites-header">Favorites</div>
      {favorites.map((fav) => {
        const active =
          fav.kind === 'object' &&
          selected?.database === fav.database &&
          selected?.schema === fav.schema &&
          selected?.name === fav.name
        const to =
          fav.kind === 'object'
            ? objectPath(fav.database, fav.schema, fav.name, fav.objectKind)
            : undefined
        return (
          <TreeRow
            key={`${fav.kind}:${favoriteTitle(fav)}`}
            rails={[]}
            isLast
            icon={<FavoriteKindIcon fav={fav} />}
            label={favoriteLabel(fav)}
            title={favoriteTitle(fav)}
            active={active}
            to={to}
            meta={
              fav.kind === 'object'
                ? fav.objectKind
                : fav.kind === 'schema'
                  ? 'schema'
                  : 'database'
            }
            favorited={isFavorite(fav)}
            onToggleFavorite={() => onToggle(fav)}
            onClick={
              fav.kind === 'database'
                ? () => onReveal({ database: fav.database })
                : fav.kind === 'schema'
                  ? () =>
                      onReveal({
                        database: fav.database,
                        schema: fav.schema,
                      })
                  : undefined
            }
          />
        )
      })}
      <div className="favorites-divider" />
    </div>
  )
}

function FavoriteKindIcon({ fav }: { fav: Favorite }) {
  if (fav.kind === 'database') return <DatabaseIcon />
  if (fav.kind === 'schema') return <FolderIcon open={false} />
  return fav.objectKind === 'view' ? <ViewIcon /> : <TableIcon />
}

function TreeRow({
  rails,
  isLast,
  expandable,
  open,
  onToggle,
  icon,
  label,
  title,
  active,
  onClick,
  to,
  meta,
  favorited,
  onToggleFavorite,
}: {
  rails: Rails
  isLast: boolean
  expandable?: boolean
  open?: boolean
  onToggle?: () => void
  icon: ReactNode
  label: string
  title?: string
  active?: boolean
  onClick?: () => void
  to?: string
  meta?: string
  favorited?: boolean
  onToggleFavorite?: () => void
}) {
  const isRoot = rails.length === 0
  const className = `tree-row${active ? ' active' : ''}${favorited ? ' favorited' : ''}`
  const star = onToggleFavorite ? (
    <button
      type="button"
      className={`tree-fav${favorited ? ' on' : ''}`}
      aria-label={favorited ? 'Remove favorite' : 'Add favorite'}
      title={favorited ? 'Remove favorite' : 'Add favorite'}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggleFavorite()
      }}
    >
      <StarIcon filled={favorited} />
    </button>
  ) : null

  const body = (
    <>
      <TreeGuides rails={rails} isLast={isLast} root={isRoot} />
      {expandable ? (
        <button
          type="button"
          className="tree-twistie"
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggle?.()
          }}
        >
          <ChevronIcon open={Boolean(open)} />
        </button>
      ) : (
        <span className="tree-twistie tree-twistie-spacer" />
      )}
      <span className="tree-icon-slot">{icon}</span>
      <span className="tree-label" title={title ?? label}>
        {label}
      </span>
      {meta ? <span className="kind-badge">{meta}</span> : null}
      {star}
    </>
  )

  if (to) {
    return (
      <Link
        to={to}
        className={className}
        role="treeitem"
        aria-selected={active ?? false}
      >
        {body}
      </Link>
    )
  }

  return (
    <div
      className={className}
      role="treeitem"
      aria-expanded={expandable ? open : undefined}
      aria-selected={active ?? false}
      onClick={onClick ?? onToggle}
    >
      {body}
    </div>
  )
}

function TreeGuides({
  rails,
  isLast,
  root,
}: {
  rails: Rails
  isLast: boolean
  root?: boolean
}) {
  if (root) {
    return <span className="tree-guides tree-guides-root" aria-hidden />
  }
  return (
    <span className="tree-guides" aria-hidden>
      {rails.map((continueLine, i) => (
        <span
          key={i}
          className={`tree-guide${continueLine ? ' continue' : ''}`}
        />
      ))}
      <span className={`tree-guide elbow${isLast ? ' last' : ''}`} />
    </span>
  )
}

function childRails(rails: Rails, isLast: boolean): Rails {
  return [...rails, !isLast]
}

function DatabaseNode({
  connection,
  database,
  selected,
  reveal,
  isLast,
  rails,
  isFavorite,
  onToggleFavorite,
}: {
  connection: Connection
  database: string
  selected: SelectedObject | null
  reveal: RevealPath | null
  isLast: boolean
  rails: Rails
  isFavorite: (fav: Favorite) => boolean
  onToggleFavorite: (fav: Favorite) => void
}) {
  const fav: Favorite = { kind: 'database', database }
  const shouldOpen =
    selected?.database === database || reveal?.database === database
  const [open, setOpen] = useState(() => shouldOpen)
  const schemas = useQuery({
    queryKey: ['schemas', connection.id, database],
    queryFn: () => listSchemas(connection, database),
    enabled: open,
  })

  useEffect(() => {
    if (shouldOpen) setOpen(true)
  }, [shouldOpen])

  const children = schemas.data ?? []

  return (
    <div role="group">
      <TreeRow
        rails={rails}
        isLast={isLast}
        expandable
        open={open}
        onToggle={() => setOpen((v) => !v)}
        icon={<DatabaseIcon />}
        label={database}
        favorited={isFavorite(fav)}
        onToggleFavorite={() => onToggleFavorite(fav)}
      />
      {open ? (
        schemas.isLoading ? (
          <TreeStatus rails={childRails(rails, isLast)} loading />
        ) : schemas.isError ? (
          <TreeStatus
            rails={childRails(rails, isLast)}
            label={
              schemas.error instanceof Error
                ? schemas.error.message
                : 'Failed to load schemas'
            }
            error
          />
        ) : children.length === 0 ? (
          <TreeStatus rails={childRails(rails, isLast)} label="No schemas" />
        ) : (
          children.map((schema, i) => (
            <SchemaNode
              key={schema.name}
              connection={connection}
              database={database}
              schema={schema.name}
              selected={selected}
              reveal={reveal}
              isLast={i === children.length - 1}
              rails={childRails(rails, isLast)}
              isFavorite={isFavorite}
              onToggleFavorite={onToggleFavorite}
            />
          ))
        )
      ) : null}
    </div>
  )
}

function SchemaNode({
  connection,
  database,
  schema,
  selected,
  reveal,
  isLast,
  rails,
  isFavorite,
  onToggleFavorite,
}: {
  connection: Connection
  database: string
  schema: string
  selected: SelectedObject | null
  reveal: RevealPath | null
  isLast: boolean
  rails: Rails
  isFavorite: (fav: Favorite) => boolean
  onToggleFavorite: (fav: Favorite) => void
}) {
  const fav: Favorite = { kind: 'schema', database, schema }
  const inPath =
    selected?.database === database && selected?.schema === schema
  const revealHere =
    reveal?.database === database && reveal.schema === schema
  const shouldOpen = inPath || revealHere
  const [open, setOpen] = useState(() => shouldOpen)
  const objects = useQuery({
    queryKey: ['objects', connection.id, database, schema],
    queryFn: () => listObjects(connection, database, schema),
    enabled: open,
  })

  useEffect(() => {
    if (shouldOpen) setOpen(true)
  }, [shouldOpen])

  const children = objects.data ?? []

  return (
    <div role="group">
      <TreeRow
        rails={rails}
        isLast={isLast}
        expandable
        open={open}
        onToggle={() => setOpen((v) => !v)}
        icon={<FolderIcon open={open} />}
        label={schema}
        favorited={isFavorite(fav)}
        onToggleFavorite={() => onToggleFavorite(fav)}
      />
      {open ? (
        objects.isLoading ? (
          <TreeStatus rails={childRails(rails, isLast)} loading />
        ) : objects.isError ? (
          <TreeStatus
            rails={childRails(rails, isLast)}
            label={
              objects.error instanceof Error
                ? objects.error.message
                : 'Failed to load objects'
            }
            error
          />
        ) : children.length === 0 ? (
          <TreeStatus
            rails={childRails(rails, isLast)}
            label="No tables or views"
          />
        ) : (
          children.map((obj, i) => (
            <ObjectRow
              key={`${obj.kind}:${obj.name}`}
              database={database}
              schema={schema}
              object={obj}
              active={
                selected?.database === database &&
                selected?.schema === schema &&
                selected?.name === obj.name
              }
              isLast={i === children.length - 1}
              rails={childRails(rails, isLast)}
              isFavorite={isFavorite}
              onToggleFavorite={onToggleFavorite}
            />
          ))
        )
      ) : null}
    </div>
  )
}

function ObjectRow({
  database,
  schema,
  object,
  active,
  isLast,
  rails,
  isFavorite,
  onToggleFavorite,
}: {
  database: string
  schema: string
  object: ObjectItem
  active: boolean
  isLast: boolean
  rails: Rails
  isFavorite: (fav: Favorite) => boolean
  onToggleFavorite: (fav: Favorite) => void
}) {
  const fav: Favorite = {
    kind: 'object',
    database,
    schema,
    name: object.name,
    objectKind: object.kind,
  }
  return (
    <TreeRow
      rails={rails}
      isLast={isLast}
      icon={<ObjectKindIcon kind={object.kind} />}
      label={object.name}
      active={active}
      to={objectPath(database, schema, object.name, object.kind)}
      meta={object.kind}
      favorited={isFavorite(fav)}
      onToggleFavorite={() => onToggleFavorite(fav)}
    />
  )
}

function ObjectKindIcon({ kind }: { kind: ObjectKind }) {
  return kind === 'view' ? <ViewIcon /> : <TableIcon />
}

function TreeStatus({
  rails,
  label,
  error,
  loading,
}: {
  rails: Rails
  label?: string
  error?: boolean
  loading?: boolean
}) {
  return (
    <div className={`tree-status${error ? ' error' : ''}`}>
      <TreeGuides rails={rails.slice(0, -1)} isLast />
      <span className="tree-twistie tree-twistie-spacer" />
      {loading ? (
        <Spinner size="sm" label="Loading…" />
      ) : (
        <span className="tree-status-label">{label}</span>
      )}
    </div>
  )
}
