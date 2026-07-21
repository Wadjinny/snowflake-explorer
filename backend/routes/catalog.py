from fastapi import APIRouter, Depends, HTTPException
from snowflake.connector.errors import Error as SnowflakeError

from deps import get_connection
from models import NameItem, ObjectItem, SnowflakeConnection
from snowflake_client import fqn, run_query, snowflake_error_detail

router = APIRouter(prefix="/api", tags=["catalog"])


@router.get("/databases", response_model=list[NameItem])
def list_databases(
    cfg: SnowflakeConnection = Depends(get_connection),
) -> list[NameItem]:
    try:
        _, rows = run_query(cfg, "SHOW DATABASES")
    except SnowflakeError as exc:
        raise HTTPException(
            status_code=502, detail=snowflake_error_detail(exc)
        ) from exc
    # SHOW DATABASES: name is typically column index 1
    names = sorted({str(row[1]) for row in rows if len(row) > 1})
    return [NameItem(name=n) for n in names]


@router.get("/databases/{db}/schemas", response_model=list[NameItem])
def list_schemas(
    db: str,
    cfg: SnowflakeConnection = Depends(get_connection),
) -> list[NameItem]:
    try:
        _, rows = run_query(cfg, f"SHOW SCHEMAS IN DATABASE {fqn(db)}")
    except SnowflakeError as exc:
        raise HTTPException(
            status_code=502, detail=snowflake_error_detail(exc)
        ) from exc
    names = sorted({str(row[1]) for row in rows if len(row) > 1})
    return [NameItem(name=n) for n in names]


@router.get(
    "/databases/{db}/schemas/{schema}/objects",
    response_model=list[ObjectItem],
)
def list_objects(
    db: str,
    schema: str,
    cfg: SnowflakeConnection = Depends(get_connection),
) -> list[ObjectItem]:
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
    return items
