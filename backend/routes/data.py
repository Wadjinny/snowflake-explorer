import hashlib
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from snowflake.connector.errors import Error as SnowflakeError

from columns import (
    ColumnMeta,
    describe_columns,
    invalidate_columns,
    is_account_usage,
)
from deps import get_connection
from errors import snowflake_http_error
from filters import (
    FACETABLE,
    build_period_facet_sql,
    build_where,
    column_ident,
    facet_expr,
    period_label,
    serialize_facet_value,
)
from models import (
    ColumnFilter,
    ColumnInfo,
    CountRequest,
    CountResult,
    FacetPeriodRequest,
    FacetPeriodResult,
    FacetRequest,
    FacetResult,
    FacetValue,
    PreviewRequest,
    PreviewResult,
    SnowflakeConnection,
    SortSpec,
)
from query_cache import count_cache, facet_cache
from rowset import (
    MAX_CELL_CHARS as _MAX_CELL_CHARS,
    fetch_page_with_total,
    json_response,
    serialize_rows,
)
from snowflake_client import (
    credentials_hash,
    fqn,
    is_invalid_identifier_error,
    quote_ident,
    run_query,
    run_query_typed,
    snowflake_error_detail,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["data"])

# Fetch this many facet groups once; serve OFFSET pages from cache.
_FACET_FETCH_CAP = 200
_SAMPLE_PCT = 1.0


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


def _needs_sql_truncate(meta: ColumnMeta) -> bool:
    if meta.type == "semi":
        return True
    if meta.type != "string":
        return False
    # Unknown / max-width VARCHAR may hold huge text (base64, JSON dumps).
    if meta.char_length is None:
        return True
    return meta.char_length > _MAX_CELL_CHARS


def _project_visible_columns(
    meta: list[ColumnMeta], hidden: list[str]
) -> list[ColumnMeta]:
    """Drop hidden columns from the projection; keep at least one column."""
    if not hidden:
        return meta
    hidden_exact = set(hidden)
    hidden_upper = {h.upper() for h in hidden}
    visible = [
        c
        for c in meta
        if c.name not in hidden_exact and c.name.upper() not in hidden_upper
    ]
    return visible if visible else meta


def _preview_select_sql(
    table: str, columns: list[ColumnMeta], *, distinct: bool = False
) -> str:
    """Build a SELECT list that stubs/truncates only heavy columns."""
    parts: list[str] = []
    for meta in columns:
        ident = quote_ident(meta.name)
        if meta.type == "binary":
            parts.append(
                "CONCAT('[binary ', "
                f"COALESCE(TO_VARCHAR(OCTET_LENGTH({ident})), '?'), "
                f"' bytes]') AS {ident}"
            )
        elif meta.type == "geo":
            parts.append(f"TO_VARCHAR({ident}) AS {ident}")
        elif _needs_sql_truncate(meta):
            parts.append(
                f"LEFT(TO_VARCHAR({ident}), {_MAX_CELL_CHARS}) AS {ident}"
            )
        else:
            parts.append(ident)
    keyword = "SELECT DISTINCT" if distinct else "SELECT"
    if not parts:
        return f"{keyword} * FROM {table}"
    return f"{keyword} {', '.join(parts)} FROM {table}"


def _clean_select_sql(
    table: str, columns: list[ColumnMeta], *, distinct: bool = False
) -> str:
    """Copyable SELECT with bare column idents (no preview truncation stubs)."""
    parts = [quote_ident(c.name) for c in columns]
    keyword = "SELECT DISTINCT" if distinct else "SELECT"
    if not parts:
        return f"{keyword} * FROM {table}"
    return f"{keyword} {', '.join(parts)} FROM {table}"


def _approx_count_sql(table: str, where: str) -> str:
    """1% Bernoulli sample, extrapolated. Cheap relative to full COUNT on AU."""
    return (
        f"SELECT CAST(ROUND(COUNT(*) * (100.0 / {_SAMPLE_PCT})) AS INTEGER) "
        f"AS cnt FROM {table} SAMPLE BERNOULLI ({_SAMPLE_PCT}){where}"
    )


