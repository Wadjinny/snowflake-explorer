# Security review: snowflake-explorer

**Date:** 2026-08-19
**Scope:** whole project. Full backend (`backend/**`, 2,787 LOC), security-relevant frontend paths, `Caddyfile`, `compose.yml`, `backend/Dockerfile`, `.github/workflows/deploy.yml`.

**Verification method:** three Snowflake parser behaviours were confirmed against live Snowflake with literal-only `SELECT`s (no table or data access); the memory-exhaustion issue was measured locally.

---

## 1. HIGH: SQL injection in string filter values, exploitable via a crafted link

**Status: FIXED (2026-08-19).** All string literals now go through a single `sql_string_literal()` encoder in `backend/filters.py` that doubles backslashes as well as quotes. Verified against live Snowflake: the three exploit payloads below now match nothing, and quote / backslash / `%` / `_` values still filter correctly. The same change also fixed `has` / `startswith` / `endswith` on backslash values, which previously searched for a literal `%`.

`backend/filters.py:264-266` escapes only single quotes:

```python
text = str(value).replace("'", "''")
return f"'{text}'"
```

Snowflake honours backslash escapes inside string literals, so a lone `\` swallows the closing quote. Verified live:

```sql
SELECT 'a\'b', LENGTH('a\'b')   -- returns "a'b", 3
```

Filter values `["\\", ") OR 1=1 --"]` make `build_filter_clause` emit (confirmed by running the compiler directly):

```sql
"NAME" IN ('\', ') OR 1=1 --')
```

Snowflake parses that as `IN (', ') OR 1=1` with the rest of the statement (including `ORDER BY ... LIMIT`) commented out. Verified live:

```sql
SELECT c AS leaked FROM (SELECT 'zzz' AS c) WHERE c IN ('\', ') OR 1=1 --') ORDER BY c LIMIT 1
-- returns 'zzz', which does not match the IN list
```

### Why this is not merely self-injection

Filters are URL state:

- `frontend/src/paths.ts:90` (`parseFiltersParam`) accepts any string as a filter value (`isFilterValue` allows string/number/boolean/null).
- `frontend/src/routes/explorer.tsx:228` applies the `?f=` param to the active tab, which immediately fires the preview query.

So a crafted link such as

```
/o/DB/SCHEMA/TABLE?f=[{"column":"ID","type":"string","values":["\\",") OR 1=1 --"]}]
```

runs attacker-chosen SQL under the victim's stored Snowflake credentials and role, on click. The attacker needs only one valid column name (`_prune_filters` drops unknown columns), and can always declare `type: "string"` for any column, so the column's real type is not a constraint.

### Impact bounds

`snowflake-connector-python` rejects multi-statement execution by default, so `; DROP ...` does not work. Within a single statement an attacker still gets:

- WHERE / HAVING bypass (filter evasion).
- Arbitrary reads via subqueries against anything the victim's role can see.
- Warehouse credit burn and hangs (cartesian joins, `SYSTEM$WAIT`).

### Second entry point (data-driven)

`backend/transform_compile.py:296` builds literals from **table data** (pivot values fetched from the source table), so a backslash inside a pivoted column value breaks out of the generated `CASE WHEN` in the same way.

### Fix

Either escape the backslash first:

```python
text = str(value).replace("\\", "\\\\").replace("'", "''")
```

or, preferably, bind values as `%(p0)s` parameters instead of interpolating them into the SQL text.

Note `_like_escape` (`backend/filters.py:270`) already doubles backslashes, which is why the `has` / `startswith` / `endswith` path is safe and this one was missed.

### Identifiers are sound

Backslash is *not* an escape inside delimited identifiers. Verified live: `SELECT 1 AS "a\"` yields a column literally named `a\`. So `quote_ident` (doubling `"`) is correct, and the alias / column-name paths in `transform_compile.py` are not injectable.

---

## 2. HIGH: no authentication on the deployed API; open Snowflake relay and easy DoS

**Status: FIXED (2026-08-19), one host step outstanding.** The published port is now `127.0.0.1:1235:1234`, the connector gets `login_timeout=15` so a bogus login cannot hold a threadpool slot for two minutes, and the `Caddyfile` gates the whole site (static plus `/api/*`) behind `basic_auth` with the hash read from `SF_EXPLORER_AUTH_HASH`. Verified with a containerised Caddy: 401 without or with wrong credentials on both `/` and `/api/*`, 200 with correct ones, and a fail-closed 401 when the env var is unset. **`SF_EXPLORER_AUTH_HASH` must be set on the host before the next deploy** (see README, Deploy > Access control), otherwise the site locks everyone out. Rate limiting is not included: standard Caddy has no rate-limit directive, and with auth in front the anonymous DoS vector is closed.

`backend/main.py` has no auth and no rate limiting, and `compose.yml` publishes `1235:1234` on all interfaces, so the API is reachable directly over plain HTTP, bypassing Caddy's TLS.

Consequences:

- Anyone who finds the host can POST arbitrary credentials and have the server dial `<account>.snowflakecomputing.com`: an anonymous credential-stuffing / brute-force relay attributable to this IP.
- Each bogus attempt occupies a threadpool slot for the connector's login timeout. All endpoints are sync (`def`, not `async def`), so with the default 40-thread pool a few dozen concurrent requests wedge the service.

**Fix:** bind `127.0.0.1:1235:1234`, put auth in front of `/api/*` in Caddy (basic auth, mTLS, or an IP allowlist), and add a rate limit.

---

## 3. MEDIUM: memory-exhaustion DoS via a number filter value

**Status: FIXED (2026-08-19).** `sql_value_literal` now rejects non-finite values (`NaN`, `sNaN`, `Infinity`) and refuses any value whose plain-digit rendering would exceed 64 characters, measured from `Decimal.as_tuple()` without building the string. 64 is above Snowflake's own `NUMBER(38,37)` ceiling, and live Snowflake rejects longer integer literals anyway (`Integer literal is out of representable range`), so the cap turns an obscure upstream error into a clear 400. Verified under a 120 MB address-space limit: every oversized payload returns 400 in well under a millisecond with no allocation, and normal values (`42`, `-3.14`, `1e-5`, 38-digit integers, `NUMBER(38,37)` extremes) compile unchanged.

Related lever, **not** fixed: `ColumnFilter.values` (`backend/models.py`) has no length cap, so a single request can carry an arbitrarily long `IN` list and there is no request body size limit in front of it. Cheap to close with `Field(max_length=...)`.

`backend/filters.py:234-240` does `format(Decimal(str(value)), "f")`.

Measured locally: `1E+100000000` expands to 100,000,001 characters in 0.14 s, so `1E+900000000` is roughly 900 MB and OOM-kills the container (`compose.yml` sets `mem_limit: 256m`), taking down every user. Reachable through the `?f=` URL param as well as the API.

**Fix:** reject non-finite values and bound the exponent / digit count before formatting, or bind numbers as parameters.

---

## 4. MEDIUM: plaintext passwords in localStorage combined with a CDN-loaded editor

**Status: CDN half FIXED (2026-08-19); localStorage half is your call.** `monaco-editor` is now a direct dependency and `frontend/src/monacoSetup.ts` calls `loader.config({ monaco })` with a Vite-bundled worker, so nothing is fetched from jsdelivr. `SqlPreviewModal` is `lazy()`-loaded at both call sites, which already render it only when open, so the ~1 MB gzipped Monaco chunk stays out of the initial page. The `Caddyfile` now sends a CSP: `script-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, with `style-src 'unsafe-inline'` (Monaco injects styles) and `img-src https:` (remote image previews in the cell inspector).

Verified in Chrome against the real `dist` served by a containerised Caddy with the real header: initial load fetches only the entry chunk and CSS from our origin; importing the real modal chunk runs `monacoSetup`, lazy-loads the SQL language chunk and the editor worker from our own origin, and renders a highlighted SQL editor (7 distinct token colour classes) with zero CSP violations and zero console errors. No request to jsdelivr: the CDN URL still appears as dead default config inside `@monaco-editor/loader`, but `loader.config` short-circuits it.

Still open by design: Snowflake passwords remain in `localStorage`. With no third-party script and a CSP in place the XSS surface is much smaller, but a same-origin XSS would still read them. Moving to `sessionStorage` (re-enter per browser session) or key-pair auth is a UX trade-off, not a code fix.

The README acknowledges Snowflake passwords living in `localStorage` (`frontend/src/connectionStorage.ts`). That accepted trade-off gets materially worse because `frontend/src/components/SqlPreviewModal.tsx:1` uses `@monaco-editor/react` without `loader.config({ monaco })`, so at runtime it fetches

```
https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs
```

(confirmed in `@monaco-editor/loader@1.7.0`) with no SRI and no CSP. A CDN or package-path compromise executes attacker JS on the origin holding every saved Snowflake password.

**Fix:** `monaco-editor` is already in `node_modules` as a peer, so bundle it locally (`import * as monaco from 'monaco-editor'; loader.config({ monaco })`) and add a CSP. Consider `sessionStorage` or key-pair auth for credentials.

---

## 5. RESOLVED, was MEDIUM: static root may expose the repo

**Status: NOT EXPLOITABLE (checked 2026-08-19), rule added anyway.** Reading the reusable workflow (`Wadjinny/workflows/.github/workflows/deploy-pnpm-vite.yml`) settles it: the frontend job `rm -rf`s the target directory and then `rsync -az --delete` uploads `frontend/dist/` contents into it, so the Caddy root holds build output only. No `.git`, no `.env`, no sources, and the build emits no source maps and no dotfiles. The path difference from the backend's `remote_dir` is by design: one is the static site, the other is the compose project.

Hardening applied regardless, since a future root change should not be able to leak: the `Caddyfile` 404s any request with a dot-segment, excluding `/.well-known/*` so ACME renewal keeps working. Verified against a copy of the real `dist` seeded with `.git/config`, `.env`, and an ACME token: both secrets 404 with no body, the ACME token returns 200, and assets plus SPA deep links are unaffected.

Two deploy facts confirmed while reading the workflows, both of which the fixes above rely on: `compose.yml` is copied from this repo and `docker compose up -d` is re-run, so the loopback port binding takes effect on the next deploy; and the Caddy job runs `caddy validate` under `set -e` before `systemctl reload`, so a bad Caddyfile fails the deploy instead of breaking the live site. That validate step runs without `SF_EXPLORER_AUTH_HASH` in its environment, which is exactly why the `Caddyfile` carries a fallback hash: without it, validation of `basic_auth` would fail and block every subsequent deploy.

`Caddyfile` serves `root * /home/ubuntu/thinkering/snowflake-explorer` with `file_server`, and Caddy serves dotfiles by default. If that directory is a checkout or build workspace rather than a dist-only directory, `/.git/config`, `/.env`, and source maps are publicly readable. The path also differs from the backend deploy dir (`/home/ubuntu/apps/snowflake-explorer`), so it is worth confirming what actually lands there.

**Fix:** point the root at the built `dist` only, add `file_server { hide .* }` plus a dotfile 404 rule, and add HSTS, `X-Content-Type-Options`, `Referrer-Policy`, and CSP headers.

---

## 6. LOW: container and error-handling hardening

- Image runs as root; no `cap_drop`, `read_only`, CPU limit, or healthcheck.
- `filters.period_bounds` on token `9999` or `9999-12` builds `datetime(10000, ...)`, raising an unhandled `ValueError` (HTTP 500). Reachable via `?f=`.
- `backend/deps.py:31` returns `exc.errors()`, which embeds the offending input value, so a malformed payload can echo the submitted password into the response body and logs.
- Cache keys uppercase db / schema / object names (`backend/columns.py:96`, `backend/routes/catalog.py:21`), so case-sensitive objects `"tbl"` and `"TBL"` collide and can serve the wrong column metadata. A correctness bug with mild data-integrity impact.

---

## Checked and clean

- No `dangerouslySetInnerHTML`, `innerHTML`, or `eval` anywhere in the frontend.
- `parseHttpUrl` (`frontend/src/components/DetailInspector.tsx:267`) restricts to http/https, so there is no `javascript:` href sink; external links carry `rel="noopener noreferrer"`.
- No CORS middleware, and auth is a custom header rather than cookies, so cross-origin reads and classic CSRF are both blocked.
- All caches and the connection pool are keyed by a SHA-256 of the credentials, so there is no cross-tenant cache leakage.
- Backend dependencies are current with no known-vulnerable pins (fastapi 0.139.0, starlette 1.3.1, snowflake-connector-python 4.7.1, urllib3 2.7.0, cryptography 49.0.0, requests 2.34.2).
- No secrets committed anywhere in git history.

Minor privacy note: `frontend/src/components/DetailInspector.tsx:172` renders `<img src>` from cell data, leaking the viewer's IP and referrer to arbitrary hosts when a cell holds an image URL.

---

## Priority

1. `backend/filters.py`: fix the string-literal escaping (finding 1) and the `Decimal` expansion (finding 3). Both are small and both are reachable from a link.
2. Close off the API (finding 2): bind to localhost, add auth in Caddy.
3. Bundle Monaco locally and add a CSP (finding 4); verify the Caddy static root (finding 5).
