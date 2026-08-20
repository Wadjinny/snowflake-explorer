"""Process-local TTL caches for catalog / column / facet query results."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, TypeVar

T = TypeVar("T")

COLUMN_CACHE_TTL = 30 * 60
CATALOG_CACHE_TTL = 30 * 60
FACET_CACHE_TTL = 5 * 60
# Row totals are independent of OFFSET, so paging reuses one COUNT. Kept well
# inside the client-side preview staleTime, so a cached total is never older
# than the rows it describes.
COUNT_CACHE_TTL = 5 * 60


@dataclass
class _Entry:
    value: Any
    expires_at: float


class TtlCache:
    def __init__(self, ttl_seconds: float) -> None:
        self._ttl = ttl_seconds
        self._guard = threading.Lock()
        self._entries: dict[str, _Entry] = {}

    def get(self, key: str) -> Any | None:
        now = time.monotonic()
        with self._guard:
            entry = self._entries.get(key)
            if entry is None:
                return None
            if entry.expires_at <= now:
                del self._entries[key]
                return None
            return entry.value

    def set(self, key: str, value: Any) -> None:
        with self._guard:
            self._entries[key] = _Entry(
                value=value,
                expires_at=time.monotonic() + self._ttl,
            )

    def delete(self, key: str) -> None:
        with self._guard:
            self._entries.pop(key, None)

    def clear(self) -> None:
        with self._guard:
            self._entries.clear()

    def clear_prefix(self, prefix: str) -> None:
        with self._guard:
            doomed = [k for k in self._entries if k.startswith(prefix)]
            for k in doomed:
                del self._entries[k]


column_cache = TtlCache(COLUMN_CACHE_TTL)
catalog_cache = TtlCache(CATALOG_CACHE_TTL)
facet_cache = TtlCache(FACET_CACHE_TTL)
count_cache = TtlCache(COUNT_CACHE_TTL)
