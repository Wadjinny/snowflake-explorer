from typing import Any, Literal

from pydantic import BaseModel, Field


class SnowflakeConnection(BaseModel):
    account: str = Field(min_length=1)
    user: str = Field(min_length=1)
    password: str = Field(min_length=1)
    warehouse: str = Field(min_length=1)
    role: str | None = None


class NameItem(BaseModel):
    name: str


class ObjectItem(BaseModel):
    name: str
    kind: Literal["table", "view"]


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


FacetableType = Literal["string", "number", "date", "timestamp"]
SortDirection = Literal["asc", "desc"]


class ColumnFilter(BaseModel):
    column: str = Field(min_length=1)
    type: FacetableType
    values: list[Any] = Field(default_factory=list)


class SortSpec(BaseModel):
    column: str = Field(min_length=1)
    direction: SortDirection = "asc"


class PreviewRequest(BaseModel):
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)
    filters: list[ColumnFilter] = Field(default_factory=list)
    sort: SortSpec | None = None


class FacetValue(BaseModel):
    value: Any = None
    label: str
    count: int


class FacetResult(BaseModel):
    values: list[FacetValue]
    limit: int
    offset: int
    has_more: bool


class OkResponse(BaseModel):
    ok: bool = True
