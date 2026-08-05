from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from filters import build_where, sql_value_literal
from models import (
    Aggregation,
    PivotSpec,
    RecipeColumn,
    SelectedObjectRef,
    TransformRecipe,
)
from snowflake_client import fqn, quote_ident

MAX_JOINS = 5
MAX_PIVOT_VALUES = 30
JOIN_SQL = {
    "inner": "INNER JOIN",
    "left": "LEFT JOIN",
    "right": "RIGHT JOIN",
    "full": "FULL OUTER JOIN",
}
AGG_SQL = {
    "count": "COUNT",
    "count_distinct": "COUNT",
    "sum": "SUM",
    "avg": "AVG",
    "min": "MIN",
    "max": "MAX",
}


def parse_ref(ref: str, default_alias: str = "t0") -> tuple[str, str]:
    if "." in ref:
        alias, _, col = ref.partition(".")
        if alias and col:
            return alias, col
    return default_alias, ref


def qualify(alias: str, column: str) -> str:
    return f"{quote_ident(alias)}.{quote_ident(column)}"


def object_fqn(obj: SelectedObjectRef) -> str:
    return fqn(obj.database, obj.schema_name, obj.name)


def _validate_aliases(recipe: TransformRecipe) -> set[str]:
    aliases = {recipe.sourceAlias}
    for join in recipe.joins:
        if join.alias in aliases:
            raise HTTPException(
                status_code=400, detail=f"Duplicate join alias: {join.alias}"
            )
        aliases.add(join.alias)
    return aliases


def _validate_columns(
    ref: str,
    schemas: dict[str, set[str]],
    *,
    default_alias: str,
) -> tuple[str, str]:
    alias, col = parse_ref(ref, default_alias)
    cols = schemas.get(alias)
    if cols is None:
        raise HTTPException(status_code=400, detail=f"Unknown alias: {alias}")
    # Snowflake identifiers are typically uppercase; probe names as returned.
    if col not in cols:
        upper = {c.upper(): c for c in cols}
        matched = upper.get(col.upper())
        if matched is None:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown column {alias}.{col}",
            )
        col = matched
    return alias, col


def _agg_expr(agg: Aggregation, schemas: dict[str, set[str]], default_alias: str) -> str:
    fn = AGG_SQL[agg.fn]
    if agg.fn == "count" and agg.column is None:
        return f"{fn}(*)"
    if agg.column is None:
        raise HTTPException(
            status_code=400, detail=f"{agg.fn} requires a column"
        )
    alias, col = _validate_columns(agg.column, schemas, default_alias=default_alias)
    qualified = qualify(alias, col)
    if agg.fn == "count_distinct":
        return f"{fn}(DISTINCT {qualified})"
    return f"{fn}({qualified})"


def _select_column(col: RecipeColumn, schemas: dict[str, set[str]], default_alias: str) -> str:
    alias, name = _validate_columns(col.ref, schemas, default_alias=default_alias)
    expr = qualify(alias, name)
    out = col.as_name or name
    return f"{expr} AS {quote_ident(out)}"


def build_from_clause(recipe: TransformRecipe, aliases: set[str]) -> str:
    if len(recipe.joins) > MAX_JOINS:
        raise HTTPException(
            status_code=400,
            detail=f"At most {MAX_JOINS} joins allowed",
        )
    parts = [
        f"{object_fqn(recipe.source)} AS {quote_ident(recipe.sourceAlias)}"
    ]
    for join in recipe.joins:
        if join.alias not in aliases:
            raise HTTPException(status_code=400, detail=f"Unknown alias {join.alias}")
        if not join.on:
            raise HTTPException(
                status_code=400,
                detail=f"Join {join.alias} needs at least one ON condition",
            )
        join_kw = JOIN_SQL[join.type]
        target = object_fqn(join.target)
        on_parts: list[str] = []
        for cond in join.on:
            if cond.leftAlias not in aliases or cond.rightAlias not in aliases:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid ON aliases for join {join.alias}",
                )
            on_parts.append(
                f"{qualify(cond.leftAlias, cond.leftColumn)} = "
                f"{qualify(cond.rightAlias, cond.rightColumn)}"
            )
        parts.append(
            f"{join_kw} {target} AS {quote_ident(join.alias)} "
            f"ON {' AND '.join(on_parts)}"
        )
    return " ".join(parts)


