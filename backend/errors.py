import logging

from fastapi import HTTPException
from snowflake.connector.errors import Error as SnowflakeError

from snowflake_client import is_sql_compilation_error, snowflake_error_detail

logger = logging.getLogger(__name__)


def is_connection_error(exc: SnowflakeError) -> bool:
    """True when Snowflake refused or never opened the session.

    Bad password, invalid/revoked programmatic access token, blocked IP or an
    unreachable account all surface as SQLSTATE class 08 (errno 250001).
    """
    sqlstate = getattr(exc, "sqlstate", None) or ""
    return sqlstate.startswith("08") or getattr(exc, "errno", None) == 250001


def snowflake_http_error(exc: SnowflakeError) -> HTTPException:
    """Map a Snowflake error to an HTTPException that keeps its detail visible.

    Never 502/504: Cloudflare replaces those origin responses with its own HTML
    page, so the browser would lose the JSON ``detail``.
    """
    detail = snowflake_error_detail(exc)
    logger.warning("Snowflake error: %s", detail)
    if is_connection_error(exc):
        status = 401
    elif is_sql_compilation_error(exc):
        status = 400
    else:
        status = 500
    return HTTPException(status_code=status, detail=detail)
