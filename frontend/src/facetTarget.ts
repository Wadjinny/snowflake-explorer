import type {
  ColumnFilter,
  ColumnInfo,
  ColumnType,
  FacetableType,
  SelectedObject,
} from './types'
import { isFacetable } from './types'
import { parseColumnRef, type TransformRecipe } from './transformations'

export type FacetTarget = {
  object: SelectedObject
  /** Bare column name for the facet API. */
  bareColumn: string
  /** Qualified / recipe filter key (`t0.col`). */
  filterKey: string
  type: FacetableType
}

export function objectForAlias(
  recipe: TransformRecipe,
  alias: string,
): SelectedObject | null {
  if (alias === recipe.sourceAlias) return recipe.source
  const join = recipe.joins.find((j) => j.alias === alias)
  return join?.target ?? null
}

export function findProbeColumn(
  cols: ColumnInfo[],
  resultName: string,
  sourceAlias: string,
): ColumnInfo | null {
  const exact = cols.find((c) => c.name === resultName)
  if (exact) return exact

  const byBare = cols.filter(
    (c) => parseColumnRef(c.name, sourceAlias).column === resultName,
  )
  if (byBare.length === 1) return byBare[0]!
  if (byBare.length > 1) {
    return (
      byBare.find(
        (c) => parseColumnRef(c.name, sourceAlias).alias === sourceAlias,
      ) ?? byBare[0]!
    )
  }

  const disambiguated = cols.find((c) => {
    const { alias, column } = parseColumnRef(c.name, sourceAlias)
    return `${alias}_${column}` === resultName
  })
  return disambiguated ?? null
}

/** Resolve a result / recipe column to a physical table + bare name for facets. */
export function facetTargetFromRecipe(
  columnRef: string,
  columnType: ColumnType,
  recipe: TransformRecipe,
  probeColumns: ColumnInfo[] = [],
): FacetTarget | null {
  const probe =
    findProbeColumn(probeColumns, columnRef, recipe.sourceAlias) ??
    probeColumns.find((c) => c.name === columnRef) ??
    null

  if (probe && isFacetable(probe.type)) {
    const { alias, column } = parseColumnRef(probe.name, recipe.sourceAlias)
    const object = objectForAlias(recipe, alias)
    if (object?.name) {
      return {
        object,
        bareColumn: column,
        filterKey: probe.name.includes('.')
          ? probe.name
          : `${alias}.${column}`,
        type: probe.type,
      }
    }
  }

  // Recipe filters often store qualified names already.
  const { alias, column } = parseColumnRef(columnRef, recipe.sourceAlias)
  const object = objectForAlias(recipe, alias)
  if (object?.name && isFacetable(columnType)) {
    return {
      object,
      bareColumn: column,
      filterKey: columnRef.includes('.')
        ? columnRef
        : `${alias}.${column}`,
      type: columnType,
    }
  }

  if (!isFacetable(columnType)) return null
  return {
    object: recipe.source,
    bareColumn: column,
    filterKey: `${recipe.sourceAlias}.${column}`,
    type: columnType,
  }
}

/**
 * Recipe filters that hit the same physical alias as `target`, rewritten to
 * bare column names for the facet API (which scopes counts by other filters).
 */
export function tableFiltersForTarget(
  recipe: TransformRecipe,
  target: FacetTarget,
): ColumnFilter[] {
  const targetAlias = parseColumnRef(target.filterKey, recipe.sourceAlias).alias
  return recipe.filters.flatMap((f) => {
    const { alias, column } = parseColumnRef(f.column, recipe.sourceAlias)
    if (alias !== targetAlias) return []
    const next: ColumnFilter = { column, type: f.type, values: f.values }
    if (f.op) next.op = f.op
    return [next]
  })
}
