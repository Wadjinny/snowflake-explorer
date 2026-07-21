import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { listDatabases, listObjects, listSchemas } from '../api/snowflake'
import {
  buildFavoriteForest,
  type Favorite,
  type FavoriteDatabaseNode,
  type FavoriteSchemaNode,
} from '../favorites'
import { useFavorites } from '../favoritesContext'
import { objectPath } from '../paths'
import {
  selectionFilterCount,
  type SavedSelection,
} from '../selections'
import { useSelections } from '../selectionsContext'
import type { SavedTransformation } from '../transformations'
import { useTransformations } from '../transformationsContext'
import type {
  Connection,
  ObjectItem,
  ObjectKind,
  SelectedObject,
} from '../types'
import { formatShortCount } from '../types'
import Spinner from './Spinner'
import {
  BookmarkIcon,
  ChevronIcon,
  CloseIcon,
  DatabaseIcon,
  FoldAllIcon,
  FolderIcon,
  StarIcon,
  TableIcon,
  TransformIcon,
  ViewIcon,
} from './TreeIcons'

type Props = {
  connection: Connection
  selected: SelectedObject | null
  onOpenSelection: (selection: SavedSelection) => void
  activeTransformId?: string | null
  onOpenTransformation?: (id: string) => void
}

/** Ancestor “still has more siblings” flags for guide rails (depth-1 entries). */
type Rails = boolean[]

type FavFns = {
  isFavorite: (fav: Favorite) => boolean
  onToggleFavorite: (fav: Favorite) => void
}

const SECTIONS_KEY = 'sf-explorer.treeSections'

type TreeSections = {
  favoritesOpen: boolean
  selectionsOpen: boolean
  transformationsOpen: boolean
  catalogOpen: boolean
}

const DEFAULT_SECTIONS: TreeSections = {
  favoritesOpen: true,
  selectionsOpen: true,
  transformationsOpen: true,
  catalogOpen: true,
}

function loadTreeSections(): TreeSections {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY)
    if (!raw) return { ...DEFAULT_SECTIONS }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_SECTIONS }
    }
    const o = parsed as Record<string, unknown>
    return {
      favoritesOpen: o.favoritesOpen !== false,
      selectionsOpen: o.selectionsOpen !== false,
      transformationsOpen: o.transformationsOpen !== false,
      catalogOpen: o.catalogOpen !== false,
    }
  } catch {
    return { ...DEFAULT_SECTIONS }
  }
}

function saveTreeSections(sections: TreeSections): void {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections))
  } catch {
    // ignore quota errors
  }
}

/** Collapse local open state whenever foldEpoch bumps (skip initial 0). */
function useCollapseOnFold(
  foldEpoch: number,
  setOpen: (value: boolean | ((prev: boolean) => boolean)) => void,
) {
  useEffect(() => {
    if (foldEpoch > 0) setOpen(false)
  }, [foldEpoch, setOpen])
}

export default function ObjectTree({
  connection,
  selected,
  onOpenSelection,
  activeTransformId = null,
  onOpenTransformation,
}: Props) {
  const { favorites, isFavorite, toggle } = useFavorites()
  const { selections, remove: removeSelection } = useSelections()
  const {
    transformations,
    remove: removeTransformation,
  } = useTransformations()
  const favFns: FavFns = { isFavorite, onToggleFavorite: toggle }
  const [sections, setSections] = useState<TreeSections>(loadTreeSections)
  const [favoritesFoldEpoch, setFavoritesFoldEpoch] = useState(0)
  const [catalogFoldEpoch, setCatalogFoldEpoch] = useState(0)

  const setSection = (key: keyof TreeSections, open: boolean) => {
    setSections((prev) => {
      const next = { ...prev, [key]: open }
      saveTreeSections(next)
      return next
    })
  }

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
  if (
    items.length === 0 &&
    favorites.length === 0 &&
    selections.length === 0 &&
    transformations.length === 0
  ) {
    return <div className="empty-hint">No databases</div>
  }

  const showFavorites = favorites.length > 0
  const showSelections = selections.length > 0
  const showTransformations = transformations.length > 0

  return (
    <div className="tree" role="tree">
      {showFavorites ? (
        <TreeSection
          label="Favorites"
          open={sections.favoritesOpen}
          onToggle={() =>
            setSection('favoritesOpen', !sections.favoritesOpen)
          }
          onFoldAll={() => setFavoritesFoldEpoch((n) => n + 1)}
          count={favorites.length}
        >
          <FavoritesSection
            connection={connection}
            favorites={favorites}
            selected={selected}
            favFns={favFns}
            foldEpoch={favoritesFoldEpoch}
          />
        </TreeSection>
      ) : null}
      {showSelections ? (
        <TreeSection
          label="Selections"
          open={sections.selectionsOpen}
          onToggle={() =>
            setSection('selectionsOpen', !sections.selectionsOpen)
          }
          count={selections.length}
          divider={showFavorites}
        >
          <SelectionsList
            selections={selections}
            selected={selected}
            onOpen={onOpenSelection}
            onRemove={removeSelection}
          />
        </TreeSection>
      ) : null}
      {showTransformations ? (
        <TreeSection
          label="Transformations"
          open={sections.transformationsOpen}
          onToggle={() =>
            setSection('transformationsOpen', !sections.transformationsOpen)
          }
          count={transformations.length}
          divider={showFavorites || showSelections}
        >
          <TransformationsList
            items={transformations}
            activeId={activeTransformId}
            onOpen={(id) => onOpenTransformation?.(id)}
            onRemove={removeTransformation}
          />
        </TreeSection>
      ) : null}
      <TreeSection
        label="All objects"
        open={sections.catalogOpen}
        onToggle={() => setSection('catalogOpen', !sections.catalogOpen)}
        onFoldAll={() => setCatalogFoldEpoch((n) => n + 1)}
        count={items.length}
        divider={showFavorites || showSelections || showTransformations}
      >
        {items.length === 0 ? (
          <div className="empty-hint">No databases</div>
        ) : (
          items.map((db, i) => (
            <DatabaseNode
              key={db.name}
              connection={connection}
              database={db.name}
              selected={selected}
              isLast={i === items.length - 1}
              rails={[]}
              defaultOpen={selected?.database === db.name}
              favFns={favFns}
              foldEpoch={catalogFoldEpoch}
            />
          ))
        )}
      </TreeSection>
    </div>
  )
}

