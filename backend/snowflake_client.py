from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import snowflake.connector
from snowflake.connector.errors import Error as SnowflakeError, ProgrammingError

from models import SnowflakeConnection

Params = Sequence[Any] | Mapping[str, Any] | None

# Reuse a live Snowflake session for this long after first open.
POOL_TTL_SECONDS = 2 * 60 * 60

# Named pyformat placeholders: %(limit)s — leave these alone when escaping.
_PYFORMAT_PLACEHOLDER = re.compile(r"%\([^)]+\)s")


def _escape_pyformat_literals(sql: str) -> str:
    """Escape bare % so LIKE '%x%' survives dict pyformat binding.

    The connector does ``sql % params`` for Mapping params. Literal percent
    signs in the SQL (ILIKE wildcards, etc.) must be written as ``%%``.
    """
    parts: list[str] = []
    last = 0
    for match in _PYFORMAT_PLACEHOLDER.finditer(sql):
        parts.append(sql[last : match.start()].replace("%", "%%"))
        parts.append(match.group(0))
        last = match.end()
    parts.append(sql[last:].replace("%", "%%"))
    return "".join(parts)


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def fqn(*parts: str) -> str:
    return ".".join(quote_ident(p) for p in parts)


def credentials_hash(cfg: SnowflakeConnection) -> str:
    payload = {
        "account": cfg.account,
        "user": cfg.user,
        "password": cfg.password,
        "warehouse": cfg.warehouse,
        "role": cfg.role or "",
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _open_connection(cfg: SnowflakeConnection) -> Any:
    kwargs: dict[str, Any] = {
        "account": cfg.account,
        "user": cfg.user,
        "password": cfg.password,
        "warehouse": cfg.warehouse,
    }
    if cfg.role:
        kwargs["role"] = cfg.role
    return snowflake.connector.connect(**kwargs)


@dataclass
class _CachedConn:
    conn: Any
    created_at: float
    lock: threading.RLock


class ConnectionPool:
    """In-memory Snowflake connection cache keyed by hash(credentials)."""

    def __init__(self, ttl_seconds: float = POOL_TTL_SECONDS) -> None:
        self._ttl = ttl_seconds
        self._guard = threading.Lock()
        self._entries: dict[str, _CachedConn] = {}

    def _expired(self, entry: _CachedConn, now: float) -> bool:
        return (now - entry.created_at) >= self._ttl

    def _close_quiet(self, conn: Any) -> None:
        try:
            conn.close()
        except Exception:
            pass

    def _get_or_create(self, cfg: SnowflakeConnection) -> _CachedConn:
        key = credentials_hash(cfg)
        now = time.monotonic()
        with self._guard:
            entry = self._entries.get(key)
            if entry is not None and not self._expired(entry, now):
                return entry
            if entry is not None:
                self._close_quiet(entry.conn)
                del self._entries[key]

        conn = _open_connection(cfg)
        new_entry = _CachedConn(conn=conn, created_at=time.monotonic(), lock=threading.RLock())
        with self._guard:
            # Another thread may have created one while we connected.
            existing = self._entries.get(key)
            if existing is not None and not self._expired(existing, time.monotonic()):
                self._close_quiet(conn)
                return existing
            if existing is not None:
                self._close_quiet(existing.conn)
            self._entries[key] = new_entry
            return new_entry

    def invalidate(self, cfg: SnowflakeConnection) -> None:
        key = credentials_hash(cfg)
        with self._guard:
            entry = self._entries.pop(key, None)
        if entry is not None:
            self._close_quiet(entry.conn)

    @contextmanager
    def connection(self, cfg: SnowflakeConnection) -> Iterator[Any]:
        while True:
            entry = self._get_or_create(cfg)
            with entry.lock:
                if self._expired(entry, time.monotonic()):
                    key = credentials_hash(cfg)
                    with self._guard:
                        if self._entries.get(key) is entry:
                            del self._entries[key]
                            self._close_quiet(entry.conn)
                    continue
                yield entry.conn
                return

    def close_all(self) -> None:
        with self._guard:
            entries = list(self._entries.values())
            self._entries.clear()
        for entry in entries:
            self._close_quiet(entry.conn)


pool = ConnectionPool()


@contextmanager
def connect(cfg: SnowflakeConnection) -> Iterator[Any]:
    with pool.connection(cfg) as conn:
        yield conn


# Snowflake FIELD_ID buckets → UI-friendly type tags
_TYPE_BUCKETS: dict[int, str] = {
    0: "number",  # FIXED
    1: "number",  # REAL
    2: "string",  # TEXT
    3: "date",
    4: "timestamp",
    5: "semi",  # VARIANT
    6: "timestamp",  # TIMESTAMP_LTZ
    7: "timestamp",  # TIMESTAMP_TZ
    8: "timestamp",  # TIMESTAMP_NTZ
    9: "semi",  # OBJECT
    10: "semi",  # ARRAY
    11: "binary",
    12: "time",
    13: "boolean",
    14: "geo",
    15: "geo",
    16: "number",  # VECTOR
    17: "semi",  # MAP
    18: "string",  # FILE
    19: "string",  # INTERVAL_YEAR_MONTH
    20: "string",  # INTERVAL_DAY_TIME
}


def map_field_type(type_code: int | None) -> str:
    if type_code is None:
        return "other"
    return _TYPE_BUCKETS.get(int(type_code), "other")


def run_query(
    cfg: SnowflakeConnection, sql: str, params: Params = None
) -> tuple[list[str], list[list[Any]]]:
    columns, _types, rows = _run_query_once(cfg, sql, params, retry=True)
    return columns, rows


def run_query_typed(
    cfg: SnowflakeConnection, sql: str, params: Params = None
) -> tuple[list[str], list[str], list[list[Any]]]:
    return _run_query_once(cfg, sql, params, retry=True)


def _run_query_once(
    cfg: SnowflakeConnection,
    sql: str,
    params: Params,
    *,
    retry: bool,
) -> tuple[list[str], list[str], list[list[Any]]]:
    try:
        with connect(cfg) as conn:
            cur = conn.cursor()
            try:
                if params is None:
                    cur.execute(sql)
                else:
                    # Dict params use pyformat; escape literal % (e.g. LIKE).
                    bound_sql = (
                        _escape_pyformat_literals(sql)
                        if isinstance(params, Mapping)
                        else sql
                    )
                    cur.execute(bound_sql, params)
                if cur.description:
                    columns = [desc[0] for desc in cur.description]
                    types = [map_field_type(desc[1]) for desc in cur.description]
                else:
                    columns, types = [], []
                rows = [list(row) for row in cur.fetchall()]
                return columns, types, rows
            finally:
                cur.close()
    except SnowflakeError as exc:
        if not retry:
            raise
        # Compilation / identifier errors are not session death; re-raise.
        if is_sql_compilation_error(exc):
            raise
        # Session may have been closed server-side; drop cache and retry once.
        pool.invalidate(cfg)
        return _run_query_once(cfg, sql, params, retry=False)


def snowflake_error_detail(exc: SnowflakeError) -> str:
    msg = str(exc).strip() or exc.__class__.__name__
    return msg


def is_sql_compilation_error(exc: SnowflakeError) -> bool:
    """True for client/schema SQL errors (invalid identifier, missing object)."""
    errno = getattr(exc, "errno", None)
    # 904 invalid identifier; 2003 object does not exist.
    if errno in {904, 2003}:
        return True
    msg = str(exc).lower()
    return (
        "sql compilation error" in msg
        or "invalid identifier" in msg
        or "does not exist or not authorized" in msg
    )


def is_invalid_identifier_error(exc: SnowflakeError) -> bool:
    errno = getattr(exc, "errno", None)
    if errno == 904:
        return True
    return "invalid identifier" in str(exc).lower()


# Re-export for callers that want to narrow exception types.
__all__ = [
    "ProgrammingError",
    "connect",
    "credentials_hash",
    "fqn",
    "is_invalid_identifier_error",
    "is_sql_compilation_error",
    "pool",
    "quote_ident",
    "run_query",
    "run_query_typed",
    "map_field_type",
    "snowflake_error_detail",
    "POOL_TTL_SECONDS",
]