def _resolve_total(
    cfg: SnowflakeConnection,
    *,
    table: str,
    from_sql: str,
    where: str,
    distinct: bool,
    heavy: bool,
    exact: bool,
) -> int:
    """Return row total, or -1 when skipped / failed.

    Account Usage filtered/DISTINCT counts are expensive; skip unless ``exact``.
    """
    try:
        if heavy and (where or distinct) and not exact:
            return -1
        if heavy and not exact:
            _, count_rows = run_query(cfg, _approx_count_sql(table, ""))
            return int(count_rows[0][0]) if count_rows else 0
        if distinct:
            count_sql = (
                f"SELECT COUNT(*) AS cnt FROM ({from_sql}{where}) AS _distinct"
            )
            _, count_rows = run_query(cfg, count_sql)
            return int(count_rows[0][0]) if count_rows else 0
        count_sql = f"SELECT COUNT(*) AS cnt FROM {table}{where}"
        _, count_rows = run_query(cfg, count_sql)
        return int(count_rows[0][0]) if count_rows else 0
    except SnowflakeError as exc:
        # Let preview/count retry logic refresh stale column metadata.
        if is_invalid_identifier_error(exc):
            raise
        logger.warning(
            "COUNT failed for %s: %s", table, snowflake_error_detail(exc)
        )
        return -1


def _meta_name_sets(meta: list[ColumnMeta]) -> tuple[set[str], set[str]]:
    names = {c.name for c in meta}
    return names, {n.upper() for n in names}


def _column_in_meta(column: str, names: set[str], names_upper: set[str]) -> bool:
    return column in names or column.upper() in names_upper


def _prune_filters(
    filters: list[ColumnFilter], meta: list[ColumnMeta]
) -> list[ColumnFilter]:
    names, names_upper = _meta_name_sets(meta)
    return [
        f for f in filters if _column_in_meta(f.column, names, names_upper)
    ]


def _prune_sort(sort: SortSpec | None, meta: list[ColumnMeta]) -> SortSpec | None:
    if sort is None:
        return None
    names, names_upper = _meta_name_sets(meta)
    if _column_in_meta(sort.column, names, names_upper):
        return sort
    return None


def _prune_hidden(hidden: list[str], meta: list[ColumnMeta]) -> list[str]:
    names, names_upper = _meta_name_sets(meta)
    return [h for h in hidden if _column_in_meta(h, names, names_upper)]


def _filters_fingerprint(filters: list[Any]) -> str:
    payload = [
        {
            "column": f.column,
            "type": f.type,
            "op": f.op,
            "values": f.values,
        }
        for f in filters
    ]
    raw = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _total_cache_prefix(
    cfg: SnowflakeConnection, db: str, schema: str, name: str
) -> str:
    return (
        f"total:{credentials_hash(cfg)}:"
        f"{db.upper()}:{schema.upper()}:{name.upper()}:"
    )


def _total_cache_key(
    cfg: SnowflakeConnection,
    db: str,
    schema: str,
    name: str,
    *,
    where: str,
    distinct: bool,
    project: list[ColumnMeta],
) -> str:
    """Key a row total by everything it depends on — but not by OFFSET."""
    parts = [where, "1" if distinct else "0"]
    # A DISTINCT count depends on which columns are projected.
    if distinct:
        parts.extend(c.name for c in project)
    digest = hashlib.sha256("\0".join(parts).encode()).hexdigest()[:32]
    return _total_cache_prefix(cfg, db, schema, name) + digest


def invalidate_totals(
    cfg: SnowflakeConnection, db: str, schema: str, name: str
) -> None:
    count_cache.clear_prefix(_total_cache_prefix(cfg, db, schema, name))


def _column_payload(columns: list[ColumnMeta] | list[ColumnInfo]) -> list[dict[str, str]]:
    return [{"name": c.name, "type": c.type} for c in columns]


