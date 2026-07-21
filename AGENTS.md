# AGENTS.md

Instructions for AI agents working in this repository.

## Project overview

Snowflake Explorer — a compact IDE-style web app to browse Snowflake catalogs (databases → schemas → tables/views) and preview table/view data. Connections are named profiles stored in browser localStorage; the backend accepts credentials per request.

## Tech stack

### Frontend (`frontend/`)

| Concern        | Tool                         | Notes |
| -------------- | ---------------------------- | ----- |
| Package manager| **pnpm**                     | Never use `npm` or `yarn`. Use `pnpm add <pkg>` / `pnpm add -D <pkg>`. |
| Build/dev tool | **Vite** 8                   | Config in `frontend/vite.config.ts`. Dev proxy: `/api` → `127.0.0.1:1234`. |
| UI library     | **React** 19                 | Function components + hooks only. |
| Routing        | **React Router** 8 (data mode)| Import from `react-router` (not `react-router-dom`). |
| Server state   | **TanStack Query** 5         | `@tanstack/react-query` for fetching/caching remote data. |
| Panels         | **react-resizable-panels**   | `Group` / `Panel` / `Separator`. |
| Charts         | **ECharts**                  | `echarts` + `echarts-for-react` (transform workspace). |
| Styling        | **Compact design** + Tailwind 4 | Dark-only tool UI; tokens in `frontend/src/index.css`. |
| Language       | **TypeScript** (~6)          | Strict; prefer explicit types on APIs. |
| Linter         | **oxlint**                   | Config in `frontend/.oxlintrc.json`. |

### Backend (`backend/`)

| Concern        | Tool                         | Notes |
| -------------- | ---------------------------- | ----- |
| Package manager| **uv**                       | Never use `pip` or `poetry`. Use `uv add <pkg>` / `uv sync`. |
| Web framework  | **FastAPI**                  | ASGI app in `backend/main.py`. |
| Snowflake      | **snowflake-connector-python** | Short-lived connections per request. |
| Language       | **Python**                   | Type hints; Pydantic models for schemas. |

## Commands

### Frontend

Run from `frontend/`:

- `pnpm install` — install dependencies
- `pnpm dev` — start the Vite dev server
- `pnpm build` — type-check (`tsc -b`) then build for production
- `pnpm lint` — run oxlint
- `pnpm preview` — preview the production build

### Backend

Run from `backend/`:

- `uv sync` — create/update the virtualenv from `pyproject.toml` / `uv.lock`
- `uv run main.py` — start the FastAPI dev server (uvicorn with reload) on `127.0.0.1:1234`
- `uv add <pkg>` / `uv add --dev <pkg>` — add a runtime / dev dependency

## Conventions

### Connections

- Types: `frontend/src/types.ts` (`Connection`).
- Persistence: `frontend/src/connections.tsx` — keys `sf-explorer.connections` and `sf-explorer.activeConnectionId`.
- API client: `frontend/src/api/snowflake.ts` attaches `X-Snowflake-Connection` (base64url JSON of account/user/password/warehouse/role).
- Backend parses the header in `backend/deps.py`. Do not store credentials on the server.
- Backend caches live Snowflake sessions in `snowflake_client.ConnectionPool`, keyed by `sha256` of the credential fields, TTL **2 hours**. Concurrent use of the same session is serialized with a per-key lock; dead sessions are invalidated and retried once.
- Column filters (string / number / date / timestamp): facet values via `GET .../facet` (top frequent, page size 10); preview via `POST .../preview` with `filters` → SQL `IN` / `IS NULL`. Timestamps are faceted/filtered by calendar day.
- Preview also accepts `sort: { column, direction }` and returns `total` (COUNT with same filters). Header click cycles asc → desc → clear.

### Routing (React Router — data mode)

