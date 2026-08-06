import { resolveColumnOrder } from './openTabs'

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/**
 * Rewrite the SELECT list to match visible column order (browse column picker).
 * When every column stays visible in table order, returns `sql` unchanged.
 */
export function projectPreviewSql(
  sql: string,
  columns: string[],
  hiddenColumns: string[],
  columnOrder: string[] = [],
): string {
  const trimmed = sql.trim()
  if (!trimmed || columns.length === 0) return trimmed

  const hidden = new Set(hiddenColumns.map((h) => h.toUpperCase()))
  const visible = resolveColumnOrder(columns, columnOrder).filter(
    (name) => !hidden.has(name.toUpperCase()),
  )
  if (visible.length === 0) return trimmed

  const unchanged =
    hiddenColumns.length === 0 &&
    columnOrder.length === 0 &&
    visible.length === columns.length
  if (unchanged) return trimmed

  const selectList = visible.map(quoteIdent).join(', ')
  return trimmed.replace(
    /^SELECT(\s+DISTINCT)?\s+[\s\S]*?\s+FROM\s/i,
    (_m, distinct: string | undefined) =>
      `SELECT${distinct ?? ''} ${selectList} FROM `,
  )
}
