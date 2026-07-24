from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from fastapi import HTTPException

from snowflake_client import quote_ident

FACETABLE = frozenset({"string", "number", "boolean", "date", "timestamp"})
PeriodGrain = Literal["year", "month", "week", "day"]

_YEAR_RE = re.compile(r"^\d{4}$")
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_WEEK_RE = re.compile(r"^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def facet_expr(column: str, col_type: str, *, alias: str | None = None) -> str:
    ident = quote_ident(column)
    if alias:
        ident = f"{quote_ident(alias)}.{ident}"
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


def classify_date_token(text: str) -> PeriodGrain:
    if _YEAR_RE.match(text):
        return "year"
    if _MONTH_RE.match(text):
        return "month"
    if _WEEK_RE.match(text):
        return "week"
    if _DATE_RE.match(text):
        return "day"
    raise HTTPException(
        status_code=400,
        detail=(
            "Invalid date filter value "
            f"(expected YYYY, YYYY-MM, YYYY-Www, or YYYY-MM-DD): {text!r}"
        ),
    )


def iso_week_start(year: int, week: int) -> date:
    """Monday of the given ISO week."""
    jan4 = date(year, 1, 4)
    week1_monday = jan4 - timedelta(days=jan4.isoweekday() - 1)
    return week1_monday + timedelta(weeks=week - 1)


def next_month_start(year: int, month: int) -> date:
    if month == 12:
        return date(year + 1, 1, 1)
    return date(year, month + 1, 1)


def period_bounds(token: str) -> tuple[date, date]:
    """Inclusive start, exclusive end for a period token."""
    grain = classify_date_token(token)
    if grain == "year":
        y = int(token)
        return date(y, 1, 1), date(y + 1, 1, 1)
    if grain == "month":
        y, m = int(token[:4]), int(token[5:7])
        return date(y, m, 1), next_month_start(y, m)
    if grain == "week":
        m = _WEEK_RE.match(token)
        assert m is not None
        y, w = int(m.group(1)), int(m.group(2))
        start = iso_week_start(y, w)
        return start, start + timedelta(days=7)
    # day
    y, mo, d = int(token[:4]), int(token[5:7]), int(token[8:10])
    start = date(y, mo, d)
    return start, start + timedelta(days=1)


def _sql_date(d: date) -> str:
    return f"DATE '{d.isoformat()}'"


def period_predicate(expr: str, token: str) -> str:
    start, end = period_bounds(token)
    return f"({expr} >= {_sql_date(start)} AND {expr} < {_sql_date(end)})"


def sql_value_literal(value: object, col_type: str) -> str:
    if col_type == "number":
        try:
            d = Decimal(str(value))
        except (InvalidOperation, ValueError) as exc:
            raise HTTPException(
                status_code=400, detail=f"Invalid number filter value: {value!r}"
            ) from exc
        return format(d, "f")

    if col_type == "boolean":
        if isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        text = str(value).strip().lower()
        if text in ("true", "1"):
            return "TRUE"
        if text in ("false", "0"):
            return "FALSE"
        raise HTTPException(
            status_code=400,
            detail=f"Invalid boolean filter value: {value!r}",
        )

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


def _like_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _ilike_pattern(expr: str, value: object, kind: str) -> str:
    esc = _like_escape(str(value)).replace("'", "''")
    if kind == "has":
        pat = f"%{esc}%"
    elif kind == "startswith":
        pat = f"{esc}%"
    elif kind == "endswith":
        pat = f"%{esc}"
    else:
        raise HTTPException(status_code=400, detail=f"Unknown pattern kind {kind}")
    return f"{expr} ILIKE '{pat}' ESCAPE '\\\\'"


def build_filter_clause(
    column: str,
    col_type: str,
    values: list[Any],
    *,
    alias: str | None = None,
    op: str = "in",
) -> str | None:
    if col_type not in FACETABLE:
        raise HTTPException(
            status_code=400, detail=f"Filtering not supported for type {col_type}"
        )

    expr = facet_expr(column, col_type, alias=alias)

    if op == "is_null":
        return f"{expr} IS NULL"
    if op == "is_not_null":
        return f"{expr} IS NOT NULL"
    if op == "is_empty":
        if col_type != "string":
            raise HTTPException(
                status_code=400, detail="Empty filter only supported for strings"
            )
        return f"{expr} = ''"
    if op == "is_not_empty":
        if col_type != "string":
            raise HTTPException(
                status_code=400,
                detail="Not-empty filter only supported for strings",
            )
        return f"({expr} IS NOT NULL AND {expr} <> '')"
    if op in ("has", "startswith", "endswith"):
        if col_type != "string":
            raise HTTPException(
                status_code=400,
                detail=f"{op} filter only supported for strings",
            )
        patterns = [v for v in values if v is not None and str(v) != ""]
        if not patterns:
            return None
        parts = [_ilike_pattern(expr, v, op) for v in patterns]
        if len(parts) == 1:
            return parts[0]
        return "(" + " OR ".join(parts) + ")"

    if op in ("gt", "lt", "between"):
        if col_type != "number":
            raise HTTPException(
                status_code=400,
                detail=f"{op} filter only supported for numbers",
            )
        if op == "between":
            if len(values) < 2 or values[0] is None or values[1] is None:
                return None
            lo = sql_value_literal(values[0], col_type)
            hi = sql_value_literal(values[1], col_type)
            return f"{expr} BETWEEN {lo} AND {hi}"
        if not values or values[0] is None:
            return None
        lit = sql_value_literal(values[0], col_type)
        if op == "gt":
            return f"{expr} > {lit}"
        return f"{expr} < {lit}"

    # Default: value list (`in`)
    if not values:
        return None

    has_null = any(v is None for v in values)
    non_null = [v for v in values if v is not None]

    parts: list[str] = []
    if non_null:
        if col_type in ("date", "timestamp"):
            days: list[str] = []
            for v in non_null:
                text = str(v)
                grain = classify_date_token(text)
                if grain == "day":
                    days.append(text)
                else:
                    parts.append(period_predicate(expr, text))
            if days:
                literals = ", ".join(sql_value_literal(d, col_type) for d in days)
                parts.append(f"{expr} IN ({literals})")
        else:
            literals = ", ".join(sql_value_literal(v, col_type) for v in non_null)
            parts.append(f"{expr} IN ({literals})")
    if has_null:
        parts.append(f"{expr} IS NULL")

    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return "(" + " OR ".join(parts) + ")"


def build_where(
    filters: list[tuple[str, str, list[Any]] | tuple[str, str, list[Any], str]],
    *,
    aliases: dict[str, str] | None = None,
    default_alias: str = "t0",
) -> str:
    """filters: list of (column, type, values[, op]).

    When *aliases* is provided, each filter column may be ``alias.column``;
    bare columns map via aliases.get(column) or *default_alias*.
    """
    clauses: list[str] = []
    for item in filters:
        if len(item) == 4:
            column, col_type, values, op = item
        else:
            column, col_type, values = item
            op = "in"
        alias: str | None = None
        col = column
        if aliases is not None:
            if "." in column:
                a, _, c = column.partition(".")
                alias, col = a, c
            else:
                alias = aliases.get(column, default_alias)
                col = column
        clause = build_filter_clause(col, col_type, values, alias=alias, op=op)
        if clause:
            clauses.append(clause)
    if not clauses:
        return ""
    return " WHERE " + " AND ".join(clauses)


_MONTH_LABELS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)