function TreeSection({
  label,
  open,
  onToggle,
  onFoldAll,
  count,
  divider,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  onFoldAll?: () => void
  count?: number
  divider?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={`tree-section${divider ? ' tree-section-divider' : ''}`}
      role="group"
      aria-label={label}
    >
      <div className="tree-section-header-row">
        <button
          type="button"
          className="tree-section-header"
          onClick={onToggle}
          aria-expanded={open}
        >
          <ChevronIcon open={open} />
          <span className="tree-section-label">{label}</span>
          {count != null ? (
            <span className="tree-section-count">{count}</span>
          ) : null}
        </button>
        {onFoldAll && open ? (
          <button
            type="button"
            className="tree-section-fold"
            onClick={onFoldAll}
            title="Fold all"
            aria-label={`Fold all in ${label}`}
          >
            <FoldAllIcon />
          </button>
        ) : null}
      </div>
      {open ? <div className="tree-section-body">{children}</div> : null}
    </div>
  )
}

function FavoritesSection({
  connection,
  favorites,
  selected,
  favFns,
  foldEpoch,
}: {
  connection: Connection
  favorites: Favorite[]
  selected: SelectedObject | null
  favFns: FavFns
  foldEpoch: number
}) {
  const forest = buildFavoriteForest(favorites)
  return (
    <>
      {forest.map((node, i) => (
        <FavoriteDatabaseBranch
          key={node.database}
          connection={connection}
          node={node}
          selected={selected}
          isLast={i === forest.length - 1}
          rails={[]}
          favFns={favFns}
          foldEpoch={foldEpoch}
        />
      ))}
    </>
  )
}

function SelectionsList({
  selections,
  selected,
  onOpen,
  onRemove,
}: {
  selections: SavedSelection[]
  selected: SelectedObject | null
  onOpen: (selection: SavedSelection) => void
  onRemove: (id: string) => void
}) {
  return (
    <>
      {selections.map((sel) => {
        const active =
          selected?.database === sel.object.database &&
          selected?.schema === sel.object.schema &&
          selected?.name === sel.object.name
        const filters = selectionFilterCount(sel)
        const title = `${sel.object.database}.${sel.object.schema}.${sel.object.name}`
        return (
          <div
            key={sel.id}
            className={`tree-row selection-row${active ? ' active' : ''}`}
            role="treeitem"
            aria-selected={active}
            onClick={() => onOpen(sel)}
          >
            <span className="tree-guides tree-guides-root" aria-hidden />
            <span className="tree-twistie tree-twistie-spacer" />
            <span className="tree-icon-slot">
              <BookmarkIcon filled />
            </span>
            <span className="tree-label" title={title}>
              {sel.name}
            </span>
            {filters > 0 ? (
              <span className="kind-badge">{filters}f</span>
            ) : null}
            {sel.sort ? <span className="kind-badge">sort</span> : null}
            <button
              type="button"
              className="selection-remove"
              title="Remove selection"
              aria-label="Remove selection"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onRemove(sel.id)
              }}
            >
              <CloseIcon />
            </button>
          </div>
        )
      })}
    </>
  )
}

