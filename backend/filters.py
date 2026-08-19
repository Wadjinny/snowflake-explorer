from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from fastapi import HTTPException

from snowflake_client import quote_ident

FACETABLE = frozenset({"string", "number", "boolean", "date", "timestamp"})
PeriodGrain = Literal["year", "month", "week", "day", "hour"]

_YEAR_RE = re.compile(r"^\d{4}$")
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_WEEK_RE = re.compile(r"^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_HOUR_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3])$")

RELATIVE_OPS = frozenset(
    {
        "this_hour",
        "this_day",
        "this_week",
        "this_month",
        "this_year",
        "last_hour",
        "last_day",
        "last_week",
        "last_month",
        "last_year",
    }
)


def column_ident(column: str, *, alias: str | None = None) -> str:
    ident = quote_ident(column)
    if alias:
        return f"{quote_ident(alias)}.{ident}"
    return ident


def facet_expr(
    column: str,
    col_type: str,
    *,
    alias: str | None = None,
    grain: str | None = None,
) -> str:
    ident = column_ident(column, alias=alias)
    # Hour facets need the raw timestamp; coarser grains use calendar date.
    if col_type == "timestamp" and grain != "hour":
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
    if _HOUR_RE.match(text):
        return "hour"
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
            "(expected YYYY, YYYY-MM, YYYY-Www, YYYY-MM-DD, or YYYY-MM-DDTHH): "
            f"{text!r}"
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


def period_bounds(token: str) -> tuple[datetime, datetime]:
    """Inclusive start, exclusive end for a period token."""
    grain = classify_date_token(token)
    if grain == "hour":
        m = _HOUR_RE.match(token)
        assert m is not None
        y, mo, d, h = (
            int(m.group(1)),
            int(m.group(2)),
            int(m.group(3)),
            int(m.group(4)),
        )
        start = datetime(y, mo, d, h)
        return start, start + timedelta(hours=1)
    if grain == "year":
        y = int(token)
        return datetime(y, 1, 1), datetime(y + 1, 1, 1)
    if grain == "month":
        y, m = int(token[:4]), int(token[5:7])
        end_d = next_month_start(y, m)
        return datetime(y, m, 1), datetime(end_d.year, end_d.month, end_d.day)
    if grain == "week":
        m = _WEEK_RE.match(token)
        assert m is not None
        y, w = int(m.group(1)), int(m.group(2))
        start_d = iso_week_start(y, w)
        end_d = start_d + timedelta(days=7)
        return (
            datetime(start_d.year, start_d.month, start_d.day),
            datetime(end_d.year, end_d.month, end_d.day),
        )
    # day
    y, mo, d = int(token[:4]), int(token[5:7]), int(token[8:10])
    start = datetime(y, mo, d)
    return start, start + timedelta(days=1)


def _sql_date(d: date) -> str:
    return f"DATE '{d.isoformat()}'"


def _sql_ts(dt: datetime) -> str:
    return f"TIMESTAMP '{dt.strftime('%Y-%m-%d %H:%M:%S')}'"


def period_predicate(
    expr: str, token: str, *, col_type: str = "date"
) -> str:
    start, end = period_bounds(token)
    grain = classify_date_token(token)
    if grain == "hour" and col_type != "timestamp":
        raise HTTPException(
            status_code=400,
            detail="hour filter only supported for timestamps",
        )
    if col_type == "timestamp":
        return f"({expr} >= {_sql_ts(start)} AND {expr} < {_sql_ts(end)})"
    return (
        f"({expr} >= {_sql_date(start.date())} "
        f"AND {expr} < {_sql_date(end.date())})"
    )


