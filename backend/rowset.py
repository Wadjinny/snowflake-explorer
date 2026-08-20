"""Shared row-page helpers for the preview and transform endpoints."""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from typing import Any, TypeVar

import orjson
from fastapi import Response
from pydantic import BaseModel

from query_cache import count_cache

T = TypeVar("T")

MAX_CELL_CHARS = 2_000


def serialize_cell(value: object) -> object:
    """Narrow a Snowflake cell to a JSON primitive.

    This defines the wire format the frontend already renders, so it stays a
    Python pass rather than being handed to orjson: ``Decimal`` becomes a string
    (preserving scale), binary becomes a size stub, and long text is truncated.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"[binary {len(value)} bytes]"
    text = value if isinstance(value, str) else str(value)
    if len(text) > MAX_CELL_CHARS:
        return text[:MAX_CELL_CHARS] + "…"
    return text


def serialize_rows(rows: list[Any]) -> list[list[Any]]:
    return [[serialize_cell(cell) for cell in row] for row in rows]


def json_response(payload: dict[str, Any], model: type[BaseModel]) -> Response:
    """Serialize a row payload with orjson instead of FastAPI's response_model.

    ``response_model`` re-validates the result, runs ``jsonable_encoder`` over
    it and then ``json.dumps`` — three passes over every cell. Measured on a
    1000 x 100 preview that is 133 ms; this is 1 ms for byte-identical output.
    *model* stays the documented schema, and the key check keeps the hand-built
    payload honest if it ever gains a field.
    """
    if payload.keys() != model.model_fields.keys():
        raise RuntimeError(
            f"{model.__name__} declares {sorted(model.model_fields)} "
            f"but payload has {sorted(payload)}"
        )
    return Response(content=orjson.dumps(payload), media_type="application/json")


def fetch_page_with_total(
    *,
    cache_key: str,
    count: Callable[[], int],
    fetch: Callable[[], T],
) -> tuple[T, int]:
    """Fetch a row page and its total, overlapping the two queries.

    A total does not depend on OFFSET, so it is cached under *cache_key* and
    page turns reuse it instead of re-scanning. On a miss the COUNT runs on a
    worker thread while the row page runs on the caller's, making latency
    ``max(count, fetch)`` rather than the sum — which only works because
    ``ConnectionPool`` hands out concurrent sessions.

    A negative total means "unknown"; those are not cached.
    """
    cached = count_cache.get(cache_key)
    if cached is not None:
        return fetch(), int(cached)

    with ThreadPoolExecutor(max_workers=1) as pool:
        counting = pool.submit(count)
        try:
            page = fetch()
        except BaseException:
            # Drain so executor shutdown does not block on a live query, and
            # discard its error: the row query's failure is the one to report.
            with suppress(BaseException):
                counting.result()
            raise
        total = counting.result()

    if total >= 0:
        count_cache.set(cache_key, total)
    return page, total
