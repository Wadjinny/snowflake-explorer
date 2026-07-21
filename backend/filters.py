from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException

from snowflake_client import quote_ident

FACETABLE = frozenset({"string", "number", "date", "timestamp"})
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def facet_expr(column: str, col_type: str) -> str:
    ident = quote_ident(column)
    if col_type == "timestamp":
        return f"CAST({ident} AS DATE)"
    return ident


def serialize_facet_value(value: object) -> object:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float, Decimal)):
        if isinstance(value, float) and (value != value):  # NaN
            return str(value)
        if isinstance(value, Decimal):
            if value == value.to_integral_value():
                return int(value)
            return float(value)
        return value
    # date/datetime → ISO date or string
    iso = getattr(value, "isoformat", None)
    if callable(iso):
        text = iso()
        return text[:10] if len(text) >= 10 and text[4] == "-" else text
    return str(value)


def sql_value_literal(value: object, col_type: str) -> str:
    if col_type == "number":
        try:
            d = Decimal(str(value))
        except (InvalidOperation, ValueError) as exc:
            raise HTTPException(
                status_code=400, detail=f"Invalid number filter value: {value!r}"
            ) from exc
        return format(d, "f")

    if col_type in ("date", "timestamp"):
        text = str(value)
        if not _DATE_RE.match(text):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid date filter value (expected YYYY-MM-DD): {value!r}",
            )
        return f"DATE '{text}'"

    # string
    text = str(value).replace("'", "''")
    return f"'{text}'"


def build_filter_clause(column: str, col_type: str, values: list[Any]) -> str | None:
    if col_type not in FACETABLE:
        raise HTTPException(
            status_code=400, detail=f"Filtering not supported for type {col_type}"
        )
    if not values:
        return None

    expr = facet_expr(column, col_type)
    has_null = any(v is None for v in values)
    non_null = [v for v in values if v is not None]

    parts: list[str] = []
    if non_null:
        literals = ", ".join(sql_value_literal(v, col_type) for v in non_null)
        parts.append(f"{expr} IN ({literals})")
    if has_null:
        parts.append(f"{expr} IS NULL")

    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return "(" + " OR ".join(parts) + ")"


def build_where(filters: list[tuple[str, str, list[Any]]]) -> str:
    """filters: list of (column, type, values)."""
    clauses: list[str] = []
    for column, col_type, values in filters:
        clause = build_filter_clause(column, col_type, values)
        if clause:
            clauses.append(clause)
    if not clauses:
        return ""
    return " WHERE " + " AND ".join(clauses)
