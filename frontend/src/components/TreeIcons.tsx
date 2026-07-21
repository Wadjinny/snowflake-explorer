type IconProps = {
  className?: string
}

const base = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true as const,
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      viewBox="0 0 16 16"
      className={`tree-chevron${open ? ' open' : ''}`}
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function DatabaseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ?? 'tree-icon tree-icon-db'}>
      <ellipse cx="8" cy="4" rx="5.5" ry="2.2" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M2.5 4v8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V4"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M2.5 8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  )
}

export function SchemaIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ?? 'tree-icon tree-icon-schema'}>
      <path
        d="M3 3.5h10v9H3z"
        stroke="currentColor"
        strokeWidth="1.25"
        rx="1"
      />
      <path d="M3 6.5h10M6.5 6.5v6" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

export function TableIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ?? 'tree-icon tree-icon-table'}>
      <rect
        x="2.5"
        y="3"
        width="11"
        height="10"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M2.5 6h11M2.5 9h11M6.5 6v7M10 6v7"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  )
}

export function ViewIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ?? 'tree-icon tree-icon-view'}>
      <path
        d="M1.8 8s2.4-3.8 6.2-3.8S14.2 8 14.2 8s-2.4 3.8-6.2 3.8S1.8 8 1.8 8z"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ?? 'btn-icon-svg'}>
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.4-3.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M13.5 2.8v3.2h-3.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function FilterIcon({ className }: IconProps) {
  return (
    <svg {...base} width={12} height={12} className={className ?? 'btn-icon-svg'}>
      <path
        d="M2.5 3.5h11l-4 4.5V12l-3-1.5V8z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
    </svg>
  )
}

export function ColumnsIcon({ className }: IconProps) {
  return (
    <svg {...base} width={12} height={12} className={className ?? 'btn-icon-svg'}>
      <rect
        x="2.5"
        y="3"
        width="3.5"
        height="10"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.25"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <rect
        x="7.25"
        y="3"
        width="3.5"
        height="10"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <rect
        x="12"
        y="3"
        width="1.5"
        height="10"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.55"
      />
    </svg>
  )
}

/** Chevron for collapsing/expanding the objects sidebar. */
export function SidebarToggleIcon({
  collapsed,
  className,
}: IconProps & { collapsed: boolean }) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      style={{ transform: collapsed ? 'rotate(180deg)' : undefined }}
    >
      <path
        d="M10 3.5L5.5 8 10 12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Bookmark / save selection view. */
export function TransformIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className ?? 'tree-icon'}>
      <path
        d="M3 4h4v3H3zM9 4h4v3H9zM6 9h4v3H6z"
        stroke="currentColor"
        strokeWidth="1.25"
        fill="none"
      />
      <path
        d="M5 7v2M11 7v2M8 7v2"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function BookmarkIcon({
  filled,
  className,
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <path
        d="M4 2.5h8c.55 0 1 .45 1 1V14l-5-2.4L3 14V3.5c0-.55.45-1 1-1z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        fill={filled ? 'currentColor' : 'none'}
        fillOpacity={filled ? 0.85 : undefined}
      />
    </svg>
  )
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg
      {...base}
      width={10}
      height={10}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <path
        d="M3.5 8.5l3 3 6-6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <rect
        x="5.5"
        y="5.5"
        width="7"
        height="8"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M3.5 10.5V3.5c0-.55.45-1 1-1H10"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Clear / reset (circle with slash). */
export function ClearIcon({ className }: IconProps) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <circle
        cx="8"
        cy="8"
        r="5.25"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M4.4 4.4l7.2 7.2"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function DuplicateIcon({ className }: IconProps) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <rect
        x="5.5"
        y="5.5"
        width="7"
        height="8"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M3.5 10.5V3.5c0-.55.45-1 1-1H10"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function SqlIcon({ className }: IconProps) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <path
        d="M5.5 4.5L2.8 8l2.7 3.5M10.5 4.5l2.7 3.5-2.7 3.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CsvIcon({ className }: IconProps) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <path
        d="M8 2.5v8"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M5 8l3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 13h10"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <path
        d="M5.5 3.5v9l8-4.5-8-4.5z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.2"
      />
    </svg>
  )
}

/** Collapse all expanded branches (two stacked chevrons down). */
export function FoldAllIcon({ className }: IconProps) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <path
        d="M4 5.5L8 9.5l4-4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 9.5L8 13.5l4-4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Expand all collapsed branches (two stacked chevrons up). */
export function ExpandAllIcon({ className }: IconProps) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <path
        d="M4 10.5L8 6.5l4 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 6.5L8 2.5l4 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Show all (list). */
export function ListAllIcon({ className }: IconProps) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <path
        d="M3 4h10M3 8h10M3 12h10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Visible / selected (open eye). */
export function EyeIcon({ className }: IconProps) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <path
        d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z"
        stroke="currentColor"
        strokeWidth="1.25"
        fill="none"
      />
      <circle cx="8" cy="8" r="1.75" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

/** Hidden (eye with slash). */
export function EyeOffIcon({ className }: IconProps) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'btn-icon-svg'}
      viewBox="0 0 16 16"
    >
      <path
        d="M1.5 8s2.5-4.5 6.5-4.5c1.2 0 2.3.4 3.2 1M14.5 8s-1 .8-2.2 1.8M3 3l10 10"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M6.2 6.4A2 2 0 0 0 9.6 9.8"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

export function StarIcon({
  filled,
  className,
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      {...base}
      width={12}
      height={12}
      className={className ?? 'star-icon'}
      viewBox="0 0 16 16"
    >
      <path
        d="M8 1.6l1.7 3.5 3.8.6-2.75 2.7.65 3.8L8 10.3l-3.4 1.8.65-3.8L2.5 5.7l3.8-.6L8 1.6z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill={filled ? 'currentColor' : 'none'}
        fillOpacity={filled ? 0.9 : undefined}
      />
    </svg>
  )
}

export function FolderIcon({ open, className }: IconProps & { open: boolean }) {
  return (
    <svg
      {...base}
      className={className ?? `tree-icon tree-icon-folder${open ? ' open' : ''}`}
    >
      {open ? (
        <>
          <path
            d="M2 5.5V12c0 .6.4 1 1 1h10c.6 0 1-.4 1-1V7H6.2L5 5.5H2z"
            stroke="currentColor"
            strokeWidth="1.25"
            fill="currentColor"
            fillOpacity="0.12"
          />
          <path
            d="M2 5.5h3L6.2 7H14"
            stroke="currentColor"
            strokeWidth="1.25"
          />
        </>
      ) : (
        <path
          d="M2 4.5h4l1.2 1.3H14v7.2c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V4.5z"
          stroke="currentColor"
          strokeWidth="1.25"
          fill="currentColor"
          fillOpacity="0.08"
        />
      )}
    </svg>
  )
}