function TransformationsList({
  items,
  activeId,
  onOpen,
  onRemove,
}: {
  items: SavedTransformation[]
  activeId: string | null
  onOpen: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <>
      {items.map((t) => {
        const active = activeId === t.id
        const src = t.recipe.source
        const title = `${src.database}.${src.schema}.${src.name}`
        const joinCount = t.recipe.joins.length
        return (
          <div
            key={t.id}
            className={`tree-row selection-row${active ? ' active' : ''}`}
            role="treeitem"
            aria-selected={active}
            onClick={() => onOpen(t.id)}
          >
            <span className="tree-guides tree-guides-root" aria-hidden />
            <span className="tree-twistie tree-twistie-spacer" />
            <span className="tree-icon-slot">
              <TransformIcon />
            </span>
            <span className="tree-label" title={title}>
              {t.name}
            </span>
            {joinCount > 0 ? (
              <span className="kind-badge">{joinCount}j</span>
            ) : null}
            {t.recipe.aggregations.length > 0 ? (
              <span className="kind-badge">agg</span>
            ) : null}
            {t.recipe.pivot ? <span className="kind-badge">pivot</span> : null}
            <button
              type="button"
              className="selection-remove"
              title="Remove transformation"
              aria-label="Remove transformation"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onRemove(t.id)
              }}
            >
              <CloseIcon />
            </button>
          </div>
        )
      })}
    </>
  )
}

function FavoriteDatabaseBranch({
  connection,
  node,
  selected,
  isLast,
  rails,
  favFns,
  foldEpoch,
}: {
  connection: Connection
  node: FavoriteDatabaseNode
  selected: SelectedObject | null
  isLast: boolean
  rails: Rails
  favFns: FavFns
  foldEpoch: number
}) {
  // Favorited DB → full schema list from catalog. Otherwise only nested favorites.
  if (node.favorited) {
    return (
      <DatabaseNode
        connection={connection}
        database={node.database}
        selected={selected}
        isLast={isLast}
        rails={rails}
        defaultOpen
        favFns={favFns}
        foldEpoch={foldEpoch}
      />
    )
  }

  return (
    <SyntheticDatabaseNode
      connection={connection}
      node={node}
      selected={selected}
      isLast={isLast}
      rails={rails}
      favFns={favFns}
      foldEpoch={foldEpoch}
    />
  )
}

function SyntheticDatabaseNode({
  connection,
  node,
  selected,
  isLast,
  rails,
  favFns,
  foldEpoch,
}: {
  connection: Connection
  node: FavoriteDatabaseNode
  selected: SelectedObject | null
  isLast: boolean
  rails: Rails
  favFns: FavFns
  foldEpoch: number
}) {
  const fav: Favorite = { kind: 'database', database: node.database }
  const [open, setOpen] = useState(true)
  useCollapseOnFold(foldEpoch, setOpen)
  const schemas = node.schemas

  return (
    <div role="group">
      <TreeRow
        rails={rails}
        isLast={isLast}
        expandable
        open={open}
        onToggle={() => setOpen((v) => !v)}
        icon={<DatabaseIcon />}
        label={node.database}
        favorited={favFns.isFavorite(fav)}
        onToggleFavorite={() => favFns.onToggleFavorite(fav)}
      />
      {open
        ? schemas.map((schema, i) => (
            <FavoriteSchemaBranch
              key={schema.schema}
              connection={connection}
              database={node.database}
              node={schema}
              selected={selected}
              isLast={i === schemas.length - 1}
              rails={childRails(rails, isLast)}
              favFns={favFns}
              foldEpoch={foldEpoch}
            />
          ))
        : null}
    </div>
  )
}

function FavoriteSchemaBranch({
  connection,
  database,
  node,
  selected,
  isLast,
  rails,
  favFns,
  foldEpoch,
}: {
  connection: Connection
  database: string
  node: FavoriteSchemaNode
  selected: SelectedObject | null
  isLast: boolean
  rails: Rails
  favFns: FavFns
  foldEpoch: number
}) {
  if (node.favorited) {
    return (
      <SchemaNode
        connection={connection}
        database={database}
        schema={node.schema}
        selected={selected}
        isLast={isLast}
        rails={rails}
        defaultOpen
        favFns={favFns}
        foldEpoch={foldEpoch}
      />
    )
  }

  return (
    <SyntheticSchemaNode
      database={database}
      node={node}
      selected={selected}
      isLast={isLast}
      rails={rails}
      favFns={favFns}
      foldEpoch={foldEpoch}
    />
  )
}

