import type { ColumnType } from '../types'
import { FilterIcon } from './TreeIcons'

export function HeaderFilterButton({
  active,
  open,
  onToggle,
}: {
  active: boolean
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`th-filter-btn${active ? ' active' : ''}${open ? ' open' : ''}`}
      title={active ? 'Edit filter' : 'Filter'}
      aria-label="Filter column"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <FilterIcon />
    </button>
  )
}

export function formatCell(
  cell: string | number | boolean,
  type: ColumnType,
): string {
  if (type === 'boolean') {
    return cell === true || cell === 'true' || cell === 1 ? 'true' : 'false'
  }
  return String(cell)
}
