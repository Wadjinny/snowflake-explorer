import logging
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException
from snowflake.connector.errors import Error as SnowflakeError

from deps import get_connection
from filters import (
    FACETABLE,
    build_period_facet_sql,
    build_where,
    facet_expr,
    period_label,
    serialize_facet_value,
)
from models import (
    ColumnInfo,
    ColumnType,
    FacetPeriodRequest,
    FacetPeriodResult,
    FacetRequest,
    FacetResult,
    FacetValue,
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
    if isinstance(value, bool):
        return "true" if value else "false"
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
    where = build_where(
        [(f.column, f.type, f.values, f.op) for f in body.filters]
    )
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


@router.post(
    "/databases/{db}/schemas/{schema}/objects/{name}/facet",
    response_model=FacetResult,
)
def facet_column(
    db: str,
    schema: str,
    name: str,
    body: FacetRequest,
    cfg: SnowflakeConnection = Depends(get_connection),
) -> FacetResult:
    if body.type not in FACETABLE:
        raise HTTPException(status_code=400, detail="Unsupported facet type")

    column = body.column
    col_type = body.type
    expr = facet_expr(column, col_type)
    table = fqn(db, schema, name)
    params: dict[str, Any] = {
        "limit": body.limit + 1,
        "offset": body.offset,
    }

    # Scope by other filters; never apply this column's own filter to its facets.
    other = [
        (f.column, f.type, f.values, f.op)
        for f in body.filters
        if f.column != column
    ]
    clauses: list[str] = []
    filter_where = build_where(other)
    if filter_where:
        clauses.append(filter_where.removeprefix(" WHERE "))
    if body.q.strip():
        clauses.append(f"CAST({expr} AS VARCHAR) ILIKE %(q)s")
        params["q"] = f"%{body.q.strip()}%"

    where_sql = f" WHERE {' AND '.join(clauses)}" if clauses else ""
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

    has_more = len(rows) > body.limit
    page = rows[: body.limit]
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
        limit=body.limit,
        offset=body.offset,
        has_more=has_more,
    )


@router.post(
    "/databases/{db}/schemas/{schema}/objects/{name}/facet-periods",
    response_model=FacetPeriodResult,
)
def facet_periods(
    db: str,
    schema: str,
    name: str,
    body: FacetPeriodRequest,
    cfg: SnowflakeConnection = Depends(get_connection),
) -> FacetPeriodResult:
    if body.type not in ("date", "timestamp"):
        raise HTTPException(
            status_code=400, detail="Period facets only for date/timestamp"
        )

    column = body.column
    if body.grain == "hour" and body.type != "timestamp":
        raise HTTPException(
            status_code=400, detail="hour grain only for timestamp columns"
        )
    expr = facet_expr(column, body.type, grain=body.grain)
    table = fqn(db, schema, name)

    other = [
        (f.column, f.type, f.values, f.op)
        for f in body.filters
        if f.column != column
    ]
    filter_where = build_where(other)
    extra = filter_where.removeprefix(" WHERE ") if filter_where else None
    sql = build_period_facet_sql(
        table,
        expr,
        body.grain,
        body.parent,
        clip=body.clip,
        extra_where=extra,
    )

    try:
        _, rows = run_query(cfg, sql)
    except SnowflakeError as exc:
        raise _http_snowflake(exc) from exc

    values: list[FacetValue] = []
    for raw_value, count in rows:
        serialized = serialize_facet_value(raw_value)
        if serialized is None:
            values.append(
                FacetValue(value=None, label="NULL", count=int(count))
            )
            continue
        token = str(serialized)
        # Day values may include time; normalize to YYYY-MM-DD
        if body.grain == "day" and len(token) >= 10 and token[4] == "-":
            token = token[:10]
        try:
            if body.grain in ("day", "hour"):
                label = period_label(token) if body.grain == "hour" else token
            else:
                label = period_label(token)
        except HTTPException:
            label = token
        values.append(
            FacetValue(value=token, label=label, count=int(count))
        )

    return FacetPeriodResult(
        values=values,
        grain=body.grain,
        parent=body.parent,
    )
