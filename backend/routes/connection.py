from fastapi import APIRouter, Depends
from snowflake.connector.errors import Error as SnowflakeError

from deps import get_connection
from errors import snowflake_http_error
from models import OkResponse, SnowflakeConnection
from snowflake_client import run_query

router = APIRouter(prefix="/api/connection", tags=["connection"])


@router.post("/test", response_model=OkResponse)
def test_connection(
    cfg: SnowflakeConnection = Depends(get_connection),
) -> OkResponse:
    try:
        run_query(cfg, "SELECT 1")
    except SnowflakeError as exc:
        raise snowflake_http_error(exc) from exc
    return OkResponse()