def _run_preview(
    cfg: SnowflakeConnection,
    *,
    db: str,
    schema: str,
    name: str,
    body: PreviewRequest,
    meta: list[ColumnMeta],
) -> dict[str, Any]:
    table = fqn(db, schema, name)
    filters = _prune_filters(body.filters, meta)
    sort = _prune_sort(body.sort, meta)
    hidden = _prune_hidden(body.hiddenColumns, meta)

    where = build_where([(f.column, f.type, f.values, f.op) for f in filters])
    order = _order_clause(
        sort.column if sort else None,
        sort.direction if sort else None,
    )

    use_subset = bool(body.distinct and hidden)
    project = _project_visible_columns(meta, hidden) if use_subset else meta
    # SELECT DISTINCT requires ORDER BY exprs to appear in the select list.
    if sort and use_subset:
        sort_names = {c.name for c in project}
        sort_upper = {c.name.upper() for c in project}
        if (
            sort.column not in sort_names
            and sort.column.upper() not in sort_upper
        ):
            order = ""

    names = [c.name for c in meta]
    types = [c.type for c in meta]
    from_sql = _preview_select_sql(table, project, distinct=body.distinct)
    data_sql = (
        f"{from_sql}"
        f"{where}"
        f"{order} "
        "LIMIT %(limit)s OFFSET %(offset)s"
    )
    # Clean copyable SQL (same filters/order/limit; bare columns, no stubs).
    # Browse may further project/reorder the SELECT list client-side.
    display_sql = (
        f"{_clean_select_sql(table, project, distinct=body.distinct)}"
        f"{where}"
        f"{order} "
        f"LIMIT {int(body.limit)} OFFSET {int(body.offset)}"
    )

    heavy = is_account_usage(db, schema)
    params = {"limit": body.limit, "offset": body.offset}
    total_key = _total_cache_key(
        cfg,
        db,
        schema,
        name,
        where=where,
        distinct=body.distinct,
        project=project,
    )
    # Filtered / DISTINCT exact COUNT on Account Usage is multi-second;
    # UI shows "?" until the client requests /count.
    (out_names, out_types, rows), total = fetch_page_with_total(
        cache_key=total_key,
        count=lambda: _resolve_total(
            cfg,
            table=table,
            from_sql=from_sql,
            where=where,
            distinct=body.distinct,
            heavy=heavy,
            exact=False,
        ),
        fetch=lambda: run_query_typed(cfg, data_sql, params),
    )

    type_by_name = dict(zip(names, types, strict=True))
    columns = [
        {"name": n, "type": type_by_name.get(n, out_types[i])}
        for i, n in enumerate(out_names)
    ]
    schema_columns = (
        _column_payload(meta)
        if use_subset and len(project) < len(meta)
        else None
    )
    return {
        "columns": columns,
        "rows": serialize_rows(rows),
        "total": total,
        "schemaColumns": schema_columns,
        "sql": display_sql,
    }


@router.post(
    "/databases/{db}/schemas/{schema}/objects/{name}/preview",
    responses={200: {"model": PreviewResult}},
)
def preview_object(
    db: str,
    schema: str,
    name: str,
    body: PreviewRequest,
    cfg: SnowflakeConnection = Depends(get_connection),
) -> Response:
    try:
        meta = describe_columns(cfg, db, schema, name)
    except SnowflakeError as exc:
        raise snowflake_http_error(exc) from exc

    try:
        return json_response(
            _run_preview(
                cfg, db=db, schema=schema, name=name, body=body, meta=meta
            ),
            PreviewResult,
        )
    except SnowflakeError as exc:
        # Stale DESC cache after ALTER/DROP COLUMN → refresh once and retry.
        if not is_invalid_identifier_error(exc):
            raise snowflake_http_error(exc) from exc
        logger.info(
            "Preview invalid identifier for %s.%s.%s; refreshing columns",
            db,
            schema,
            name,
        )
        invalidate_columns(cfg, db, schema, name)
        invalidate_totals(cfg, db, schema, name)
        try:
            meta = describe_columns(cfg, db, schema, name, force=True)
            return json_response(
                _run_preview(
                    cfg, db=db, schema=schema, name=name, body=body, meta=meta
                ),
                PreviewResult,
            )
        except SnowflakeError as retry_exc:
            raise snowflake_http_error(retry_exc) from retry_exc


def _run_count(
    cfg: SnowflakeConnection,
    *,
    db: str,
    schema: str,
    name: str,
    body: CountRequest,
    meta: list[ColumnMeta],
) -> int:
    table = fqn(db, schema, name)
    filters = _prune_filters(body.filters, meta)
    hidden = _prune_hidden(body.hiddenColumns, meta)
    where = build_where([(f.column, f.type, f.values, f.op) for f in filters])
    use_subset = bool(body.distinct and hidden)
    project = _project_visible_columns(meta, hidden) if use_subset else meta
    from_sql = _preview_select_sql(table, project, distinct=body.distinct)
    total = _resolve_total(
        cfg,
        table=table,
        from_sql=from_sql,
        where=where,
        distinct=body.distinct,
        heavy=is_account_usage(db, schema),
        exact=True,
    )
    if total >= 0:
        # Warm the shared cache so the next preview page skips its own COUNT.
        count_cache.set(
            _total_cache_key(
                cfg,
                db,
                schema,
                name,
                where=where,
                distinct=body.distinct,
                project=project,
            ),
            total,
        )
    return total