- Router config: `frontend/src/router.tsx` via `createBrowserRouter`. Do **not** switch to JSX `<Routes>`/`<BrowserRouter>`.
- Import from `react-router`. Pages live in `frontend/src/routes/`. Main workspace is `explorer.tsx`.
- Object selection is URL-driven: `/o/:database/:schema/:name` (+ `?kind=view`). Helpers in `frontend/src/paths.ts`. Tree leaves are `<Link>`s so Ctrl/Cmd-click opens a browser tab.
- In-app multi-tabs: open objects listed in a tab bar; each tab keeps its own filters/sort/paging. Tabs persist per connection in `sessionStorage` (`sf-explorer.tabs:<connectionId>`). Active tab follows the URL.
- Favorites: star databases / schemas / tables·views in the object tree (or the open table in the Data header). Shown as a nested tree (db → schema → object) above the catalog; favorited db/schema expand in place (catalog load), not by revealing the main tree. Stored per connection in `localStorage` (`sf-explorer.favorites:<connectionId>`). Types/helpers in `favorites.ts`; provider in `favoritesContext.tsx`.
- Selections: bookmark a table/view view with filters, sort, hidden columns, column order, and page size (Data header bookmark). Listed under **Selections** in the objects panel; opening restores that state into a tab. Stored per connection in `localStorage` (`sf-explorer.selections:<connectionId>`). Types in `selections.ts`; provider in `selectionsContext.tsx`.
- Column reorder: drag a table header to reorder; order stored per tab as `columnOrder` (session) and in saved selections.
- Column resize: drag the right edge of a header; widths stored per tab as `columnWidths` (session) and in saved selections. Double-click the handle to reset.
- Detail inspector: click a cell or row `#` to open a right-side panel (`DetailInspector`) with **Cell** (full value, copy, JSON pretty-print) and **Row** (all columns; click a field to focus that cell).
- Transformations: dedicated workspace at `/t/:tabId` for visual recipes (joins, filters, columns/rename, aggregate, pivot) compiled to Snowflake SQL. Results show as a table + ECharts (bar/line/area/scatter/pie/heatmap). **Drafts** open in session (`sf-explorer.transformTabs:<connectionId>`) and are not listed until **Save**; saved bookmarks live in `localStorage` (`sf-explorer.transformations:<connectionId>`) under **Transformations** in the objects panel (same idea as Selections). Types in `transformations.ts` / `transformTabs.ts`; providers in `transformationsContext.tsx` / `transformTabsContext.tsx`. Backend: `POST /api/transform/run` and `POST /api/transform/columns`. Create from Browse via Transform when a table is open.

### Data fetching (TanStack Query)

- Use `useQuery` / `useMutation` for server state — not `useEffect` + `fetch`.
- Keep HTTP calls in typed modules under `frontend/src/api/`.
- Use structured `queryKey`s that include connection id and catalog path inputs.

### Styling (Compact)

- Dark only — no light mode / theme toggle.
- Full viewport (`html,body,#root` height 100%, overflow hidden); only `.panel-body` scrolls.
- Surfaces use CSS variables in `index.css` (`--bg`, `--panel`, `--raised`, `--accent`, `--data`, etc.).
- Accent blue = interaction; teal (`--data`) + monospace = live values / FQNs.
- Uppercase micro-headers for panel titles.

### Backend (FastAPI)

- App in `backend/main.py`; routers under `backend/routes/`.
- Catalog: `routes/catalog.py`. Preview: `routes/data.py`. Transform: `routes/transform.py`. Test: `routes/connection.py`.
- Quote identifiers with `snowflake_client.fqn` / `quote_ident`.
- Manage deps with **uv** only.

### General

- TypeScript everywhere in the frontend (`.tsx` for components). No new `.js`/`.jsx` source files.
- Keep components small and composable.
- Do not add narrating comments; comment only non-obvious intent.
- After edits, ensure `pnpm lint` and `pnpm build` pass.

## Static assets

- Files in `frontend/public/` are served at the site root (`/favicon.ico`, `/manifest.webmanifest`, etc.).
