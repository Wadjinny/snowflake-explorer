import { useEffect, useState } from 'react'
import { testConnection } from '../api/snowflake'
import { emptyConnection } from '../connectionStorage'
import { useConnections } from '../connections'
import type { Connection } from '../types'

type Props = {
  open: boolean
  onClose: () => void
}

export default function ConnectionManager({ open, onClose }: Props) {
  const { connections, activeId, setActiveId, upsert, remove } = useConnections()
  const [draft, setDraft] = useState<Connection>(() => emptyConnection())
  const [status, setStatus] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!open) return
    const current = connections.find((c) => c.id === activeId)
    setDraft(current ? { ...current } : emptyConnection())
    setStatus(null)
  }, [open, activeId, connections])

  if (!open) return null

  const update = (field: keyof Connection, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }))
  }

  const onNew = () => {
    setDraft(emptyConnection())
    setStatus(null)
  }

  const onSave = () => {
    if (!draft.name.trim() || !draft.account.trim() || !draft.user.trim()) {
      setStatus('Name, account, and user are required.')
      return
    }
    if (!draft.password || !draft.warehouse.trim()) {
      setStatus('Password and warehouse are required.')
      return
    }
    const saved: Connection = {
      ...draft,
      name: draft.name.trim(),
      account: draft.account.trim(),
      user: draft.user.trim(),
      warehouse: draft.warehouse.trim(),
      role: draft.role?.trim() || undefined,
    }
    upsert(saved)
    setActiveId(saved.id)
    setDraft(saved)
    setStatus('Saved.')
  }

  const onDelete = () => {
    if (!connections.some((c) => c.id === draft.id)) {
      setDraft(emptyConnection())
      return
    }
    remove(draft.id)
    setStatus('Deleted.')
  }

  const onTest = async () => {
    setTesting(true)
    setStatus(null)
    try {
      await testConnection(draft)
      setStatus('Connection OK.')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Connection failed.')
    } finally {
      setTesting(false)
    }
  }

  const selectExisting = (id: string) => {
    const found = connections.find((c) => c.id === id)
    if (!found) return
    setDraft({ ...found })
    setActiveId(id)
    setStatus(null)
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-label="Connections"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">Connections</div>

        <div className="conn-list">
          {connections.length === 0 ? (
            <div className="empty-hint" style={{ height: 'auto', padding: 8 }}>
              No saved connections
            </div>
          ) : (
            connections.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`conn-row${c.id === draft.id ? ' active' : ''}`}
                onClick={() => selectExisting(c.id)}
              >
                {c.id === activeId ? '* ' : ''}
                {c.name}
              </button>
            ))
          )}
        </div>

        <div className="form-grid">
          <label htmlFor="conn-name">Name</label>
          <input
            id="conn-name"
            className="input"
            value={draft.name}
            onChange={(e) => update('name', e.target.value)}
          />
          <label htmlFor="conn-account">Account</label>
          <input
            id="conn-account"
            className="input"
            value={draft.account}
            onChange={(e) => update('account', e.target.value)}
            placeholder="xy12345.eu-west-1"
          />
          <label htmlFor="conn-user">User</label>
          <input
            id="conn-user"
            className="input"
            value={draft.user}
            onChange={(e) => update('user', e.target.value)}
          />
          <label htmlFor="conn-password">Password</label>
          <input
            id="conn-password"
            className="input"
            type="password"
            value={draft.password}
            onChange={(e) => update('password', e.target.value)}
          />
          <label htmlFor="conn-warehouse">Warehouse</label>
          <input
            id="conn-warehouse"
            className="input"
            value={draft.warehouse}
            onChange={(e) => update('warehouse', e.target.value)}
          />
          <label htmlFor="conn-role">Role</label>
          <input
            id="conn-role"
            className="input"
            value={draft.role ?? ''}
            onChange={(e) => update('role', e.target.value)}
            placeholder="optional"
          />
        </div>

        {status ? (
          <div
            className="error-bar"
            style={
              status === 'Saved.' || status === 'Connection OK.'
                ? { background: 'transparent', color: 'var(--data)', border: 'none' }
                : status === 'Deleted.'
                  ? { background: 'transparent', color: 'var(--text-muted)', border: 'none' }
                  : undefined
            }
          >
            {status}
          </div>
        ) : null}

        <div className="form-actions">
          <div className="form-actions-left">
            <button type="button" className="btn" onClick={onNew}>
              New
            </button>
            <button type="button" className="btn-primary" onClick={onSave}>
              Save
            </button>
            <button type="button" className="btn" onClick={onDelete}>
              Delete
            </button>
          </div>
          <div className="form-actions-right">
            <button
              type="button"
              className="btn"
              onClick={onTest}
              disabled={testing}
            >
              {testing ? 'Testing…' : 'Test'}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
