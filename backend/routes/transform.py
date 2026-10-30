from __future__ import annotations

import hashlib
import logging
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Response
from snowflake.connector.errors import Error as SnowflakeError

from columns import describe_columns
from deps import get_connection
from errors import snowflake_http_error
from models import (
    ColumnInfo,
    ColumnType,
    SnowflakeConnection,
    TransformRequest,
    TransformResult,
)
from rowset import fetch_page_with_total, json_response, serialize_rows
from snowflake_client import (
    credentials_hash,
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
    order_limit_sql,
    parse_ref,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["transform"])

def _total_cache_key(cfg: SnowflakeConnection, inner_sql: str) -> str:
    """Key a recipe's total by its compiled statement, not by LIMIT/OFFSET."""
    digest = hashlib.sha256(inner_sql.encode()).hexdigest()[:32]
    return f"total:{credentials_hash(cfg)}:transform:{digest}"


def _probe_schemas(
    cfg: SnowflakeConnection,
    recipe: Any,
) -> dict[str, list[tuple[str, str]]]:
    """Column names/types per source alias.

    Goes through ``describe_columns`` rather than ``SELECT * LIMIT 0`` so it
    shares the 30 minute ``column_cache`` with Browse: a builder edit or a page
    turn no longer costs one round trip per source. ``DESC TABLE`` is also
    cheaper than ``LIMIT 0`` on heavy views, which is why columns.py exists.
    """
    schemas: dict[str, list[tuple[str, str]]] = {}
    for alias, obj in join_targets(recipe):
        try:
            meta = describe_columns(cfg, obj.database, obj.schema_name, obj.name)
        except SnowflakeError as exc:
            raise snowflake_http_error(exc) from exc
        schemas[alias] = [(c.name, c.type) for c in meta]
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
        raise snowflake_http_error(exc) from exc
    return [r[0] for r in rows]


@router.post("/transform/run", responses={200: {"model": TransformResult}})
def run_transform(
    body: TransformRequest,
    cfg: SnowflakeConnection = Depends(get_connection),
) -> Response:
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

    sorts = [(s.column, s.direction) for s in recipe.sort]
    data_sql = (
        f"{inner_sql}"
        f"{order_limit_sql(sorts, body.limit, body.offset)}"
    )

    def count() -> int:
        """Total rows the recipe produces. Independent of LIMIT/OFFSET."""
        try:
            _, count_rows = run_query(
                cfg, f"SELECT COUNT(*) AS cnt FROM ({inner_sql}) AS _cnt"
            )
            return int(count_rows[0][0]) if count_rows else 0
        except SnowflakeError as exc:
            logger.warning(
                "Transform COUNT failed: %s", snowflake_error_detail(exc)
            )
            return -1

    # Counting re-executes the whole recipe — joins, aggregations, pivot. Cache
    # it against the compiled statement so paging does not re-run it, and
    # overlap it with the row page on the first run.
    try:
        (out_names, out_types, rows), total = fetch_page_with_total(
            cache_key=_total_cache_key(cfg, inner_sql),
            count=count,
            fetch=lambda: run_query_typed(cfg, data_sql),
        )
    except SnowflakeError as exc:
        raise snowflake_http_error(exc) from exc

    return json_response(
        {
            "columns": [
                {"name": n, "type": out_types[i]}
                for i, n in enumerate(out_names)
            ],
            "rows": serialize_rows(rows),
            "total": total,
            "sql": data_sql,
        },
        TransformResult,
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
