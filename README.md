# Snowflake Explorer

Browse Snowflake databases, schemas, tables, and views in a dense IDE-style UI. Click an object to preview its rows.

**Live:** [snowflake-explorer.w-ilyas.site](https://snowflake-explorer.w-ilyas.site)

## Stack

| Layer | Tools |
| ----- | ----- |
| Frontend | pnpm, Vite 8, React 19, React Router 8, TanStack Query 5, Tailwind CSS 4, TypeScript, oxlint |
| Backend | uv, FastAPI, uvicorn, snowflake-connector-python |

Agent-oriented conventions live in [`AGENTS.md`](./AGENTS.md).

## Run locally

**Frontend** (proxies `/api` → backend)

```bash
cd frontend
pnpm install
pnpm dev
```

**Backend** (http://127.0.0.1:1234)

```bash
cd backend
uv sync
uv run main.py
```

## Connections

Snowflake credentials are managed in the UI (Manage), not via server env vars.

- Each connection has a **name**, account, user, password, warehouse, and optional role.
- Profiles are stored in the browser `localStorage` (`sf-explorer.connections`, `sf-explorer.activeConnectionId`).
- The frontend sends the active connection on each request via the `X-Snowflake-Connection` header (base64url JSON). The backend does not persist credentials.
- The backend reuses Snowflake sessions in memory, keyed by a hash of the credentials, for **2 hours** (then reconnects).

Passwords in `localStorage` are convenient for a personal tool but are visible to any XSS on the origin.

## What's included

- Compact dark explorer: object tree (Database → Schema → Table/View) + paginated data preview
- Named connection manager with Test / Save / Delete
- FastAPI catalog + preview endpoints backed by `snowflake-connector-python`
- Docker Compose deploy for the backend (`compose.yml`)

## Deploy

Push to `main` runs the deploy workflow: build/push the backend image, deploy over SSH, build the Vite frontend, and install the site Caddyfile.