def _all_star_select(schemas: dict[str, list[tuple[str, str]]]) -> str:
    """SELECT alias.col AS out_name for every column, disambiguating duplicates."""
    seen: dict[str, int] = {}
    parts: list[str] = []
    for alias, cols in schemas.items():
        for name, _typ in cols:
            count = seen.get(name, 0)
            seen[name] = count + 1
            out = name if count == 0 else f"{alias}_{name}"
            parts.append(f"{qualify(alias, name)} AS {quote_ident(out)}")
    if not parts:
        return "*"
    return ", ".join(parts)


def compile_inner_select(
    recipe: TransformRecipe,
    schemas: dict[str, list[tuple[str, str]]],
    *,
    for_pivot: bool = False,
) -> tuple[str, list[str]]:
    """Return (sql_without_order_limit, output_column_names)."""
    alias_set = _validate_aliases(recipe)
    col_sets = {a: {n for n, _ in cols} for a, cols in schemas.items()}
    from_sql = build_from_clause(recipe, alias_set)
    where = _build_qualified_where(recipe)
    default_alias = recipe.sourceAlias
    output_names: list[str] = []

    if recipe.pivot and for_pivot:
        select_parts: list[str] = []
        for ref in recipe.pivot.rowKeys:
            a, c = _validate_columns(ref, col_sets, default_alias=default_alias)
            select_parts.append(f"{qualify(a, c)} AS {quote_ident(c)}")
            output_names.append(c)
        pa, pc = _validate_columns(
            recipe.pivot.pivotColumn, col_sets, default_alias=default_alias
        )
        select_parts.append(f"{qualify(pa, pc)} AS {quote_ident(pc)}")
        output_names.append(pc)
        va, vc = _validate_columns(
            recipe.pivot.valueColumn, col_sets, default_alias=default_alias
        )
        select_parts.append(f"{qualify(va, vc)} AS {quote_ident(vc)}")
        output_names.append(vc)
        sql = f"SELECT {', '.join(select_parts)} FROM {from_sql}{where}"
        return sql, output_names

    if recipe.aggregations or recipe.groupBy:
        select_parts = []
        for ref in recipe.groupBy:
            a, c = _validate_columns(ref, col_sets, default_alias=default_alias)
            out = c
            select_parts.append(f"{qualify(a, c)} AS {quote_ident(out)}")
            output_names.append(out)
        for agg in recipe.aggregations:
            expr = _agg_expr(agg, col_sets, default_alias)
            select_parts.append(f"{expr} AS {quote_ident(agg.alias)}")
            output_names.append(agg.alias)
        if not select_parts:
            raise HTTPException(
                status_code=400, detail="Aggregation requires groupBy or metrics"
            )
        group_sql = ""
        if recipe.groupBy:
            group_exprs = []
            for ref in recipe.groupBy:
                a, c = _validate_columns(ref, col_sets, default_alias=default_alias)
                group_exprs.append(qualify(a, c))
            group_sql = " GROUP BY " + ", ".join(group_exprs)
        having = _build_having(recipe)
        sql = (
            f"SELECT {', '.join(select_parts)} "
            f"FROM {from_sql}{where}{group_sql}{having}"
        )
        return sql, output_names

    select_kw = "SELECT DISTINCT" if recipe.distinct else "SELECT"

    if recipe.columns:
        select_parts = []
        for col in recipe.columns:
            a, c = _validate_columns(col.ref, col_sets, default_alias=default_alias)
            out = col.as_name or c
            select_parts.append(f"{qualify(a, c)} AS {quote_ident(out)}")
            output_names.append(out)
        sql = f"{select_kw} {', '.join(select_parts)} FROM {from_sql}{where}"
        return sql, output_names

    select_list = _all_star_select(schemas)
    seen: dict[str, int] = {}
    for _alias, cols in schemas.items():
        for name, _ in cols:
            count = seen.get(name, 0)
            seen[name] = count + 1
            output_names.append(name if count == 0 else f"{_alias}_{name}")
    sql = f"{select_kw} {select_list} FROM {from_sql}{where}"
    return sql, output_names