@router.post(
    "/databases/{db}/schemas/{schema}/objects/{name}/count",
    response_model=CountResult,
)
def count_object(
    db: str,
    schema: str,
    name: str,
    body: CountRequest,
    cfg: SnowflakeConnection = Depends(get_connection),
) -> CountResult:
    """Exact COUNT for the current filters / distinct projection (on demand)."""
    try:
        meta = describe_columns(cfg, db, schema, name)
    except SnowflakeError as exc:
        raise snowflake_http_error(exc) from exc

    try:
        total = _run_count(
            cfg, db=db, schema=schema, name=name, body=body, meta=meta
        )
    except SnowflakeError as exc:
        if not is_invalid_identifier_error(exc):
            raise snowflake_http_error(exc) from exc
        invalidate_columns(cfg, db, schema, name)
        invalidate_totals(cfg, db, schema, name)
        try:
            meta = describe_columns(cfg, db, schema, name, force=True)
            total = _run_count(
                cfg, db=db, schema=schema, name=name, body=body, meta=meta
            )
        except SnowflakeError as retry_exc:
            raise snowflake_http_error(retry_exc) from retry_exc

    if total < 0:
        raise HTTPException(status_code=500, detail="COUNT failed")
    return CountResult(total=total)


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

    other = [
        (f.column, f.type, f.values, f.op)
        for f in body.filters
        if f.column != column
    ]
    clauses: list[str] = []
    filter_where = build_where(other)
    if filter_where:
        clauses.append(filter_where.removeprefix(" WHERE "))

    q = body.q.strip()
    cache_key = (
        f"facet:{credentials_hash(cfg)}:{db.upper()}:{schema.upper()}:"
        f"{name.upper()}:{column}:{col_type}:{q}:"
        f"{_filters_fingerprint([f for f in body.filters if f.column != column])}"
    )

    cached = facet_cache.get(cache_key)
    if cached is None:
        params: dict[str, Any] = {"limit": _FACET_FETCH_CAP + 1}
        if q:
            clauses.append(f"CAST({expr} AS VARCHAR) ILIKE %(q)s")
            params["q"] = f"%{q}%"
        where_sql = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = (
            f"SELECT {expr} AS value, COUNT(*) AS cnt "
            f"FROM {table}"
            f"{where_sql} "
            "GROUP BY 1 "
            "ORDER BY cnt DESC, value ASC NULLS LAST "
            "LIMIT %(limit)s"
        )
        try:
            _, rows = run_query(cfg, sql, params)
        except SnowflakeError as exc:
            raise snowflake_http_error(exc) from exc
        truncated = len(rows) > _FACET_FETCH_CAP
        all_rows = rows[:_FACET_FETCH_CAP]
        cached = {"rows": all_rows, "truncated": truncated}
        facet_cache.set(cache_key, cached)

    all_rows: list[list[Any]] = cached["rows"]
    truncated: bool = cached["truncated"]
    start = body.offset
    end = body.offset + body.limit
    page = all_rows[start:end]
    has_more = end < len(all_rows) or (truncated and end >= len(all_rows))

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
    # WHERE bounds on bare timestamp so pruning is not blocked by CAST(... AS DATE).
    range_expr = (
        column_ident(column) if body.type == "timestamp" else expr
    )
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
        range_expr=range_expr,
    )

    # Each drill level is its own GROUP BY over the table, and the tree re-asks
    # for a level every time a node is re-expanded. Cache under the `facet:`
    # prefix so /catalog/invalidate clears these too.
    cache_key = (
        f"facet:{credentials_hash(cfg)}:period:{db.upper()}:{schema.upper()}:"
        f"{name.upper()}:{column}:{body.type}:{body.grain}:"
        f"{body.parent or ''}:{body.clip or ''}:"
        f"{_filters_fingerprint([f for f in body.filters if f.column != column])}"
    )
    rows = facet_cache.get(cache_key)
    if rows is None:
        try:
            _, rows = run_query(cfg, sql)
        except SnowflakeError as exc:
            raise snowflake_http_error(exc) from exc
        facet_cache.set(cache_key, rows)

    values: list[FacetValue] = []
    for raw_value, count in rows:
        serialized = serialize_facet_value(raw_value)
        if serialized is None:
            values.append(
                FacetValue(value=None, label="NULL", count=int(count))
            )
            continue
        token = str(serialized)
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
