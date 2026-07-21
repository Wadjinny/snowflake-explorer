import logging
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from snowflake.connector.errors import Error as SnowflakeError

from deps import get_connection
from filters import (
    FACETABLE,
    build_where,
    facet_expr,
    serialize_facet_value,
)
from models import (
    ColumnInfo,
    ColumnType,
    FacetResult,
    FacetValue,
    FacetableType,
    PreviewRequest,
    PreviewResult,
    SnowflakeConnection,
)
from snowflake_client import (
    fqn,
    quote_ident,
    run_query,
    run_query_typed,
    snowflake_error_detail,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["data"])

# Types that are unsafe/huge to pull raw in a grid preview.
_STUB_TYPES = frozenset({"binary", "geo"})
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


def _facet_label(value: object) -> str:
    if value is None:
        return "NULL"
    return str(value)


def _order_clause(sort_column: str | None, direction: str | None) -> str:
    if not sort_column:
        return ""
    dir_sql = "DESC" if direction == "desc" else "ASC"
    return f" ORDER BY {quote_ident(sort_column)} {dir_sql} NULLS LAST"


def _preview_select_sql(table: str, names: list[str], types: list[str]) -> str:
    """Build a SELECT list that stubs/truncates heavy columns for the grid."""
    parts: list[str] = []
    for name, typ in zip(names, types, strict=True):
        ident = quote_ident(name)
        if typ == "binary":
            parts.append(
                "CONCAT('[binary ', "
                f"COALESCE(TO_VARCHAR(OCTET_LENGTH({ident})), '?'), "
                f"' bytes]') AS {ident}"
            )
        elif typ == "geo":
            parts.append(f"TO_VARCHAR({ident}) AS {ident}")
        elif typ in ("string", "semi"):
            # Cap payload size (e.g. base64 images stored as TEXT/VARIANT).
            parts.append(
                f"LEFT(TO_VARCHAR({ident}), {_MAX_CELL_CHARS}) AS {ident}"
            )
        else:
            parts.append(ident)
    if not parts:
        return f"SELECT * FROM {table}"
    return f"SELECT {', '.join(parts)} FROM {table}"


def _http_snowflake(exc: SnowflakeError) -> HTTPException:
    detail = snowflake_error_detail(exc)
    logger.warning("Snowflake error: %s", detail)
    return HTTPException(status_code=502, detail=detail)


@router.post(
    "/databases/{db}/schemas/{schema}/objects/{name}/preview",
    response_model=PreviewResult,
)
def preview_object(
    db: str,
    schema: str,
    name: str,
    body: PreviewRequest,
    cfg: SnowflakeConnection = Depends(get_connection),
) -> PreviewResult:
    table = fqn(db, schema, name)
    where = build_where([(f.column, f.type, f.values) for f in body.filters])
    order = _order_clause(
        body.sort.column if body.sort else None,
        body.sort.direction if body.sort else None,
    )

    # Probe columns without fetching row payloads (avoids loading BINARY blobs).
    try:
        names, types, _ = run_query_typed(cfg, f"SELECT * FROM {table} LIMIT 0")
    except SnowflakeError as exc:
        raise _http_snowflake(exc) from exc

    from_sql = _preview_select_sql(table, names, types)
    count_sql = f"SELECT COUNT(*) AS cnt FROM {table}{where}"
    data_sql = (
        f"{from_sql}"
        f"{where}"
        f"{order} "
        "LIMIT %(limit)s OFFSET %(offset)s"
    )

    total = 0
    try:
        _, count_rows = run_query(cfg, count_sql)
        total = int(count_rows[0][0]) if count_rows else 0
    except SnowflakeError as exc:
        # Still try to return rows if COUNT fails (e.g. broken view stats).
        logger.warning(
            "COUNT failed for %s: %s", table, snowflake_error_detail(exc)
        )
        total = -1

    try:
        out_names, out_types, rows = run_query_typed(
            cfg, data_sql, {"limit": body.limit, "offset": body.offset}
        )
    except SnowflakeError as exc:
        raise _http_snowflake(exc) from exc

    # Prefer probed types (binary stays binary) over stubbed result types.
    type_by_name = dict(zip(names, types, strict=True))
    columns = [
        ColumnInfo(
            name=n,
            type=cast(ColumnType, type_by_name.get(n, out_types[i])),
        )
        for i, n in enumerate(out_names)
    ]
    return PreviewResult(
        columns=columns,
        rows=[[_serialize_cell(cell) for cell in row] for row in rows],
        total=total,
    )


@router.get(
    "/databases/{db}/schemas/{schema}/objects/{name}/facet",
    response_model=FacetResult,
)
def facet_column(
    db: str,
    schema: str,
    name: str,
    column: str = Query(min_length=1),
    col_type: FacetableType = Query(alias="type"),
    q: str = Query(default=""),
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    cfg: SnowflakeConnection = Depends(get_connection),
) -> FacetResult:
    if col_type not in FACETABLE:
        raise HTTPException(status_code=400, detail="Unsupported facet type")

    expr = facet_expr(column, col_type)
    table = fqn(db, schema, name)
    params: dict[str, Any] = {
        "limit": limit + 1,
        "offset": offset,
    }

    where_parts: list[str] = []
    if q.strip():
        where_parts.append(f"CAST({expr} AS VARCHAR) ILIKE %(q)s")
        params["q"] = f"%{q.strip()}%"

    where_sql = f" WHERE {' AND '.join(where_parts)}" if where_parts else ""
    sql = (
        f"SELECT {expr} AS value, COUNT(*) AS cnt "
        f"FROM {table}"
        f"{where_sql} "
        "GROUP BY 1 "
        "ORDER BY cnt DESC, value ASC NULLS LAST "
        "LIMIT %(limit)s OFFSET %(offset)s"
    )

    try:
        _, rows = run_query(cfg, sql, params)
    except SnowflakeError as exc:
        raise _http_snowflake(exc) from exc

    has_more = len(rows) > limit
    page = rows[:limit]
    values: list[FacetValue] = []
    for raw_value, count in page:
        serialized = serialize_facet_value(raw_value)
        values.append(
            FacetValue(
                value=serialized,
                label=_facet_label(serialized),
                count=int(count),
            )
        )

    return FacetResult(
        values=values,
        limit=limit,
        offset=offset,
        has_more=has_more,
    )
