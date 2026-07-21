import { Link } from 'react-router'
import { transformPath, type OpenTransformTab } from '../transformTabs'
import { TransformIcon } from './TreeIcons'

type Props = {
  tabs: OpenTransformTab[]
  activeId: string | null
  onClose: (id: string) => void
}

export default function TransformTabBar({ tabs, activeId, onClose }: Props) {
  if (tabs.length === 0) return null

  return (
    <div className="tab-bar" role="tablist" aria-label="Open transforms">
      {tabs.map((tab) => {
        const active = tab.id === activeId
        const label = tab.dirty ? `${tab.name} •` : tab.name
        return (
          <div
            key={tab.id}
            className={`tab-item${active ? ' active' : ''}`}
            role="tab"
            aria-selected={active}
          >
            <Link
              to={transformPath(tab.id)}
              className="tab-link"
              title={tab.name}
            >
              <span className="tab-icon">
                <TransformIcon />
              </span>
              <span className="tab-label">{label}</span>
              {!tab.savedId ? (
                <span className="kind-badge tab-draft-badge">draft</span>
              ) : null}
            </Link>
            <button
              type="button"
              className="tab-close"
              title="Close tab"
              aria-label={`Close ${tab.name}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onClose(tab.id)
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
