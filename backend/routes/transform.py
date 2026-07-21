from __future__ import annotations

import logging
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException
from snowflake.connector.errors import Error as SnowflakeError

from deps import get_connection
from models import (
    ColumnInfo,
    ColumnType,
    SnowflakeConnection,
    TransformRequest,
    TransformResult,
)
from snowflake_client import (
    quote_ident,
    run_query,
    run_query_typed,
    snowflake_error_detail,
)
from transform_compile import (
    MAX_PIVOT_VALUES,
    compile_inner_select,
    compile_pivot_select,
    join_targets,
    object_fqn,
    order_limit_sql,
    parse_ref,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["transform"])

_MAX_CELL_CHARS = 2_000


def _serialize_cell(value: object) -> object:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"[binary {len(value)} bytes]"
    text = value if isinstance(value, str) else str(value)
    if len(text) > _MAX_CELL_CHARS:
        return text[:_MAX_CELL_CHARS] + "…"
    return text


def _http_snowflake(exc: SnowflakeError) -> HTTPException:
    detail = snowflake_error_detail(exc)
    logger.warning("Snowflake error: %s", detail)
    return HTTPException(status_code=502, detail=detail)


def _probe_schemas(
    cfg: SnowflakeConnection,
    recipe: Any,
) -> dict[str, list[tuple[str, str]]]:
    schemas: dict[str, list[tuple[str, str]]] = {}
    for alias, obj in join_targets(recipe):
        table = object_fqn(obj)
        try:
            names, types, _ = run_query_typed(cfg, f"SELECT * FROM {table} LIMIT 0")
        except SnowflakeError as exc:
            raise _http_snowflake(exc) from exc
        schemas[alias] = list(zip(names, types, strict=True))
    return schemas


def _fetch_pivot_values(
    cfg: SnowflakeConnection,
    base_sql: str,
    pivot_column: str,
) -> list[Any]:
    _, col = parse_ref(pivot_column)
    sql = (
        f"SELECT {quote_ident(col)} AS v, COUNT(*) AS cnt "
        f"FROM ({base_sql}) AS _pv "
        f"GROUP BY 1 ORDER BY cnt DESC NULLS LAST "
        f"LIMIT {MAX_PIVOT_VALUES}"
    )
    try:
        _, rows = run_query(cfg, sql)
    except SnowflakeError as exc:
        raise _http_snowflake(exc) from exc
    return [r[0] for r in rows]


@router.post("/transform/run", response_model=TransformResult)
def run_transform(
    body: TransformRequest,
    cfg: SnowflakeConnection = Depends(get_connection),
) -> TransformResult:
    recipe = body.recipe
    schemas = _probe_schemas(cfg, recipe)

    # Validate ON columns exist
    col_sets = {a: {n for n, _ in cols} for a, cols in schemas.items()}
    for join in recipe.joins:
        for cond in join.on:
            for alias, col in (
                (cond.leftAlias, cond.leftColumn),
                (cond.rightAlias, cond.rightColumn),
            ):
                cols = col_sets.get(alias)
                if cols is None or (
                    col not in cols and col.upper() not in {c.upper() for c in cols}
                ):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unknown join column {alias}.{col}",
                    )

    if recipe.pivot:
        base_sql, base_names = compile_inner_select(
            recipe, schemas, for_pivot=True
        )
        pivot_values = _fetch_pivot_values(cfg, base_sql, recipe.pivot.pivotColumn)
        row_keys = []
        for ref in recipe.pivot.rowKeys:
            _, c = parse_ref(ref, recipe.sourceAlias)
            row_keys.append(c)
        inner_sql, _out = compile_pivot_select(
            base_sql, recipe.pivot, pivot_values, row_keys
        )
    else:
        inner_sql, _out = compile_inner_select(recipe, schemas, for_pivot=False)

    sort_col = recipe.sort.column if recipe.sort else None
    sort_dir = recipe.sort.direction if recipe.sort else None
    data_sql = f"{inner_sql}{order_limit_sql(sort_col, sort_dir, recipe.limit)}"

    count_sql = f"SELECT COUNT(*) AS cnt FROM ({inner_sql}) AS _cnt"
    total = -1
    try:
        _, count_rows = run_query(cfg, count_sql)
        total = int(count_rows[0][0]) if count_rows else 0
    except SnowflakeError as exc:
        logger.warning("Transform COUNT failed: %s", snowflake_error_detail(exc))

    try:
        out_names, out_types, rows = run_query_typed(cfg, data_sql)
    except SnowflakeError as exc:
        raise _http_snowflake(exc) from exc

    columns = [
        ColumnInfo(name=n, type=cast(ColumnType, out_types[i]))
        for i, n in enumerate(out_names)
    ]
    return TransformResult(
        columns=columns,
        rows=[[_serialize_cell(cell) for cell in row] for row in rows],
        total=total,
        sql=data_sql,
    )


@router.post("/transform/columns", response_model=list[ColumnInfo])
def transform_source_columns(
    body: TransformRequest,
    cfg: SnowflakeConnection = Depends(get_connection),
) -> list[ColumnInfo]:
    """Probe columns for all sources in the recipe (for the builder UI)."""
    schemas = _probe_schemas(cfg, body.recipe)
    result: list[ColumnInfo] = []
    seen_names: dict[str, int] = {}
    for alias, cols in schemas.items():
        for name, typ in cols:
            count = seen_names.get(name, 0)
            seen_names[name] = count + 1
            label = name if count == 0 else f"{alias}_{name}"
            result.append(
                ColumnInfo(
                    name=f"{alias}.{name}",
                    type=cast(ColumnType, typ),
                )
            )
            _ = label  # reserved for future display helpers
    return result
