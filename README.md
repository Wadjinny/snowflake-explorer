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

Passwords in `localStorage` are convenient for a personal tool but are visible to any XSS on
the origin. The site sends a CSP (`script-src 'self'`) and bundles every script, including
the Monaco editor, so no third-party code runs on that origin.

## What's included

- Compact dark explorer: object tree (Database → Schema → Table/View) + paginated data preview
- Named connection manager with Test / Save / Delete
- FastAPI catalog + preview endpoints backed by `snowflake-connector-python`
- Docker Compose deploy for the backend (`compose.yml`)

## Deploy

Push to `main` runs the deploy workflow: build/push the backend image, deploy over SSH, build the Vite frontend, and install the site Caddyfile.

### Access control

The site (static assets **and** `/api/*`) sits behind Caddy basic auth as user `ilyas`, so
the backend cannot be used as an anonymous Snowflake login relay. The password hash comes
from `SF_EXPLORER_AUTH_HASH` on the host; the fallback baked into the `Caddyfile` hashes a
discarded random password, so a missing env var locks the site instead of publishing it.

Set it up on the host **before** the next deploy installs the new Caddyfile:

```bash
caddy hash-password                      # prompts, prints a $2a$... hash
sudo install -m 600 /dev/null /etc/caddy/site.env
sudo tee /etc/caddy/site.env <<'EOF'
SF_EXPLORER_AUTH_HASH=<paste the hash>
EOF
sudo mkdir -p /etc/systemd/system/caddy.service.d
sudo tee /etc/systemd/system/caddy.service.d/env.conf <<'EOF'
[Service]
EnvironmentFile=/etc/caddy/site.env
EOF
sudo systemctl daemon-reload && sudo systemctl restart caddy
```

The backend container publishes on `127.0.0.1:1235` only, so the API is reachable through
Caddy alone and never over plain HTTP from off-host.
