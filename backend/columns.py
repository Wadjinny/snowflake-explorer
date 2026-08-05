"""Column metadata via DESC TABLE (cheaper than SELECT * LIMIT 0 on heavy views)."""

from __future__ import annotations

import re
from typing import NamedTuple

from snowflake.connector.errors import Error as SnowflakeError

from models import SnowflakeConnection
from query_cache import column_cache
from snowflake_client import credentials_hash, fqn, run_query, run_query_typed

# Snowflake max VARCHAR width; treat as "unbounded" for preview truncation.
_MAX_VARCHAR = 16_777_216

_VARCHAR_RE = re.compile(
    r"^(?:VARCHAR|TEXT|CHAR|CHARACTER|STRING|NVARCHAR)\s*(?:\((\d+)\))?",
    re.IGNORECASE,
)
_NUMBER_RE = re.compile(
    r"^(?:NUMBER|DECIMAL|NUMERIC|INT|INTEGER|BIGINT|SMALLINT|"
    r"TINYINT|BYTEINT|FLOAT|FLOAT4|FLOAT8|DOUBLE|REAL)\b",
    re.IGNORECASE,
)
_TS_RE = re.compile(r"^TIMESTAMP", re.IGNORECASE)
_TIME_RE = re.compile(r"^TIME\b", re.IGNORECASE)
_DATE_RE = re.compile(r"^DATE\b", re.IGNORECASE)
_BOOL_RE = re.compile(r"^BOOLEAN\b", re.IGNORECASE)
_BINARY_RE = re.compile(r"^(?:BINARY|VARBINARY)\b", re.IGNORECASE)
_SEMI_RE = re.compile(r"^(?:VARIANT|OBJECT|ARRAY|MAP)\b", re.IGNORECASE)
_GEO_RE = re.compile(r"^(?:GEOGRAPHY|GEOMETRY)\b", re.IGNORECASE)
_VECTOR_RE = re.compile(r"^VECTOR\b", re.IGNORECASE)


class ColumnMeta(NamedTuple):
    name: str
    type: str
    # Character length for string types; None if unknown / unbounded.
    char_length: int | None


def map_desc_type(type_str: str) -> tuple[str, int | None]:
    text = type_str.strip()
    m = _VARCHAR_RE.match(text)
    if m:
        length = int(m.group(1)) if m.group(1) else None
        if length == _MAX_VARCHAR:
            length = None
        return "string", length
    if _NUMBER_RE.match(text) or _VECTOR_RE.match(text):
        return "number", None
    if _TS_RE.match(text):
        return "timestamp", None
    if _DATE_RE.match(text):
        return "date", None
    if _TIME_RE.match(text):
        return "time", None
    if _BOOL_RE.match(text):
        return "boolean", None
    if _BINARY_RE.match(text):
        return "binary", None
    if _SEMI_RE.match(text):
        return "semi", None
    if _GEO_RE.match(text):
        return "geo", None
    return "other", None


def _parse_desc_rows(
    columns: list[str], rows: list[list[object]]
) -> list[ColumnMeta]:
    lower = {c.lower(): i for i, c in enumerate(columns)}
    name_i = lower.get("name", 0)
    type_i = lower.get("type", 1)
    out: list[ColumnMeta] = []
    for row in rows:
        if len(row) <= max(name_i, type_i):
            continue
        name = str(row[name_i])
        typ, length = map_desc_type(str(row[type_i]))
        out.append(ColumnMeta(name=name, type=typ, char_length=length))
    return out


def _fallback_limit0(
    cfg: SnowflakeConnection, table: str
) -> list[ColumnMeta]:
    names, types, _ = run_query_typed(cfg, f"SELECT * FROM {table} LIMIT 0")
    return [
        ColumnMeta(name=n, type=t, char_length=None)
        for n, t in zip(names, types, strict=True)
    ]


def column_cache_key(
    cfg: SnowflakeConnection, db: str, schema: str, name: str
) -> str:
    return (
        f"cols:{credentials_hash(cfg)}:"
        f"{db.upper()}:{schema.upper()}:{name.upper()}"
    )


def invalidate_columns(
    cfg: SnowflakeConnection,
    db: str | None = None,
    schema: str | None = None,
    name: str | None = None,
) -> None:
    """Drop cached DESC results for one object or the whole connection."""
    if db is not None and schema is not None and name is not None:
        column_cache.delete(column_cache_key(cfg, db, schema, name))
        return
    column_cache.clear_prefix(f"cols:{credentials_hash(cfg)}:")


def describe_columns(
    cfg: SnowflakeConnection,
    db: str,
    schema: str,
    name: str,
    *,
    force: bool = False,
) -> list[ColumnMeta]:
    """Return column metadata, preferring DESC TABLE and caching per session."""
    cache_key = column_cache_key(cfg, db, schema, name)
    if not force:
        cached = column_cache.get(cache_key)
        if cached is not None:
            return cached  # type: ignore[no-any-return]

    table = fqn(db, schema, name)
    try:
        columns, rows = run_query(cfg, f"DESC TABLE {table}")
        meta = _parse_desc_rows(columns, rows)
        if not meta:
            meta = _fallback_limit0(cfg, table)
    except SnowflakeError:
        meta = _fallback_limit0(cfg, table)

    column_cache.set(cache_key, meta)
    return meta


def is_account_usage(db: str, schema: str) -> bool:
    return db.upper() == "SNOWFLAKE" and schema.upper() in {
        "ACCOUNT_USAGE",
        "ORGANIZATION_USAGE",
        "READER_ACCOUNT_USAGE",
    }
