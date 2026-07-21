type Props = {
  size?: 'sm' | 'md'
  label?: string
  /** Centered block for empty panel bodies */
  block?: boolean
}

export default function Spinner({
  size = 'sm',
  label,
  block = false,
}: Props) {
  const el = (
    <span
      className={`spinner-wrap${block ? ' spinner-block' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
    >
      <span className={`spinner spinner-${size}`} />
      {label ? <span className="spinner-label">{label}</span> : null}
    </span>
  )
  return el
}
