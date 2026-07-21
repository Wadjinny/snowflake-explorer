import { useState } from 'react'
import { Outlet } from 'react-router'
import { testConnection } from '../api/snowflake'
import ConnectionManager from '../components/ConnectionManager'
import { useConnections } from '../connections'

function RootLayout() {
  const { connections, activeId, active, setActiveId } = useConnections()
  const [manageOpen, setManageOpen] = useState(false)
  const [testStatus, setTestStatus] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const onTest = async () => {
    if (!active) {
      setManageOpen(true)
      return
    }
    setTesting(true)
    setTestStatus(null)
    try {
      await testConnection(active)
      setTestStatus('OK')
    } catch (err) {
      setTestStatus(err instanceof Error ? err.message : 'Failed')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-title">Snowflake Explorer</div>
        <div className="top-bar-name" title={active?.name ?? undefined}>
          {active?.name ?? '—'}
        </div>
        <div className="toolbar">
          <select
            className="select"
            value={activeId ?? ''}
            onChange={(e) => setActiveId(e.target.value || null)}
            aria-label="Active connection"
          >
            {connections.length === 0 ? (
              <option value="">No connection</option>
            ) : (
              connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            className="btn"
            onClick={() => setManageOpen(true)}
          >
            Manage
          </button>
          <button
            type="button"
            className="btn"
            onClick={onTest}
            disabled={testing || !active}
          >
            {testing ? 'Testing…' : 'Test'}
          </button>
          {testStatus ? (
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 10,
                color:
                  testStatus === 'OK' ? 'var(--data)' : 'var(--error)',
                maxWidth: 180,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={testStatus}
            >
              {testStatus}
            </span>
          ) : null}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0 }}>
        <Outlet />
      </div>

      <ConnectionManager
        open={manageOpen}
        onClose={() => setManageOpen(false)}
      />
    </div>
  )
}

export default RootLayout
