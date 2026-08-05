import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { invalidateCatalog } from '../api/snowflake'
import type { SavedSelection } from '../selections'
import type { Connection, SelectedObject } from '../types'
import ObjectTree from './ObjectTree'
import Spinner from './Spinner'
import { RefreshIcon, SidebarToggleIcon } from './TreeIcons'

type Props = {
  /** Active connection, or null when none is configured. */
  connection: Connection | null
  selected: SelectedObject | null
  activeSelectionId?: string | null
  onOpenSelection: (selection: SavedSelection) => void
  onOpenTransformation: (id: string) => void
  activeTransformId?: string | null
  /** Collapse the surrounding resizable panel. */
  onCollapse: () => void
}

/** The Objects sidebar body for the shared workspace shell. */
export default function ObjectsPanel({
  connection,
  selected,
  activeSelectionId = null,
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
          key[0] === 'all-schemas' ||
          key[0] === 'objects') &&
        key[1] === connection?.id
      )
    },
  })

  const refreshTree = () => {
    if (!connection) return
    void (async () => {
      try {
        await invalidateCatalog(connection)
      } catch {
        // Still refetch; backend cache may still apply.
      }
      void queryClient.invalidateQueries({
        queryKey: ['databases', connection.id],
      })
      void queryClient.invalidateQueries({
        queryKey: ['all-schemas', connection.id],
      })
      void queryClient.invalidateQueries({
        queryKey: ['objects', connection.id],
      })
      void queryClient.invalidateQueries({
        queryKey: ['preview', connection.id],
      })
      void queryClient.invalidateQueries({
        queryKey: ['facet', connection.id],
      })
    })()
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Objects</span>
        <div className="panel-header-actions">
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
            activeSelectionId={activeSelectionId}
            onOpenSelection={onOpenSelection}
            activeTransformId={activeTransformId}
            onOpenTransformation={onOpenTransformation}
          />
        )}
      </div>
    </div>
  )
}
