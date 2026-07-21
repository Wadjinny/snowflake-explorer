from contextlib import asynccontextmanager

from fastapi import FastAPI

from routes.catalog import router as catalog_router
from routes.connection import router as connection_router
from routes.data import router as data_router
from routes.health import router as hello_router
from snowflake_client import pool


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    pool.close_all()


app = FastAPI(lifespan=lifespan)

app.include_router(hello_router)
app.include_router(connection_router)
app.include_router(catalog_router)
app.include_router(data_router)


def main():
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=1234, reload=True)


if __name__ == "__main__":
    main()
