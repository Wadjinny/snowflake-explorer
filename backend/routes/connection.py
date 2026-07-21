from fastapi import APIRouter, Depends, HTTPException
from snowflake.connector.errors import Error as SnowflakeError

from deps import get_connection
from models import OkResponse, SnowflakeConnection
from snowflake_client import run_query, snowflake_error_detail

router = APIRouter(prefix="/api/connection", tags=["connection"])


@router.post("/test", response_model=OkResponse)
def test_connection(
    cfg: SnowflakeConnection = Depends(get_connection),
) -> OkResponse:
    try:
        run_query(cfg, "SELECT 1")
    except SnowflakeError as exc:
        raise HTTPException(
            status_code=502, detail=snowflake_error_detail(exc)
        ) from exc
    return OkResponse()