def _build_qualified_where(recipe: TransformRecipe) -> str:
    filters = [
        (f.column, f.type, f.values, getattr(f, "op", "in") or "in")
        for f in recipe.filters
        if not getattr(f, "disabled", False)
    ]
    # aliases={} → bare columns fall back to default_alias (the source alias);
    # ``alias.column`` refs are split as usual.
    return build_where(filters, aliases={}, default_alias=recipe.sourceAlias)


def _build_having(recipe: TransformRecipe) -> str:
    """HAVING on bare output aliases (group-by names + aggregation aliases)."""
    filters = [
        (f.column, f.type, f.values, getattr(f, "op", "in") or "in")
        for f in recipe.havingFilters
        if not getattr(f, "disabled", False)
    ]
    # aliases=None → treat filter columns as bare identifiers (SELECT aliases).
    clause = build_where(filters, aliases=None)
    if not clause:
        return ""
    return " HAVING " + clause.removeprefix(" WHERE ")


def compile_pivot_select(
    base_sql: str,
    pivot: PivotSpec,
    pivot_values: list[Any],
    row_key_names: list[str],
) -> tuple[str, list[str]]:
    """Conditional aggregation pivot (portable, no dynamic PIVOT IN list issues)."""
    if not pivot_values:
        raise HTTPException(
            status_code=400, detail="No distinct values to pivot on"
        )
    fn = AGG_SQL[pivot.agg]
    _, pivot_col = parse_ref(pivot.pivotColumn)
    _, value_col = parse_ref(pivot.valueColumn)

    select_parts = [quote_ident(k) for k in row_key_names]
    out_names = list(row_key_names)
    for i, raw in enumerate(pivot_values):
        if raw is None:
            lit = "NULL"
            label = "NULL"
            cond = f"{quote_ident(pivot_col)} IS NULL"
        else:
            # Infer type loosely as string for labels; numbers as number
            if isinstance(raw, (int, float)) and not isinstance(raw, bool):
                lit = sql_value_literal(raw, "number")
            else:
                lit = sql_value_literal(str(raw)[:80], "string")
            label = str(raw)[:60] or f"v{i}"
            cond = f"{quote_ident(pivot_col)} = {lit}"
        safe_label = label.replace('"', "")
        out = safe_label
        # Disambiguate
        base = out
        n = 1
        while out in out_names:
            out = f"{base}_{n}"
            n += 1
        out_names.append(out)
        if pivot.agg == "count":
            select_parts.append(
                f"{fn}(CASE WHEN {cond} THEN 1 END) AS {quote_ident(out)}"
            )
        elif pivot.agg == "count_distinct":
            select_parts.append(
                f"{fn}(DISTINCT CASE WHEN {cond} THEN {quote_ident(value_col)} END) "
                f"AS {quote_ident(out)}"
            )
        else:
            select_parts.append(
                f"{fn}(CASE WHEN {cond} THEN {quote_ident(value_col)} END) "
                f"AS {quote_ident(out)}"
            )

    group = ", ".join(quote_ident(k) for k in row_key_names)
    sql = (
        f"SELECT {', '.join(select_parts)} FROM ({base_sql}) AS _pivot_src "
        f"GROUP BY {group}"
    )
    return sql, out_names


def order_limit_sql(
    sorts: list[tuple[str, str]] | None,
    limit: int,
    offset: int = 0,
) -> str:
    """*sorts* is a list of (column, direction) pairs."""
    order = ""
    if sorts:
        parts: list[str] = []
        for sort_column, direction in sorts:
            # Outer SELECT aliases are bare names; allow alias.col from the builder.
            col = sort_column.split(".")[-1] if "." in sort_column else sort_column
            dir_sql = "DESC" if direction == "desc" else "ASC"
            parts.append(f"{quote_ident(col)} {dir_sql} NULLS LAST")
        if parts:
            order = " ORDER BY " + ", ".join(parts)
    off = max(0, int(offset))
    return f"{order} LIMIT {int(limit)} OFFSET {off}"


def join_targets(recipe: TransformRecipe) -> list[tuple[str, SelectedObjectRef]]:
    return [(recipe.sourceAlias, recipe.source)] + [
        (j.alias, j.target) for j in recipe.joins
    ]