def period_label(token: str) -> str:
    grain = classify_date_token(token)
    if grain == "year":
        return token
    if grain == "month":
        m = int(token[5:7])
        return f"{_MONTH_LABELS[m - 1]} {token[:4]}"
    if grain == "week":
        return f"Week {int(token[6:])} · {token[:4]}"
    return token


def build_period_facet_sql(
    table: str,
    expr: str,
    grain: PeriodGrain,
    parent: str | None,
    *,
    clip: str | None = None,
    extra_where: str | None = None,
) -> str:
    """Return SQL selecting (value_token, count) for a period grain."""
    clauses: list[str] = []
    if extra_where:
        clauses.append(f"({extra_where})")

    if grain == "year":
        if parent is not None:
            raise HTTPException(status_code=400, detail="year grain has no parent")
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        return (
            f"SELECT TO_VARCHAR(YEAR({expr})) AS value, COUNT(*) AS cnt "
            f"FROM {table}"
            f"{where} "
            f"GROUP BY YEAR({expr}) "
            f"ORDER BY YEAR({expr}) DESC"
        )

    if grain == "month":
        if parent is None or not _YEAR_RE.match(parent):
            raise HTTPException(
                status_code=400, detail="month grain requires parent YYYY"
            )
        y = int(parent)
        clauses.append(f"YEAR({expr}) = {y}")
        where = f" WHERE {' AND '.join(clauses)}"
        return (
            f"SELECT CONCAT('{y}-', LPAD(TO_VARCHAR(MONTH({expr})), 2, '0')) "
            f"AS value, COUNT(*) AS cnt "
            f"FROM {table}"
            f"{where} "
            f"GROUP BY MONTH({expr}) "
            f"ORDER BY MONTH({expr}) ASC"
        )

    if grain == "week":
        if parent is None or not _MONTH_RE.match(parent):
            raise HTTPException(
                status_code=400, detail="week grain requires parent YYYY-MM"
            )
        y, m = int(parent[:4]), int(parent[5:7])
        start = date(y, m, 1)
        end = next_month_start(y, m)
        clauses.append(f"{expr} >= {_sql_date(start)}")
        clauses.append(f"{expr} < {_sql_date(end)}")
        where = f" WHERE {' AND '.join(clauses)}"
        return (
            f"SELECT CONCAT("
            f"TO_VARCHAR(YEAROFWEEKISO({expr})), '-W', "
            f"LPAD(TO_VARCHAR(WEEKISO({expr})), 2, '0')"
            f") AS value, COUNT(*) AS cnt "
            f"FROM {table}"
            f"{where} "
            f"GROUP BY YEAROFWEEKISO({expr}), WEEKISO({expr}) "
            f"ORDER BY YEAROFWEEKISO({expr}) ASC, WEEKISO({expr}) ASC"
        )

    # day
    if parent is None or not _WEEK_RE.match(parent):
        raise HTTPException(
            status_code=400, detail="day grain requires parent YYYY-Www"
        )
    wm = _WEEK_RE.match(parent)
    assert wm is not None
    wy, ww = int(wm.group(1)), int(wm.group(2))
    w_start = iso_week_start(wy, ww)
    w_end = w_start + timedelta(days=7)
    clauses.append(f"{expr} >= {_sql_date(w_start)}")
    clauses.append(f"{expr} < {_sql_date(w_end)}")
    if clip is not None:
        if not _MONTH_RE.match(clip):
            raise HTTPException(
                status_code=400, detail="clip must be YYYY-MM when provided"
            )
        cy, cm = int(clip[:4]), int(clip[5:7])
        c_start = date(cy, cm, 1)
        c_end = next_month_start(cy, cm)
        clauses.append(f"{expr} >= {_sql_date(c_start)}")
        clauses.append(f"{expr} < {_sql_date(c_end)}")
    where = f" WHERE {' AND '.join(clauses)}"
    return (
        f"SELECT TO_VARCHAR({expr}) AS value, COUNT(*) AS cnt "
        f"FROM {table}"
        f"{where} "
        f"GROUP BY {expr} "
        f"ORDER BY {expr} ASC"
    )
