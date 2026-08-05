from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class SnowflakeConnection(BaseModel):
    account: str = Field(min_length=1)
    user: str = Field(min_length=1)
    password: str = Field(min_length=1)
    warehouse: str = Field(min_length=1)
    role: str | None = None


class NameItem(BaseModel):
    name: str


class SchemaItem(BaseModel):
    """Schema row from an account-wide catalog listing."""

    database: str
    name: str


class ObjectItem(BaseModel):
    name: str
    kind: Literal["table", "view"]
    # Metadata row count for tables; null for views / unknown.
    row_count: int | None = None


ColumnType = Literal[
    "number",
    "string",
    "boolean",
    "date",
    "time",
    "timestamp",
    "binary",
    "semi",
    "geo",
    "other",
]


class ColumnInfo(BaseModel):
    name: str
    type: ColumnType


class PreviewResult(BaseModel):
    columns: list[ColumnInfo]
    rows: list[list[Any]]
    total: int
    # Full table schema when `columns` is a projected subset (distinct + column pick).
    schemaColumns: list[ColumnInfo] | None = None


FacetableType = Literal["string", "number", "boolean", "date", "timestamp"]
SortDirection = Literal["asc", "desc"]
FilterOp = Literal[
    "in",
    "is_null",
    "is_not_null",
    "is_empty",
    "is_not_empty",
    "has",
    "startswith",
    "endswith",
    "gt",
    "lt",
    "between",
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
]


class ColumnFilter(BaseModel):
    column: str = Field(min_length=1)
    type: FacetableType
    values: list[Any] = Field(default_factory=list)
    op: FilterOp = "in"
    # Kept in the recipe but skipped when compiling WHERE / HAVING.
    disabled: bool = False


class SortSpec(BaseModel):
    column: str = Field(min_length=1)
    direction: SortDirection = "asc"


class PreviewRequest(BaseModel):
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)
    filters: list[ColumnFilter] = Field(default_factory=list)
    sort: SortSpec | None = None
    distinct: bool = False
    # When distinct is on, omit these from the SELECT DISTINCT projection.
    hiddenColumns: list[str] = Field(default_factory=list)


class FacetRequest(BaseModel):
    column: str = Field(min_length=1)
    type: FacetableType
    q: str = ""
    limit: int = Field(default=10, ge=1, le=100)
    offset: int = Field(default=0, ge=0)
    # Other column filters to scope counts (current column excluded server-side).
    filters: list[ColumnFilter] = Field(default_factory=list)


class FacetValue(BaseModel):
    value: Any = None
    label: str
    count: int


class FacetResult(BaseModel):
    values: list[FacetValue]
    limit: int
    offset: int
    has_more: bool


PeriodGrain = Literal["year", "month", "week", "day", "hour"]


class FacetPeriodRequest(BaseModel):
    column: str = Field(min_length=1)
    type: FacetableType
    grain: PeriodGrain
    parent: str | None = None
    """When listing days under a week reached via a month, clip to that month."""
    clip: str | None = None
    filters: list[ColumnFilter] = Field(default_factory=list)


class FacetPeriodResult(BaseModel):
    values: list[FacetValue]
    grain: PeriodGrain
    parent: str | None = None


class OkResponse(BaseModel):
    ok: bool = True


# --- Transformations ---

ObjectKind = Literal["table", "view"]
JoinType = Literal["inner", "left", "right", "full"]
AggFn = Literal["count", "count_distinct", "sum", "avg", "min", "max"]


class SelectedObjectRef(BaseModel):
    database: str = Field(min_length=1)
    schema_name: str = Field(alias="schema", min_length=1)
    name: str = Field(min_length=1)
    kind: ObjectKind = "table"

    model_config = {"populate_by_name": True}


class JoinOn(BaseModel):
    leftAlias: str = Field(min_length=1)
    leftColumn: str = Field(min_length=1)
    rightAlias: str = Field(min_length=1)
    rightColumn: str = Field(min_length=1)


class TransformJoin(BaseModel):
    id: str
    type: JoinType
    target: SelectedObjectRef
    alias: str = Field(min_length=1)
    on: list[JoinOn] = Field(default_factory=list)


class RecipeColumn(BaseModel):
    ref: str = Field(min_length=1)
    as_name: str | None = Field(default=None, alias="as")

    model_config = {"populate_by_name": True}


class Aggregation(BaseModel):
    id: str
    fn: AggFn
    column: str | None = None
    alias: str = Field(min_length=1)


class PivotSpec(BaseModel):
    rowKeys: list[str] = Field(default_factory=list)
    pivotColumn: str = Field(min_length=1)
    valueColumn: str = Field(min_length=1)
    agg: AggFn = "sum"


class TransformRecipe(BaseModel):
    source: SelectedObjectRef
    sourceAlias: str = "t0"
    joins: list[TransformJoin] = Field(default_factory=list)
    filters: list[ColumnFilter] = Field(default_factory=list)
    columns: list[RecipeColumn] = Field(default_factory=list)
    groupBy: list[str] = Field(default_factory=list)
    aggregations: list[Aggregation] = Field(default_factory=list)
    # Post-aggregate filters (SQL HAVING) on group-by / metric aliases.
    havingFilters: list[ColumnFilter] = Field(default_factory=list)
    pivot: PivotSpec | None = None
    # Multi-column ORDER BY; legacy single SortSpec objects are coerced.
    sort: list[SortSpec] = Field(default_factory=list)
    # SELECT DISTINCT on the row projection (ignored when aggregating / pivoting).
    distinct: bool = False

    @field_validator("sort", mode="before")
    @classmethod
    def _coerce_sort(cls, value: Any) -> Any:
        if value is None:
            return []
        if isinstance(value, dict):
            return [value]
        return value


class TransformRequest(BaseModel):
    recipe: TransformRecipe
    # Result pager page size.
    limit: int = Field(default=100, ge=1, le=5000)
    offset: int = Field(default=0, ge=0)


class TransformResult(BaseModel):
    columns: list[ColumnInfo]
    rows: list[list[Any]]
    total: int
    sql: str