def relative_predicate(expr: str, op: str, col_type: str) -> str:
    if op not in RELATIVE_OPS:
        raise HTTPException(status_code=400, detail=f"Unknown relative op {op}")
    if op in ("this_hour", "last_hour") and col_type != "timestamp":
        raise HTTPException(
            status_code=400,
            detail=f"{op} only supported for timestamps",
        )

    if col_type == "timestamp":
        cur = "CURRENT_TIMESTAMP()"

        def trunc(unit: str) -> str:
            return f"DATE_TRUNC('{unit}', {cur})"

        def add(unit: str, n: int, base: str) -> str:
            return f"DATEADD({unit}, {n}, {base})"

        ranges = {
            "this_hour": (trunc("hour"), add("hour", 1, trunc("hour"))),
            "last_hour": (add("hour", -1, trunc("hour")), trunc("hour")),
            "this_day": (trunc("day"), add("day", 1, trunc("day"))),
            "last_day": (add("day", -1, trunc("day")), trunc("day")),
            "this_week": (trunc("week"), add("week", 1, trunc("week"))),
            "last_week": (add("week", -1, trunc("week")), trunc("week")),
            "this_month": (trunc("month"), add("month", 1, trunc("month"))),
            "last_month": (add("month", -1, trunc("month")), trunc("month")),
            "this_year": (trunc("year"), add("year", 1, trunc("year"))),
            "last_year": (add("year", -1, trunc("year")), trunc("year")),
        }
    else:
        cur = "CURRENT_DATE()"

        def trunc(unit: str) -> str:
            if unit == "day":
                return cur
            return f"DATE_TRUNC('{unit}', {cur})"

        def add(unit: str, n: int, base: str) -> str:
            return f"DATEADD({unit}, {n}, {base})"

        ranges = {
            "this_day": (trunc("day"), add("day", 1, trunc("day"))),
            "last_day": (add("day", -1, trunc("day")), trunc("day")),
            "this_week": (trunc("week"), add("week", 1, trunc("week"))),
            "last_week": (add("week", -1, trunc("week")), trunc("week")),
            "this_month": (trunc("month"), add("month", 1, trunc("month"))),
            "last_month": (add("month", -1, trunc("month")), trunc("month")),
            "this_year": (trunc("year"), add("year", 1, trunc("year"))),
            "last_year": (add("year", -1, trunc("year")), trunc("year")),
        }

    start, end = ranges[op]
    return f"({expr} >= {start} AND {expr} < {end})"


def sql_string_literal(text: str) -> str:
    """Quote *text* as a Snowflake string literal.

    Snowflake honours backslash escapes inside single-quoted literals, so a
    bare backslash must be doubled too: escaping only quotes would let a
    trailing ``\\`` swallow the closing quote and break out into SQL.
    """
    escaped = text.replace("\\", "\\\\").replace("'", "''")
    return f"'{escaped}'"


# Snowflake tops out at NUMBER(38,37), so a plain-digit literal never needs
# more than ~40 characters. Rendering an unbounded exponent instead is a
# memory-exhaustion lever: format(Decimal("1E+900000000"), "f") is ~900 MB.
_MAX_NUMBER_LITERAL_CHARS = 64


def _plain_digit_width(d: Decimal) -> int:
    """Width of ``format(d, "f")`` without building the (possibly huge) string."""
    _sign, digits, exponent = d.as_tuple()
    exp = int(exponent)
    if exp >= 0:
        return len(digits) + exp
    return max(len(digits), -exp) + 1


def sql_value_literal(value: object, col_type: str) -> str:
    if col_type == "number":
        try:
            d = Decimal(str(value))
        except (InvalidOperation, ValueError) as exc:
            raise HTTPException(
                status_code=400, detail=f"Invalid number filter value: {value!r}"
            ) from exc
        if not d.is_finite():
            raise HTTPException(
                status_code=400,
                detail=f"Invalid number filter value: {value!r}",
            )
        if _plain_digit_width(d) > _MAX_NUMBER_LITERAL_CHARS:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Number filter value out of range "
                    f"(over {_MAX_NUMBER_LITERAL_CHARS} digits): {value!r}"
                ),
            )
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
    return sql_string_literal(str(value))


_LIKE_ESCAPE_CHAR = "\\"


