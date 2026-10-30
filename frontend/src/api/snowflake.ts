import type {
  ColumnFilter,
  ColumnInfo,
  Connection,
  FacetPeriodResult,
  FacetResult,
  FacetableType,
  NameItem,
  ObjectItem,
  PeriodGrain,
  CountResult,
  PreviewResult,
  SchemaItem,
  SortSpec,
} from '../types'
import { getDefaultPageSize } from '../pageSizePrefs'

function encodeConnectionHeader(connection: Connection): string {
  const payload = {
    account: connection.account,
    user: connection.user,
    password: connection.password,
    warehouse: connection.warehouse,
    ...(connection.role ? { role: connection.role } : {}),
  }
  const json = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function apiFetch<T>(
  connection: Connection,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'X-Snowflake-Connection': encodeConnectionHeader(connection),
    },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const body: unknown = await res.json()
        if (
          body &&
          typeof body === 'object' &&
          'detail' in body &&
          body.detail != null
        ) {
          detail =
            typeof body.detail === 'string'
              ? body.detail
              : JSON.stringify(body.detail)
        }
      } else {
        const text = (await res.text()).trim()
        if (text.startsWith('<!') || text.toLowerCase().includes('<html')) {
          // An HTML body is the proxy's error page, not the API: the backend's
          // JSON detail never reached us, so do not guess at a cause.
          detail = `API unreachable (HTTP ${res.status} from the proxy). The backend may be down; check its logs.`
        } else if (text) {
          detail = text.slice(0, 400)
        }
      }
    } catch {
      // keep statusText
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export function testConnection(connection: Connection): Promise<{ ok: boolean }> {
  return apiFetch(connection, '/api/connection/test', { method: 'POST' })
}

export function invalidateCatalog(
  connection: Connection,
): Promise<{ ok: boolean }> {
  return apiFetch(connection, '/api/catalog/invalidate', { method: 'POST' })
}

export function listDatabases(connection: Connection): Promise<NameItem[]> {
  return apiFetch(connection, '/api/databases')
}

/** All schemas in the account (`SHOW TERSE SCHEMAS IN ACCOUNT`). */
export function listAllSchemas(
  connection: Connection,
): Promise<SchemaItem[]> {
  return apiFetch(connection, '/api/schemas')
}

export function listSchemas(
  connection: Connection,
  database: string,
): Promise<NameItem[]> {
  return apiFetch(
    connection,
    `/api/databases/${encodeURIComponent(database)}/schemas`,
  )
}

export function listObjects(
  connection: Connection,
  database: string,
  schema: string,
): Promise<ObjectItem[]> {
  return apiFetch(
    connection,
    `/api/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/objects`,
  )
}

export function previewObject(
  connection: Connection,
  database: string,
  schema: string,
  name: string,
  limit: number,
  offset: number,
  filters: ColumnFilter[] = [],
  sort: SortSpec | null = null,
  distinct = false,
  hiddenColumns: string[] = [],
): Promise<PreviewResult> {
  return apiFetch(
    connection,
    `/api/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/objects/${encodeURIComponent(name)}/preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit,
        offset,
        filters,
        sort,
        distinct,
        hiddenColumns: distinct ? hiddenColumns : [],
      }),
    },
  )
}

export function countObject(
  connection: Connection,
  database: string,
  schema: string,
  name: string,
  filters: ColumnFilter[] = [],
  distinct = false,
  hiddenColumns: string[] = [],
): Promise<CountResult> {
  return apiFetch(
    connection,
    `/api/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/objects/${encodeURIComponent(name)}/count`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters,
        distinct,
        hiddenColumns: distinct ? hiddenColumns : [],
      }),
    },
  )
}

export function facetColumn(
  connection: Connection,
  database: string,
  schema: string,
  name: string,
  column: string,
  type: FacetableType,
  q: string,
  limit: number,
  offset: number,
  filters: ColumnFilter[] = [],
): Promise<FacetResult> {
  return apiFetch(
    connection,
    `/api/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/objects/${encodeURIComponent(name)}/facet`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        column,
        type,
        q,
        limit,
        offset,
        filters,
      }),
    },
  )
}

export function facetPeriods(
  connection: Connection,
  database: string,
  schema: string,
  name: string,
  column: string,
  type: FacetableType,
  grain: PeriodGrain,
  parent: string | null = null,
  filters: ColumnFilter[] = [],
  clip: string | null = null,
): Promise<FacetPeriodResult> {
  return apiFetch(
    connection,
    `/api/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/objects/${encodeURIComponent(name)}/facet-periods`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        column,
        type,
        grain,
        parent,
        clip,
        filters,
      }),
    },
  )
}

export type TransformRunResult = PreviewResult & { sql: string }

export function runTransform(
  connection: Connection,
  recipe: unknown,
  opts: { limit?: number; offset?: number } = {},
): Promise<TransformRunResult> {
  return apiFetch(connection, '/api/transform/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipe,
      limit: opts.limit ?? getDefaultPageSize(),
      offset: opts.offset ?? 0,
    }),
  })
}

export function probeTransformColumns(
  connection: Connection,
  recipe: unknown,
): Promise<ColumnInfo[]> {
  return apiFetch(connection, '/api/transform/columns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe }),
  })
}
