import { Link } from 'react-router'
import { objectTitle, shortObjectLabel } from '../paths'
import { tabPath, type OpenTab } from '../openTabs'
import { BookmarkIcon, TableIcon, ViewIcon } from './TreeIcons'

type Props = {
  tabs: OpenTab[]
  activeKey: string | null
  onClose: (key: string) => void | Promise<void>
}

export default function TabBar({ tabs, activeKey, onClose }: Props) {
  if (tabs.length === 0) return null

  return (
    <div className="tab-bar" role="tablist" aria-label="Open objects">
      {tabs.map((tab) => {
        const active = tab.key === activeKey
        const isSelection = Boolean(tab.selectionId)
        const label = isSelection
          ? (tab.selectionName ?? shortObjectLabel(tab.object))
          : shortObjectLabel(tab.object)
        const title = isSelection
          ? `${label}${tab.dirty ? ' (unsaved)' : ''}\n${objectTitle(tab.object)}`
          : objectTitle(tab.object)
        return (
          <div
            key={tab.key}
            className={`tab-item${active ? ' active' : ''}`}
            role="tab"
            aria-selected={active}
          >
            <Link to={tabPath(tab)} className="tab-link" title={title}>
              <span className="tab-icon">
                {isSelection ? (
                  <BookmarkIcon filled />
                ) : tab.object.kind === 'view' ? (
                  <ViewIcon />
                ) : (
                  <TableIcon />
                )}
              </span>
              <span className="tab-label">
                {label}
                {isSelection && tab.dirty ? ' •' : ''}
              </span>
            </Link>
            <button
              type="button"
              className="tab-close"
              title="Close tab"
              aria-label={`Close ${label}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onClose(tab.key)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
