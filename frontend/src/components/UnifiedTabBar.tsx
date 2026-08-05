import { Link } from 'react-router'
import type { UnifiedTabItem } from '../workspaceTabs'
import {
  BookmarkIcon,
  TableIcon,
  TransformIcon,
  ViewIcon,
} from './TreeIcons'

type Props = {
  items: UnifiedTabItem[]
  activeHandle: string | null
  onClose: (handle: string) => void | Promise<void>
}

function TabIcon({ icon }: { icon: UnifiedTabItem['icon'] }) {
  if (icon === 'transform') return <TransformIcon />
  if (icon === 'bookmark') return <BookmarkIcon filled />
  if (icon === 'view') return <ViewIcon />
  return <TableIcon />
}

export default function UnifiedTabBar({
  items,
  activeHandle,
  onClose,
}: Props) {
  if (items.length === 0) return null

  return (
    <div className="tab-bar" role="tablist" aria-label="Open tabs">
      {items.map((item) => {
        const active = item.handle === activeHandle
        return (
          <div
            key={item.handle}
            className={`tab-item${active ? ' active' : ''}`}
            role="tab"
            aria-selected={active}
          >
            <Link to={item.path} className="tab-link" title={item.title}>
              <span className="tab-icon">
                <TabIcon icon={item.icon} />
              </span>
              <span className="tab-label">
                {item.label}
                {item.dirty ? ' •' : ''}
              </span>
              {item.draft ? (
                <span className="kind-badge tab-draft-badge">draft</span>
              ) : null}
            </Link>
            <button
              type="button"
              className="tab-close"
              title="Close tab"
              aria-label={`Close ${item.label}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void onClose(item.handle)
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