function SyntheticSchemaNode({
  database,
  node,
  selected,
  isLast,
  rails,
  favFns,
  foldEpoch,
}: {
  database: string
  node: FavoriteSchemaNode
  selected: SelectedObject | null
  isLast: boolean
  rails: Rails
  favFns: FavFns
  foldEpoch: number
}) {
  const fav: Favorite = { kind: 'schema', database, schema: node.schema }
  const [open, setOpen] = useState(true)
  useCollapseOnFold(foldEpoch, setOpen)
  const objects = node.objects

  return (
    <div role="group">
      <TreeRow
        rails={rails}
        isLast={isLast}
        expandable
        open={open}
        onToggle={() => setOpen((v) => !v)}
        icon={<FolderIcon open={open} />}
        label={node.schema}
        favorited={favFns.isFavorite(fav)}
        onToggleFavorite={() => favFns.onToggleFavorite(fav)}
      />
      {open
        ? objects.map((obj, i) => (
            <ObjectRow
              key={`${obj.objectKind}:${obj.name}`}
              database={database}
              schema={node.schema}
              object={{ name: obj.name, kind: obj.objectKind }}
              active={
                selected?.database === database &&
                selected?.schema === node.schema &&
                selected?.name === obj.name
              }
              isLast={i === objects.length - 1}
              rails={childRails(rails, isLast)}
              favFns={favFns}
            />
          ))
        : null}
    </div>
  )
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
      {meta ? (
        <span
          className={`kind-badge${/^\d/.test(meta) ? ' tree-count' : ''}`}
        >
          {meta}
        </span>
      ) : null}
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
  isLast,
  rails,
  defaultOpen,
  favFns,
  foldEpoch,
}: {
  connection: Connection
  database: string
  selected: SelectedObject | null
  isLast: boolean
  rails: Rails
  defaultOpen: boolean
  favFns: FavFns
  foldEpoch: number
}) {
  const fav: Favorite = { kind: 'database', database }
  const inPath = selected?.database === database
  const [open, setOpen] = useState(() => defaultOpen || inPath)
  useCollapseOnFold(foldEpoch, setOpen)
  const schemas = useQuery({
    queryKey: ['schemas', connection.id, database],
    queryFn: () => listSchemas(connection, database),
    enabled: open,
  })

  // Re-open when selection moves into this db (not on every render while selected).
  useEffect(() => {
    if (selected?.database === database) setOpen(true)
  }, [selected?.database, database])

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
        favorited={favFns.isFavorite(fav)}
        onToggleFavorite={() => favFns.onToggleFavorite(fav)}
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
              isLast={i === children.length - 1}
              rails={childRails(rails, isLast)}
              defaultOpen={
                selected?.database === database &&
                selected?.schema === schema.name
              }
              favFns={favFns}
              foldEpoch={foldEpoch}
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
  isLast,
  rails,
  defaultOpen,
  favFns,
  foldEpoch,
}: {
  connection: Connection
  database: string
  schema: string
  selected: SelectedObject | null
  isLast: boolean
  rails: Rails
  defaultOpen: boolean
  favFns: FavFns
  foldEpoch: number
}) {
  const fav: Favorite = { kind: 'schema', database, schema }
  const inPath =
    selected?.database === database && selected?.schema === schema
  const [open, setOpen] = useState(() => defaultOpen || inPath)
  useCollapseOnFold(foldEpoch, setOpen)
  const objects = useQuery({
    queryKey: ['objects', connection.id, database, schema],
    queryFn: () => listObjects(connection, database, schema),
    enabled: open,
  })

  useEffect(() => {
    if (selected?.database === database && selected?.schema === schema) {
      setOpen(true)
    }
  }, [selected?.database, selected?.schema, database, schema])

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
        favorited={favFns.isFavorite(fav)}
        onToggleFavorite={() => favFns.onToggleFavorite(fav)}
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
              favFns={favFns}
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
  favFns,
}: {
  database: string
  schema: string
  object: ObjectItem
  active: boolean
  isLast: boolean
  rails: Rails
  favFns: FavFns
}) {
  const fav: Favorite = {
    kind: 'object',
    database,
    schema,
    name: object.name,
    objectKind: object.kind,
  }
  const count =
    object.kind === 'table' && object.row_count != null
      ? formatShortCount(object.row_count)
      : null
  const title =
    object.kind === 'table' && object.row_count != null
      ? `${object.name} · ${object.row_count.toLocaleString()} rows`
      : object.name

  return (
    <TreeRow
      rails={rails}
      isLast={isLast}
      icon={<ObjectKindIcon kind={object.kind} />}
      label={object.name}
      title={title}
      active={active}
      to={objectPath(database, schema, object.name, object.kind)}
      meta={count ?? object.kind}
      favorited={favFns.isFavorite(fav)}
      onToggleFavorite={() => favFns.onToggleFavorite(fav)}
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
