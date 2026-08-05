import { useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router'
import type { UnifiedTabItem } from '../workspaceTabs'
import {
  BookmarkIcon,
  TableIcon,
  TransformIcon,
  ViewIcon,
} from './TreeIcons'

const TAB_DRAG_MIME = 'application/x-sf-tab'

type Props = {
  items: UnifiedTabItem[]
  activeHandle: string | null
  onClose: (handle: string) => void | Promise<void>
  onReorder: (fromHandle: string, toHandle: string) => void
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
  onReorder,
}: Props) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const didDrag = useRef(false)

  if (items.length === 0) return null

  const onDragStart = (handle: string, e: DragEvent) => {
    const t = e.target
    if (t instanceof Element && t.closest('.tab-close')) {
      e.preventDefault()
      return
    }
    didDrag.current = false
    setDragging(handle)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', handle)
    e.dataTransfer.setData(TAB_DRAG_MIME, handle)
  }

  const onDragOver = (handle: string, e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragging && handle !== dragging) setDropTarget(handle)
  }

  const onDrop = (to: string, e: DragEvent) => {
    e.preventDefault()
    const from =
      e.dataTransfer.getData(TAB_DRAG_MIME) ||
      e.dataTransfer.getData('text/plain') ||
      dragging
    if (!from || from === to) {
      setDragging(null)
      setDropTarget(null)
      return
    }
    didDrag.current = true
    onReorder(from, to)
    setDragging(null)
    setDropTarget(null)
  }

  const onDragEnd = () => {
    setDragging(null)
    setDropTarget(null)
  }

  return (
    <div className="tab-bar" role="tablist" aria-label="Open tabs">
      {items.map((item) => {
        const active = item.handle === activeHandle
        const isDragging = dragging === item.handle
        const isDropTarget = dropTarget === item.handle && !isDragging
        return (
          <div
            key={item.handle}
            className={`tab-item${active ? ' active' : ''}${isDragging ? ' tab-dragging' : ''}${isDropTarget ? ' tab-drop-target' : ''}`}
            role="tab"
            aria-selected={active}
            draggable
            onDragStart={(e) => onDragStart(item.handle, e)}
            onDragOver={(e) => onDragOver(item.handle, e)}
            onDrop={(e) => onDrop(item.handle, e)}
            onDragEnd={onDragEnd}
            onDragLeave={() => {
              if (dropTarget === item.handle) setDropTarget(null)
            }}
          >
            <Link
              to={item.path}
              className="tab-link"
              title={`${item.title} - drag to reorder`}
              draggable={false}
              onClick={(e) => {
                if (didDrag.current) {
                  e.preventDefault()
                  didDrag.current = false
                }
              }}
            >
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
