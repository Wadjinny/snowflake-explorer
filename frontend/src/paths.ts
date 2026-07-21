import type { ObjectKind, SelectedObject } from './types'

/** Shareable path for a table/view: /o/:database/:schema/:name */
export function objectPath(
  database: string,
  schema: string,
  name: string,
  kind: ObjectKind = 'table',
): string {
  const base = `/o/${encodeURIComponent(database)}/${encodeURIComponent(schema)}/${encodeURIComponent(name)}`
  return kind === 'view' ? `${base}?kind=view` : base
}

export function objectPathFrom(obj: SelectedObject): string {
  return objectPath(obj.database, obj.schema, obj.name, obj.kind)
}

export function objectKey(
  database: string,
  schema: string,
  name: string,
): string {
  return `${database}\u0000${schema}\u0000${name}`
}

export function objectKeyFrom(obj: SelectedObject): string {
  return objectKey(obj.database, obj.schema, obj.name)
}

export function shortObjectLabel(obj: SelectedObject): string {
  return obj.name
}

export function objectTitle(obj: SelectedObject): string {
  return `${obj.database}.${obj.schema}.${obj.name}`
}
