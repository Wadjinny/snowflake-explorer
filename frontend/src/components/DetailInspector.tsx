import { useEffect, useMemo, useState } from 'react'
import type { ColumnType, PreviewResult } from '../types'
import { CheckIcon, CloseIcon, CopyIcon } from './TreeIcons'

export type GridSelection = {
  /** Index within the current page of rows. */
  rowIndex: number
  /** Selected column name; null = row-only selection. */
  column: string | null
}

type Props = {
  data: PreviewResult
  selection: GridSelection | null
  onSelectColumn: (column: string) => void
  onClose: () => void
  /** Absolute row number for display (1-based across pages). */
  rowNumber: number | null
}

type Tab = 'cell' | 'row'

export default function DetailInspector({
  data,
  selection,
  onSelectColumn,
  onClose,
  rowNumber,
}: Props) {
  const [tab, setTab] = useState<Tab>('row')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!selection) return
    setTab(selection.column ? 'cell' : 'row')
  }, [selection])

  const row = selection ? data.rows[selection.rowIndex] : null
  const colInfo = useMemo(() => {
    if (!selection?.column) return null
    return data.columns.find((c) => c.name === selection.column) ?? null
  }, [data.columns, selection?.column])

  const cellValue =
    row && colInfo
      ? row[data.columns.findIndex((c) => c.name === colInfo.name)]
      : undefined

  const cellText = formatDetailValue(cellValue, colInfo?.type ?? 'other')
  const cellUrl = parseHttpUrl(cellText)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [cellUrl])

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // ignore
    }
  }

  if (!selection || !row) {
    return (
      <div className="panel inspector-panel">
        <div className="panel-header">
          <button
            type="button"
            className="btn-micro btn-icon"
            onClick={onClose}
            title="Close inspector"
            aria-label="Close inspector"
          >
            <CloseIcon />
          </button>
          <span className="panel-title">Inspector</span>
        </div>
        <div className="panel-body">
          <div className="empty-hint">Double-click a cell or row number</div>
        </div>
      </div>
    )
  }

  return (
    <div className="panel inspector-panel">
      <div className="panel-header">
        <div className="inspector-header-left">
          <button
            type="button"
            className="btn-micro btn-icon"
            onClick={onClose}
            title="Close inspector"
            aria-label="Close inspector"
          >
            <CloseIcon />
          </button>
          <span className="panel-title">Inspector</span>
          {rowNumber != null ? (
            <span className="inspector-meta" title={`Row ${rowNumber}`}>
              row {rowNumber}
            </span>
          ) : null}
        </div>
      </div>

      <div className="inspector-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'cell'}
          className={`inspector-tab${tab === 'cell' ? ' active' : ''}`}
          disabled={!selection.column}
          onClick={() => setTab('cell')}
        >
          Cell
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'row'}
          className={`inspector-tab${tab === 'row' ? ' active' : ''}`}
          onClick={() => setTab('row')}
        >
          Row
        </button>
      </div>

      <div className="panel-body inspector-body">
        {tab === 'cell' && colInfo ? (
          <div className="inspector-cell">
            <div className="inspector-cell-head">
              <span className="inspector-cell-name" title={colInfo.name}>
                {colInfo.name}
              </span>
              <span className={`kind-badge type-${colInfo.type}`}>
                {colInfo.type}
              </span>
              <button
                type="button"
                className={`btn-micro btn-icon${copied ? ' open' : ''}`}
                onClick={() => void copyText(cellText)}
                title={copied ? 'Copied' : 'Copy value'}
                aria-label={copied ? 'Copied' : 'Copy value'}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
            <div
              className={`inspector-value${
                cellValue == null
                  ? ' cell-null'
                  : ` cell-type type-${colInfo.type}`
              }`}
            >
              {cellUrl ? (
                <>
                  {isImageUrl(cellUrl) && !imageFailed ? (
                    <a
                      href={cellUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inspector-image-link"
                      title="Open image in new tab"
                    >
                      <img
                        className="inspector-image"
                        src={cellUrl}
                        alt=""
                        loading="lazy"
                        onError={() => setImageFailed(true)}
                      />
                    </a>
                  ) : null}
                  <a
                    href={cellUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inspector-link"
                  >
                    {cellText}
                  </a>
                </>
              ) : (
                cellText
              )}
            </div>
          </div>
        ) : null}

        {tab === 'row' ? (
          <div className="inspector-row-list">
            {data.columns.map((col, index) => {
              const value = row[index]
              const active = selection.column === col.name
              const preview = formatDetailValue(value, col.type)
              return (
                <button
                  key={col.name}
                  type="button"
                  className={`inspector-field${active ? ' active' : ''}`}
                  onClick={() => {
                    onSelectColumn(col.name)
                    setTab('cell')
                  }}
                >
                  <div className="inspector-field-head">
                    <span className="inspector-field-name" title={col.name}>
                      {col.name}
                    </span>
                    <span className={`kind-badge type-${col.type}`}>
                      {col.type}
                    </span>
                  </div>
                  <span
                    className={`inspector-field-value${
                      value == null
                        ? ' cell-null'
                        : ` cell-type type-${col.type}`
                    }`}
                  >
                    {preview}
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function formatDetailValue(
  value: string | number | boolean | null | undefined,
  type: ColumnType,
): string {
  if (value === undefined) return ''
  if (value == null) return 'NULL'
  if (type === 'boolean') {
    return value === true || value === 'true' || value === 1 ? 'true' : 'false'
  }
  const s = String(value)
  if (type === 'semi' || looksLikeJson(s)) {
    try {
      return JSON.stringify(JSON.parse(s), null, 2)
    } catch {
      // fall through
    }
  }
  return s
}

function looksLikeJson(s: string): boolean {
  const t = s.trim()
  return (
    (t.startsWith('{') && t.endsWith('}')) ||
    (t.startsWith('[') && t.endsWith(']'))
  )
}

/** Whole-string http(s) URL, or null. */
function parseHttpUrl(text: string): string | null {
  const t = text.trim()
  if (!/^https?:\/\//i.test(t)) return null
  try {
    const u = new URL(t)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.href
  } catch {
    return null
  }
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg)(?:[?#]|$)/i

function isImageUrl(url: string): boolean {
  try {
    return IMAGE_EXT.test(new URL(url).pathname)
  } catch {
    return IMAGE_EXT.test(url)
  }
}
