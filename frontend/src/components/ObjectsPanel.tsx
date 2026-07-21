import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { SavedSelection } from '../selections'
import { TRANSFORM_HOME } from '../transformTabs'
import type { Connection, SelectedObject } from '../types'
import ObjectTree from './ObjectTree'
import Spinner from './Spinner'
import { RefreshIcon, SidebarToggleIcon } from './TreeIcons'

type Props = {
  /** Active connection, or null when none is configured. */
  connection: Connection | null
  /** Which workspace is showing this panel (drives the Browse/Transform nav). */
  mode: 'browse' | 'transform'
  selected: SelectedObject | null
  onOpenSelection: (selection: SavedSelection) => void
  onOpenTransformation: (id: string) => void
  activeTransformId?: string | null
  /** Collapse the surrounding resizable panel. */
  onCollapse: () => void
}

/** The Objects sidebar body, shared by the Browse and Transform workspaces. */
export default function ObjectsPanel({
  connection,
  mode,
  selected,
  onOpenSelection,
  onOpenTransformation,
  activeTransformId = null,
  onCollapse,
}: Props) {
  const queryClient = useQueryClient()
  const treeFetching = useIsFetching({
    predicate: (q) => {
      const key = q.queryKey
      return (
        Boolean(connection) &&
        (key[0] === 'databases' ||
          key[0] === 'schemas' ||
          key[0] === 'objects') &&
        key[1] === connection?.id
      )
    },
  })

  const refreshTree = () => {
    if (!connection) return
    void queryClient.invalidateQueries({ queryKey: ['databases', connection.id] })
    void queryClient.invalidateQueries({ queryKey: ['schemas', connection.id] })
    void queryClient.invalidateQueries({ queryKey: ['objects', connection.id] })
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Objects</span>
        <div className="panel-header-actions">
          {mode === 'browse' ? (
            <span className="btn-micro open">Browse</span>
          ) : (
            <Link to="/" className="btn-micro">
              Browse
            </Link>
          )}
          {mode === 'transform' ? (
            <span className="btn-micro open">Transform</span>
          ) : (
            <Link to={TRANSFORM_HOME} className="btn-micro" title="Transform mode">
              Transform
            </Link>
          )}
          {connection && treeFetching > 0 ? <Spinner size="sm" /> : null}
          {connection ? (
            <button
              type="button"
              className="btn-micro btn-icon"
              onClick={refreshTree}
              disabled={treeFetching > 0}
              title="Refresh catalog"
              aria-label="Refresh catalog"
            >
              <RefreshIcon />
            </button>
          ) : null}
          <button
            type="button"
            className="btn-micro btn-icon"
            onClick={onCollapse}
            title="Collapse objects panel"
            aria-label="Collapse objects panel"
          >
            <SidebarToggleIcon collapsed={false} />
          </button>
        </div>
      </div>
      <div className="panel-body">
        {!connection ? (
          <div className="empty-hint">Add a connection to browse.</div>
        ) : (
          <ObjectTree
            connection={connection}
            selected={selected}
            onOpenSelection={onOpenSelection}
            activeTransformId={activeTransformId}
            onOpenTransformation={onOpenTransformation}
          />
        )}
      </div>
    </div>
  )
}