def _like_escape(text: str) -> str:
    """Escape LIKE metacharacters; the literal layer re-escapes backslashes."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _ilike_pattern(expr: str, value: object, kind: str) -> str:
    esc = _like_escape(str(value))
    if kind == "has":
        pat = f"%{esc}%"
    elif kind == "startswith":
        pat = f"{esc}%"
    elif kind == "endswith":
        pat = f"%{esc}"
    else:
        raise HTTPException(status_code=400, detail=f"Unknown pattern kind {kind}")
    return (
        f"{expr} ILIKE {sql_string_literal(pat)} "
        f"ESCAPE {sql_string_literal(_LIKE_ESCAPE_CHAR)}"
    )


def _as_filter_value(value: object, col_type: str) -> object | None:
    """Normalize facet/filter payloads; map stray null labels back to None."""
    if value is None:
        return None
    if col_type in ("date", "timestamp") and isinstance(value, str):
        text = value.strip()
        if text == "" or text.lower() in ("none", "null"):
            return None
    return value


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
    ident = column_ident(column, alias=alias)

    if op in RELATIVE_OPS:
        target = ident if col_type == "timestamp" else expr
        return relative_predicate(target, op, col_type)

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

    normalized = [_as_filter_value(v, col_type) for v in values]
    has_null = any(v is None for v in normalized)
    non_null = [v for v in normalized if v is not None]

    parts: list[str] = []
    if non_null:
        if col_type == "timestamp":
            for v in non_null:
                parts.append(
                    period_predicate(ident, str(v), col_type="timestamp")
                )
        elif col_type == "date":
            for v in non_null:
                text = str(v)
                # Prefer half-open ranges so planners can prune; avoid CAST wraps.
                parts.append(period_predicate(expr, text, col_type="date"))
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
    if grain == "hour":
        return f"{token[11:13]}:00"
    return token


def build_period_facet_sql(
    table: str,
    expr: str,
    grain: PeriodGrain,
    parent: str | None,
    *,
    clip: str | None = None,
    extra_where: str | None = None,
    range_expr: str | None = None,
) -> str:
    """Return SQL selecting (value_token, count) for a period grain.

    *expr* is used in SELECT/GROUP BY (may be CAST(... AS DATE)).
    *range_expr* (default *expr*) is used in WHERE bounds so timestamps can
    prune on the bare column.
    """
    bound = range_expr if range_expr is not None else expr
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
        # YEAR(CAST(ts AS DATE)) wraps the column; use calendar bounds on bare col.
        start = date(y, 1, 1)
        end = date(y + 1, 1, 1)
        clauses.append(f"{bound} >= {_sql_date(start)}")
        clauses.append(f"{bound} < {_sql_date(end)}")
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
        clauses.append(f"{bound} >= {_sql_date(start)}")
        clauses.append(f"{bound} < {_sql_date(end)}")
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

    if grain == "day":
        if parent is None or not _WEEK_RE.match(parent):
            raise HTTPException(
                status_code=400, detail="day grain requires parent YYYY-Www"
            )
        wm = _WEEK_RE.match(parent)
        assert wm is not None
        wy, ww = int(wm.group(1)), int(wm.group(2))
        w_start = iso_week_start(wy, ww)
        w_end = w_start + timedelta(days=7)
        clauses.append(f"{bound} >= {_sql_date(w_start)}")
        clauses.append(f"{bound} < {_sql_date(w_end)}")
        if clip is not None:
            if not _MONTH_RE.match(clip):
                raise HTTPException(
                    status_code=400, detail="clip must be YYYY-MM when provided"
                )
            cy, cm = int(clip[:4]), int(clip[5:7])
            c_start = date(cy, cm, 1)
            c_end = next_month_start(cy, cm)
            clauses.append(f"{bound} >= {_sql_date(c_start)}")
            clauses.append(f"{bound} < {_sql_date(c_end)}")
        where = f" WHERE {' AND '.join(clauses)}"
        return (
            f"SELECT TO_VARCHAR({expr}) AS value, COUNT(*) AS cnt "
            f"FROM {table}"
            f"{where} "
            f"GROUP BY {expr} "
            f"ORDER BY {expr} ASC"
        )

    if grain == "hour":
        if parent is None or not _DATE_RE.match(parent):
            raise HTTPException(
                status_code=400, detail="hour grain requires parent YYYY-MM-DD"
            )
        y, m, d = int(parent[:4]), int(parent[5:7]), int(parent[8:10])
        start = datetime(y, m, d)
        end = start + timedelta(days=1)
        clauses.append(f"{bound} >= {_sql_ts(start)}")
        clauses.append(f"{bound} < {_sql_ts(end)}")
        where = f" WHERE {' AND '.join(clauses)}"
        return (
            f"SELECT CONCAT("
            f"TO_VARCHAR(TO_DATE({expr})), 'T', "
            f"LPAD(TO_VARCHAR(HOUR({expr})), 2, '0')"
            f") AS value, COUNT(*) AS cnt "
            f"FROM {table}"
            f"{where} "
            f"GROUP BY TO_DATE({expr}), HOUR({expr}) "
            f"ORDER BY HOUR({expr}) ASC"
        )

    raise HTTPException(status_code=400, detail=f"Unknown period grain {grain}")
