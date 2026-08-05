from fastapi import APIRouter, Depends, HTTPException
from snowflake.connector.errors import Error as SnowflakeError

from columns import invalidate_columns
from deps import get_connection
from models import NameItem, ObjectItem, SchemaItem, SnowflakeConnection
from query_cache import catalog_cache, facet_cache
from snowflake_client import credentials_hash, fqn, run_query, snowflake_error_detail

router = APIRouter(prefix="/api", tags=["catalog"])


def _col_index(columns: list[str], *names: str) -> int:
    lower = {c.lower(): i for i, c in enumerate(columns)}
    for name in names:
        if name.lower() in lower:
            return lower[name.lower()]
    raise KeyError(f"column not found: {names}")


def _cache_key(cfg: SnowflakeConnection, *parts: str) -> str:
    return "cat:" + ":".join((credentials_hash(cfg), *parts))


@router.post("/catalog/invalidate")
def invalidate_catalog(
    cfg: SnowflakeConnection = Depends(get_connection),
) -> dict[str, bool]:
    """Drop cached catalog / column / facet results for this connection."""
    cred = credentials_hash(cfg)
    catalog_cache.clear_prefix(f"cat:{cred}:")
    invalidate_columns(cfg)
    facet_cache.clear_prefix(f"facet:{cred}:")
    return {"ok": True}


@router.get("/databases", response_model=list[NameItem])
def list_databases(
    cfg: SnowflakeConnection = Depends(get_connection),
) -> list[NameItem]:
    key = _cache_key(cfg, "databases")
    cached = catalog_cache.get(key)
    if cached is not None:
        return cached  # type: ignore[no-any-return]

    try:
        columns, rows = run_query(cfg, "SHOW DATABASES")
    except SnowflakeError as exc:
        raise HTTPException(
            status_code=502, detail=snowflake_error_detail(exc)
        ) from exc
    try:
        name_i = _col_index(columns, "name")
    except KeyError:
        name_i = 1
    names = sorted(
        {str(row[name_i]) for row in rows if len(row) > name_i}
    )
    items = [NameItem(name=n) for n in names]
    catalog_cache.set(key, items)
    return items


@router.get("/schemas", response_model=list[SchemaItem])
def list_all_schemas(
    cfg: SnowflakeConnection = Depends(get_connection),
) -> list[SchemaItem]:
    """All schemas visible in the account (one SHOW; group by database client-side)."""
    key = _cache_key(cfg, "schemas")
    cached = catalog_cache.get(key)
    if cached is not None:
        return cached  # type: ignore[no-any-return]

    try:
        columns, rows = run_query(cfg, "SHOW TERSE SCHEMAS IN ACCOUNT")
    except SnowflakeError as exc:
        raise HTTPException(
            status_code=502, detail=snowflake_error_detail(exc)
        ) from exc
    try:
        name_i = _col_index(columns, "name")
        db_i = _col_index(columns, "database_name")
    except KeyError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unexpected SHOW SCHEMAS columns: {columns}",
        ) from exc

    seen: set[tuple[str, str]] = set()
    items: list[SchemaItem] = []
    for row in rows:
        if len(row) <= max(name_i, db_i):
            continue
        database = str(row[db_i])
        name = str(row[name_i])
        pair = (database, name)
        if pair in seen:
            continue
        seen.add(pair)
        items.append(SchemaItem(database=database, name=name))
    items.sort(key=lambda s: (s.database, s.name))
    catalog_cache.set(key, items)
    return items


@router.get("/databases/{db}/schemas", response_model=list[NameItem])
def list_schemas(
    db: str,
    cfg: SnowflakeConnection = Depends(get_connection),
) -> list[NameItem]:
    key = _cache_key(cfg, "db-schemas", db.upper())
    cached = catalog_cache.get(key)
    if cached is not None:
        return cached  # type: ignore[no-any-return]

    try:
        columns, rows = run_query(cfg, f"SHOW SCHEMAS IN DATABASE {fqn(db)}")
    except SnowflakeError as exc:
        raise HTTPException(
            status_code=502, detail=snowflake_error_detail(exc)
        ) from exc
    try:
        name_i = _col_index(columns, "name")
    except KeyError:
        name_i = 1
    names = sorted(
        {str(row[name_i]) for row in rows if len(row) > name_i}
    )
    items = [NameItem(name=n) for n in names]
    catalog_cache.set(key, items)
    return items


@router.get(
    "/databases/{db}/schemas/{schema}/objects",
    response_model=list[ObjectItem],
)
def list_objects(
    db: str,
    schema: str,
    cfg: SnowflakeConnection = Depends(get_connection),
) -> list[ObjectItem]:
    key = _cache_key(cfg, "objects", db.upper(), schema.upper())
    cached = catalog_cache.get(key)
    if cached is not None:
        return cached  # type: ignore[no-any-return]

    sql = f"""
        SELECT TABLE_NAME, TABLE_TYPE, ROW_COUNT
        FROM {fqn(db)}.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = %(schema)s
          AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
        ORDER BY TABLE_NAME
    """
    try:
        _, rows = run_query(cfg, sql, {"schema": schema})
    except SnowflakeError as exc:
        raise HTTPException(
            status_code=502, detail=snowflake_error_detail(exc)
        ) from exc

    items: list[ObjectItem] = []
    for name, table_type, row_count in rows:
        kind = "view" if str(table_type).upper() == "VIEW" else "table"
        count: int | None = None
        if kind == "table" and row_count is not None:
            try:
                count = int(row_count)
            except (TypeError, ValueError):
                count = None
        items.append(ObjectItem(name=str(name), kind=kind, row_count=count))
    catalog_cache.set(key, items)
    return items
