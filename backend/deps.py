import base64
import json

from fastapi import Header, HTTPException
from pydantic import ValidationError

from models import SnowflakeConnection

HEADER = "X-Snowflake-Connection"


def get_connection(
    x_snowflake_connection: str | None = Header(default=None, alias=HEADER),
) -> SnowflakeConnection:
    if not x_snowflake_connection:
        raise HTTPException(
            status_code=400,
            detail=f"Missing {HEADER} header",
        )
    try:
        raw = base64.urlsafe_b64decode(x_snowflake_connection + "==")
        data = json.loads(raw.decode("utf-8"))
        return SnowflakeConnection.model_validate(data)
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {HEADER} header encoding",
        ) from exc
    except ValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid connection payload: {exc.errors()}",
        ) from exc
