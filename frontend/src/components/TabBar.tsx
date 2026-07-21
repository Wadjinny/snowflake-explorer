import { Link } from 'react-router'
import { objectPathFrom, objectTitle, shortObjectLabel } from '../paths'
import type { OpenTab } from '../openTabs'
import { TableIcon, ViewIcon } from './TreeIcons'

type Props = {
  tabs: OpenTab[]
  activeKey: string | null
  onClose: (key: string) => void
}

export default function TabBar({ tabs, activeKey, onClose }: Props) {
  if (tabs.length === 0) return null

  return (
    <div className="tab-bar" role="tablist" aria-label="Open objects">
      {tabs.map((tab) => {
        const active = tab.key === activeKey
        return (
          <div
            key={tab.key}
            className={`tab-item${active ? ' active' : ''}`}
            role="tab"
            aria-selected={active}
          >
            <Link
              to={objectPathFrom(tab.object)}
              className="tab-link"
              title={objectTitle(tab.object)}
            >
              <span className="tab-icon">
                {tab.object.kind === 'view' ? <ViewIcon /> : <TableIcon />}
              </span>
              <span className="tab-label">{shortObjectLabel(tab.object)}</span>
            </Link>
            <button
              type="button"
              className="tab-close"
              title="Close tab"
              aria-label={`Close ${tab.object.name}`}
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
