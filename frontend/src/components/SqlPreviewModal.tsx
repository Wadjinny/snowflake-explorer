import Editor from '@monaco-editor/react'
import '../monacoSetup'
import { useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { format as formatSql } from 'sql-formatter'
import { CheckIcon, CloseIcon, CopyIcon } from './TreeIcons'

type Props = {
  open: boolean
  sql: string
  onClose: () => void
  title?: string
}

function prettySql(sql: string): string {
  const trimmed = sql.trim()
  if (!trimmed) return ''
  try {
    return formatSql(trimmed, {
      language: 'sql',
      keywordCase: 'upper',
      indentStyle: 'standard',
      linesBetweenQueries: 1,
    })
  } catch {
    return trimmed
  }
}

export default function SqlPreviewModal({
  open,
  sql,
  onClose,
  title = 'SQL',
}: Props) {
  const titleId = useId()
  const [copied, setCopied] = useState(false)
  const formatted = useMemo(() => prettySql(sql), [sql])

  useEffect(() => {
    if (!open) return
    setCopied(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatted)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return createPortal(
    <div
      className="modal-backdrop sql-modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal sql-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sql-modal-header">
          <span className="modal-header" id={titleId}>
            {title}
          </span>
          <div className="sql-modal-actions">
            <button
              type="button"
              className={`btn-micro btn-icon${copied ? ' open' : ''}`}
              onClick={() => void copy()}
              title={copied ? 'Copied' : 'Copy SQL'}
              aria-label={copied ? 'Copied' : 'Copy SQL'}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
            <button
              type="button"
              className="btn-micro btn-icon"
              onClick={onClose}
              title="Close"
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        <div className="sql-modal-editor">
          <Editor
            language="sql"
            theme="vs-dark"
            value={formatted}
            options={{
              readOnly: true,
              domReadOnly: true,
              minimap: { enabled: false },
              fontSize: 12,
              fontFamily: "var(--mono), 'SF Mono', Menlo, monospace",
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              wrappingIndent: 'indent',
              automaticLayout: true,
              renderLineHighlight: 'none',
              selectionHighlight: false,
              occurrencesHighlight: 'off',
              folding: true,
              tabSize: 2,
              padding: { top: 8, bottom: 8 },
              scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
              },
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              overviewRulerBorder: false,
              contextmenu: false,
            }}
            loading={
              <div className="empty-hint" style={{ height: '100%' }}>
                Loading editor…
              </div>
            }
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
