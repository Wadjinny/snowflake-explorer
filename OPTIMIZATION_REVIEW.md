# Optimization Review - Snowflake Explorer

Whole-project performance review, 2026-08-19. Branch `security-review-fixes`.
Findings are ordered critical -> low. Every measurement in this document was
taken on this checkout; estimates are labelled as such.

**Status: the critical, high and medium findings are fixed.** Each carries a
`Fixed` note with the measured result. Three are deliberately partial and need a
decision from you rather than more code:

- **C4** - the re-render cost is gone, the DOM/layout cost of a 1000-row page is
  not, because removing it means abandoning content-based column widths.
- **H1** - vertical range drags are now free; a wide horizontal drag over a tall
  range still costs ~8 ms per pointer move (down from ~31 ms).
- **M1** - the SQL modal is down 26%, but going below ~750 kB gzip means dropping
  Monaco for a lightweight highlighter.

One medium finding I **withdrew** after measuring: **M3** (multiple uvicorn
workers) would now make things worse, not better - see its entry.

Low findings are untouched except **L2** (zstd, folded into H6).

Scope: `backend/` (FastAPI + snowflake-connector-python), `frontend/`
(React 19 / Vite 8 / TanStack Query), `Caddyfile`, `compose.yml`,
`backend/Dockerfile`.

## Measurements taken

Production build (`pnpm build`, vite 8.1.4, 2113 modules):

| Artifact | Raw | Gzip | Loaded when |
| --- | --- | --- | --- |
| `index-*.js` | 1,688 kB | **539 kB** | first paint, always |
| ├─ app code only (measured by splitting) | 542 kB | 158 kB | first paint |
| └─ echarts + zrender (measured by splitting) | 1,143 kB | **380 kB** | first paint (unused in Browse) |
| `index-*.css` | 53.7 kB | 9.8 kB | first paint |
| `editor.api-*.js` (Monaco) | 2,656 kB | 682 kB | first SQL modal open |
| `toggleHighContrast-*.js` (Monaco) | 1,166 kB | 296 kB | first SQL modal open |
| `SqlPreviewModal-*.js` | 375 kB | 102 kB | first SQL modal open |
| ~90 Monaco language chunks | ~350 kB | ~110 kB | on demand |
| `ts.worker.js` | 6,916 kB | - | **never requested** |
| `css.worker.js` | 1,075 kB | - | **never requested** |
| `html.worker.js` | 740 kB | - | **never requested** |
| `json.worker.js` | 430 kB | - | **never requested** |
| `dist/` total | **16 MB** | - | rsynced every deploy |

The echarts split was produced by temporarily adding an `advancedChunks` group,
then reverting `vite.config.ts`. So the split numbers are real, not estimates.

Source sizes (largest first): `index.css` 3432, `TransformBuilder.tsx` 2033,
`ObjectTree.tsx` 1268, `ColumnFilterPopover.tsx` 1070, `explorer.tsx` 1019,
`transform.tsx` 878, `DataGrid.tsx` 849, `ResultTable.tsx` 841,
`backend/filters.py` 639, `backend/routes/data.py` 619.

---

## Critical

### C1. Every Snowflake query for one connection is serialized behind a single lock

`backend/snowflake_client.py:136-149`

```python
@contextmanager
def connection(self, cfg):
    while True:
        entry = self._get_or_create(cfg)
        with entry.lock:          # held for the whole query
            ...
            yield entry.conn
            return
```

`ConnectionPool` caches exactly **one** connection per credentials hash and
holds `entry.lock` for the entire duration of the query, not just session
setup. Since a single user always produces the same credentials hash, the
effective Snowflake query concurrency for that user is **1**.

This is the root multiplier for most other latency in the app. The UI routinely
fires requests in parallel and they all queue:

- Startup: `SHOW DATABASES` then `SHOW TERSE SCHEMAS IN ACCOUNT`.
- Expanding *n* schemas in the tree: *n* `INFORMATION_SCHEMA.TABLES` queries.
- Opening a table: `DESC TABLE`, then `COUNT(*)`, then the data `SELECT`.
- Opening a filter popover: a facet `GROUP BY` while the grid still loads.
- Drilling a date tree: one `GROUP BY` per expanded node.

A tree expansion that could take 400 ms wall-clock takes *n* x 400 ms.

**Fixed.** `ConnectionPool` now keeps up to `MAX_SESSIONS_PER_KEY = 6` live
sessions per credentials hash and hands out an idle one. A checked-out session
is still never shared, so cursors stay isolated; callers no longer queue behind
each other. A `BoundedSemaphore` caps the session count, and a generation
counter makes `invalidate()` discard both idle sessions and any session that is
checked out at the time, so the existing "session died, retry once" path still
gets a fresh login.

Verified with a fake connection factory: four threads hold four distinct
sessions simultaneously (a `threading.Barrier` that would previously have
timed out), sequential calls still open zero extra sessions, the cap holds at
`max_per_key` across 8 contending callers, TTL expiry closes and replaces,
`invalidate` kills idle *and* in-flight sessions, credentials stay isolated,
and a failed login releases its slot rather than leaking it.

### C2. Preview runs an exact `COUNT(*)` before every page of rows

`backend/routes/data.py:313-325`, `_resolve_total` at `:166-202`

```python
total = _resolve_total(..., heavy=heavy, exact=False)   # runs first
out_names, out_types, rows = run_query_typed(cfg, data_sql, ...)
```

For a normal (non-Account-Usage) table, `_resolve_total` with `exact=False`
falls through to `SELECT COUNT(*) FROM {table}{where}`. So:

1. The count is **exact**, not approximate. With any `WHERE` it is a full scan;
   with `distinct` it materializes the whole DISTINCT set.
2. It runs **before** the data query, and (see C1) cannot overlap with it, so
   preview latency is `count + select`, not `max(count, select)`.
3. It re-runs on **every page turn**, even though the total is independent of
   `OFFSET`. Clicking through 10 pages runs the same full-scan count 10 times.

The app already has the right machinery to avoid this: a separate
`POST .../count` endpoint and a `?` button in the pager
(`frontend/src/routes/explorer.tsx:898-908`) that calls it on demand. That path
is currently only reachable when `total < 0`, which only happens for
Account Usage.

**Fixed**, keeping the current UX (the total still appears immediately; no new
`?` placeholders):

- A new `count_cache` (`query_cache.py`, 5 min TTL) keys the total by
  credentials, table, compiled `WHERE`, `distinct` and - for DISTINCT only -
  the projected columns. Because `OFFSET` is deliberately not part of the key,
  page turns reuse one COUNT.
- On a cache miss the COUNT runs on a worker thread while the row page runs on
  the request thread, so latency is `max(count, select)` rather than the sum.
  This is only possible because of C1.
- `/count` writes its exact result into the same cache, so a user-triggered
  count warms the next preview.
- `/catalog/invalidate` clears it, and the invalid-identifier retry path drops
  the totals for that table via `invalidate_totals()`.
- The 5 min TTL is deliberately shorter than the client's 10 min
  `PREVIEW_STALE_MS`, so a cached total is never staler than the rows on screen.

Verified against a stubbed Snowflake: paging 0..400 issues **1 COUNT instead
of 5**; an uncached page takes 54 ms for two 50 ms queries (serial would be
100 ms); changing filters or toggling `distinct` recomputes; `/count` then
`/preview` issues one COUNT total; `invalidate_totals` forces a recount; and a
failing row query still surfaces its own error rather than the background
count's.

### C3. ECharts ships in the initial bundle and is 70% of it

`frontend/src/router.tsx:4` -> `routes/transform.tsx:19` -> `components/TransformChart.tsx:2`

```ts
import TransformWorkspace from './routes/transform'   // static
import ReactECharts from 'echarts-for-react'          // pulls all of echarts
```

Measured: **1,143 kB raw / 380 kB gzip** of echarts+zrender in the first-paint
chunk, out of 539 kB gzip total. A user who only browses tables downloads,
parses and compiles all of it and never draws a chart. `import` from
`echarts-for-react` also pulls the full `echarts` barrel (every chart type,
every component, the GeoJSON/coord-system machinery) rather than a tree-shaken
subset.

**Fixed** by two levels of code splitting:

1. `router.tsx` loads the transform route through React Router's route-level
   `lazy`, so Browse never fetches it.
2. `transform.tsx` additionally `lazy()`-loads `TransformChart` behind a
   `Suspense` spinner, so entering the transform workspace renders the builder
   and result table without waiting on ECharts.

Measured, first-paint chunk:

| | Raw | Gzip |
| --- | --- | --- |
| Before | 1,688 kB | 539 kB |
| After | 475 kB | **141 kB** |

A **74% reduction**, better than the 158 kB predicted above because the
transform route's own code (62 kB / 16.5 kB) split out too. ECharts is now its
own 1,143 kB / 380 kB chunk, fetched only when a chart panel first renders.

Still open (medium, not done): `TransformChart.tsx:2` continues to import the
full `echarts` barrel. Switching to `echarts/core` with explicit
`use([BarChart, LineChart, ...])` registration for the six offered chart types
would shrink that 380 kB chunk substantially.

### C4. Data grids render every cell, with no virtualization

`frontend/src/components/DataGrid.tsx:784-844`, `ResultTable.tsx:751-817`

Page sizes go to 1000 (`PAGE_SIZES = [50, 100, 200, 500, 1000]`,
`explorer.tsx:73`). Every row x every visible column becomes a real `<td>`, and
each one allocates:

- a fresh inline style object - `colStyle(name)` returns a new
  `{width, minWidth, maxWidth}` per call (`DataGrid.tsx:569-573`),
- a `title` string - `String(cell)` (`:819`),
- a body string - `formatCell(cell, type)`, another `String(cell)`,
- two event-handler closures (`onPointerDown`, `onDoubleClick`),
- a template-built className string,
- `cellInRange()` -> `normalizeRange()`, one more object (`:59-81`).

At 1000 rows x 50 columns that is 50,000 DOM nodes and roughly 300,000
allocations per render pass. Layout is then computed by auto table layout over
`width: max-content` (`index.css:1392-1398`), which forces the browser to
measure every cell in every column before it can size anything.

**Fixed in part.** The per-render cost is gone; the DOM/layout cost of a
1000-row page is not. What changed:

- New `gridColumns.ts` + `gridRow.tsx`, shared by both grids. `GridRow` is
  `React.memo`'d, so any render that does not touch a row's own inputs skips it
  entirely.
- All per-column work (width style object, both cell classNames, the raw-tuple
  index) is resolved once per render in a `useMemo`, not once per cell. The
  style object identity is now shared by every cell in a column.
- Range membership is normalized once and passed to each row as two numbers, so
  `cellInRange`/`normalizeRange` no longer run per cell.
- Cell event handlers moved from every `<td>` to the `<tr>` and resolve the
  target from `data-vcol`, removing two closures per cell (100k on a
  1000 x 50 page).
- `String(cell)` is computed once and reused for the text and the `title`
  instead of twice. The tooltip is kept.
- The row callbacks are ref-backed `useCallback`s so the parent's inline
  closures cannot break the memo.
- Side effect: this also fixes **H4** - the hovered column is now resolved once
  per render instead of re-scanning `probeColumns` for every cell.

Measured in a browser against a verbatim copy of the previous markup,
1000 rows x 40 columns (40,000 cells, 12 samples each, medians):

| | Before | After | |
| --- | --- | --- | --- |
| Unrelated parent re-render | 48.5 ms | **0.6 ms** | **81x faster** |
| First render of a page | 136.6 ms | 134.5 ms | unchanged |

"Unrelated parent re-render" is the common case: a filter popover opening, a
scroll-position save (H2), a hover elsewhere in the UI. That was a 48 ms jank
spike on every one; it is now free.

Rendered DOM was diffed old vs new across text, classNames, `title`,
`data-col`/`data-row`/`data-vcol`, inline widths and NULL cells: identical
except for two cells where class *order* differs
(`cell-range col-resized` vs `col-resized cell-range`) - same set, so no CSS
effect. Interaction behaviour was driven with real events and is byte-identical:
cell double-click selects that cell, row-number double-click selects the row
with no cell, Ctrl+pointerdown anchors a range, plain pointerdown does not.

**Still open - needs a product decision.** First-render time and the 50,000
DOM nodes are unchanged, because they are dominated by DOM construction and
auto table layout, not by the JS that was removed. Eliminating that needs row
windowing, and windowing is incompatible with the current sizing model:
`.data-table { width: max-content }` with `table-layout: auto`
(`index.css:1392-1398`) derives every column's width from the widest cell in
the *whole* page, so rendering only the visible rows makes columns jump while
scrolling. Options:

1. Switch to `table-layout: fixed` with a default width per column, then
   window the rows. Fastest by far, but columns stop auto-fitting their content
   - a visible change to how the grid looks.
2. Measure the first page with auto layout, freeze the resulting widths, then
   window. Keeps the current look; costs one extra layout pass and can flicker
   on page change.
3. Leave it. A 1000-row page costs ~135 ms to render once, and the default page
   size is 100.

I did not pick one, since all three change behaviour you may care about.

---

## High

### H1. Drag-selecting a cell range re-renders the whole table on every pointer move

`DataGrid.tsx:258-268` and `ResultTable.tsx:254-264`

```ts
attachRangeListeners((ev) => {
  const at = posFromPoint(ev.clientX, ev.clientY)   // document.elementFromPoint
  ...
  setCellRange(updated)                            // full table re-render
})
```

Each pointermove does a hit test (`document.elementFromPoint`, which flushes
pending layout) and then a `setState` that re-renders all 50,000 cells from
C4. At 60 Hz that is unshippable on a wide result set.

**Fixed in part**, as a consequence of C4's memoized rows - no separate change
was needed. A vertical drag only changes the range props of the rows entering or
leaving the selection; a horizontal drag changes them for every row in the
range, so those still re-render.

Measured per pointer move, 1000 rows x 40 columns (medians over 40 moves):

| Drag | Before | After | |
| --- | --- | --- | --- |
| Vertical (extend down a column) | 30.8 ms | **0.5 ms** | 62x |
| Horizontal (widen over a 400-row range) | 31.5 ms | **8.3 ms** | 3.8x |

Vertical drags are now free. Horizontal drags fit inside a 16 ms frame at the
median but peak at 17 ms, so a wide drag over a very tall selection can still
drop a frame. **Still open:** making that O(1) means painting the highlight from
a single injected CSS rule keyed on `data-vcol` rather than a class on each
cell. I stopped short of that because 8 ms is inside the frame budget and the
change would move highlight rendering out of React.

### H2. Scrolling the grid re-renders the object tree

`explorer.tsx:538-548` -> `browseTabsContext.tsx:71-101,176-188`

```ts
const onGridScroll = () => {
  ...
  scrollSaveTimer.current = setTimeout(() => {
    updateTab(key, { scrollTop: pos.top, scrollLeft: pos.left })
  }, 150)
}
```

`updateTab` sets provider state, and `BrowseTabsProvider` builds a **new
context value object every render** (`:176`). Every consumer therefore
re-renders. `ObjectRow` calls `useBrowseTabs()` (`ObjectTree.tsx:1201`), so
each of possibly thousands of tree rows re-renders 150 ms after every scroll
gesture - and `DataGrid` (not memoized) reconciles its full cell set again.

**Fixed** by splitting the context in two. `BrowseTabActionsContext` carries
only the mutators; every one is a `useCallback` reading `tabsRef` /
`activeIdRef` instead of depending on `tabs` or `activeId`, so the actions
object identity never changes after mount. `BrowseTabsContext` still carries
`tabs` plus the actions for the consumers that genuinely read the list
(`explorer.tsx`, `workspace.tsx`, `workspaceTabsContext.tsx`). `ObjectRow` -
the only per-row consumer - now uses `useBrowseTabActions()`.

Measured with 500 actions-only rows subscribed alongside a real
`BrowseTabsProvider`, then firing 10 scroll-position saves:

| | Re-renders |
| --- | --- |
| Actions-only rows (stands in for the tree) | **0** (was 500 x 10 = 5,000) |
| Genuine tabs consumer | 10, as it must |

`React.memo` on `TreeRow`/`ObjectRow` (M6) would still help for renders that
*do* legitimately reach the tree; not done.

### H3. Tab persistence does a synchronous `JSON.stringify` + storage write inside the state updater

`openTabs.ts:144-148`, `transformTabs.ts:117`, called from
`browseTabsContext.tsx:71-81` and `transformTabsContext.tsx:100-114`

```ts
setTabsState((prev) => {
  const next = typeof updater === 'function' ? updater(prev) : updater
  if (activeId) saveTabs(activeId, next)     // stringify + sessionStorage.setItem
  return next
})
```

Every tab mutation serializes the **entire** tab array (filters, column orders,
column width maps, scroll offsets - and for transform tabs the full recipe and
chart config) and writes it synchronously. This fires on every scroll tick
(H2), every filter change, every column resize commit, and every keystroke in
the transform builder. A side effect inside a state updater also runs twice
under StrictMode.

**Fixed.** New `persistTabs.ts` exports `useDebouncedPersist(key, value, save)`,
used by both `browseTabsContext` and `transformTabsContext`. Writes now happen
in an effect after a 300 ms quiet period, not inside the reducer - which also
removes the StrictMode double-execution. Pending writes are flushed when the
connection id changes, when the provider unmounts, and on `pagehide`, so nothing
is dropped.

Verified in a browser: a burst of 20 rapid changes produces **0 writes during
the burst and one write of the final value** afterwards; switching the key
flushes the outgoing key's pending value under its own key before the new key
starts (`[conn-a, 99]` then `[conn-b, 7]` - no loss, no cross-contamination);
`pagehide` flushes immediately; a null key writes nothing.

### H4. `ResultTable` runs an O(probeColumns) lookup per cell while a column is hovered

`ResultTable.tsx:773-778` calling `columnMatchesHighlight` at `:825-841`

```ts
const highlighted = columnMatchesHighlight(col.name, highlightColumn, recipe, probeColumns)
```

Called once per cell. Inside, `findProbeColumn` linearly scans `probeColumns`
and `parseColumnRef` parses a string. The early `if (!highlightRef) return
false` keeps the idle case free, but hovering a column in the Columns step
makes it O(rows x cols x probeColumns): 1000 x 30 x 60 is ~1.8M operations per
render, and hover fires a render.

**Fixed** as part of C4. `ResultTable` now resolves `highlightedColumn` once in
a `useMemo` over `visible`, and both the header and the per-column cell classes
compare it with `===`.

### H5. Result rows are walked three times server-side before they reach the wire

`snowflake_client.py:239` -> `routes/data.py:345` -> FastAPI `response_model`

```python
rows = [list(row) for row in cur.fetchall()]                       # copy 1
...
rows=[[_serialize_cell(cell) for cell in row] for row in rows]      # copy 2
```

Then `response_model=PreviewResult` makes Pydantic validate and serialize the
same structure, and `JSONResponse` runs `json.dumps` over the result. For
1000 x 100 cells that is four full passes and two complete duplicate
allocations of the payload, inside a 256 MB container (`compose.yml`).

Note that `_serialize_cell`'s string truncation is largely redundant: the SQL
already wraps heavy columns in `LEFT(TO_VARCHAR(...), 2000)`
(`routes/data.py:135-138`).

**Fixed** for the serialization, **not done** for the row copy - I measured
first. On a 1000 x 100 payload:

| Approach | Time | vs today |
| --- | --- | --- |
| `json.dumps` + `jsonable_encoder` (was) | 132.7 ms | 1.0x |
| `ORJSONResponse`, keeping `response_model` | 110.3 ms | 1.2x |
| `orjson` + `model_dump()` | 5.8 ms | 22.9x |
| **`orjson` + hand-built dict (chosen)** | **1.0 ms** | **132.7x** |

All four produce byte-identical JSON. Note that swapping in `ORJSONResponse`
alone barely helps - `jsonable_encoder`, not `json.dumps`, is the bottleneck, so
the response model has to come off the hot path.

`/preview` and `/transform/run` now build the payload dict directly and return
`Response(orjson.dumps(...))`; the models moved to `responses={200: {...}}` so
the OpenAPI schema is unchanged. `json_response()` compares the payload keys
against the model's fields and raises if they diverge, so a future field
addition fails loudly instead of silently vanishing from the wire.

`_serialize_cell` is deliberately kept. It is the only remaining Python pass,
and it defines the current wire format: `Decimal` becomes a string (preserving
scale - `Decimal("1.50")` -> `"1.50"`), `bytes` becomes `[binary N bytes]`, and
long text is truncated. Letting orjson serialize those natively would have
changed the JSON the frontend already renders.

The `list(row)` copy was **left alone**: measured at 0.8 ms for 1000 x 100, i.e.
0.6% of the old cost and now smaller than the serialization itself. It also
duplicates only the row containers, not the cell values, so it is not the memory
risk I implied. `fetch_arrow_all()` is likewise unnecessary at this size.

Verified end-to-end through `TestClient` with connector-shaped values
(`Decimal`, `datetime`, `date`, `bytes`, `bytearray`, `None`, `bool`, a
2500-char string): the response body is **equal to what the `response_model`
path produced**, cell wire types are unchanged
(`['str','str','str','bool','str']`), the binary stub and the 2000-char
truncation are intact, and the drift guard fires when a key is missing.

### H6. Static assets are served without `Cache-Control`

`Caddyfile:38-42`

```
handle {
    root * /home/ubuntu/thinkering/snowflake-explorer
    try_files {path} /index.html
    file_server
}
```

`file_server` sends `Etag` and `Last-Modified` but no `Cache-Control`, so
browsers heuristically revalidate. With roughly 90 content-hashed chunks (the
Monaco language files) a reload becomes ~90 conditional requests over a
basic-auth TLS connection before the app can start.

**Fixed.** `/assets/*` is now served `public, max-age=31536000, immutable`;
everything else gets `no-cache`.

Note the naive version of this is subtly wrong. `header /index.html ...` does
**not** cover the SPA fallback: `header` runs before `try_files` rewrites the
path, so a deep link like `/o/DB/SC/TABLE` never matches `/index.html` and its
HTML would ship with no `Cache-Control` at all. Matching the complement
(`not path /assets/*`) covers the fallback, the root, the favicons and the API.

Also folded in **L2**: `encode gzip` -> `encode zstd gzip`.

Verified against `caddy:2-alpine` in Docker with the real Caddyfile (basic auth
and the upstream stubbed out):

| Request | Cache-Control |
| --- | --- |
| `/assets/index-abc123.js` | `public, max-age=31536000, immutable` |
| `/assets/index-abc123.css` | `public, max-age=31536000, immutable` |
| `/index.html`, `/` | `no-cache` |
| `/o/DB/SCHEMA/TABLE`, `/t/some-id` (SPA fallback) | `no-cache` |
| `/favicon.ico` | `no-cache` |
| `/api/databases` | `no-cache` |

ETag revalidation still returns 304, and content negotiation picks `zstd` when
offered, `gzip` otherwise.

### H7. The period drill tree has no server-side cache

`routes/data.py:547-619` (`/facet-periods`) vs `:487-515` (`/facet`)

`/facet` computes a 200-row page once and serves offsets from `facet_cache`.
`/facet-periods` has no cache at all, so every expansion is a fresh
`GROUP BY` over the table. Drilling year -> month -> week -> day is four
aggregate scans, and every reopen of the popover repeats them - collapsing and
re-expanding a node re-queries because TanStack's cache is the only layer
(`PeriodDrillTree.tsx:193-224`, `staleTime` 10 min, so it survives within a
session but not a reload).

**Fixed.** `/facet-periods` now caches its rows in `facet_cache` under a key of
`(credentials, table, column, type, grain, parent, clip, filters fingerprint)`.
The key is prefixed `facet:<cred>:period:` so the existing
`/catalog/invalidate` prefix sweep clears it too.

Verified: 4 identical requests issue **1** `GROUP BY` (was 4); a different
grain/parent or a changed filter set still recomputes; `/catalog/invalidate`
clears it.

Still open (lower value): one query returning all four grains for a date range
would replace the drill's N+1 pattern entirely.

---

## Medium

### M1. Monaco is imported whole for a read-only SQL viewer

`monacoSetup.ts:9` - `import * as monaco from 'monaco-editor'`

Opening the SQL modal for the first time downloads **~4.2 MB raw / ~1.08 MB
gzip** (editor.api 2,656 kB + toggleHighContrast 1,166 kB + SqlPreviewModal
375 kB), plus a language chunk. The barrel import brings every language
definition and every editor contribution (find widget, suggest, hover,
folding, links, IME, accessibility help, high-contrast themes).

**Fixed**, though less dramatically than I predicted above (I guessed "halves";
it is 26%). Monaco 0.56 ships an a-la-carte registration API, so `monacoSetup.ts`
now imports `monaco-editor/editor/editor.api` plus exactly five registrations:
the SQL language, `tokenization`, `folding`, `find`, `clipboard`, and `codicon`.

| | Raw | Gzip |
| --- | --- | --- |
| Before (editor.main barrel) | 4,196 kB | 1,081 kB |
| After | 3,117 kB | **805 kB** |

Modules transformed dropped 2,113 -> 1,628, and the ~90 per-language chunks are
gone (SQL's tokenizer is a lazy 8.8 kB chunk).

I measured each feature separately to see where the weight is:

| Registrations | Gzip |
| --- | --- |
| `editor.api` + SQL only | 751.7 kB |
| + tokenization | 752.1 kB |
| + folding | 762.6 kB |
| + clipboard | 783.4 kB |
| + find | 801.4 kB |

So the features cost ~50 kB combined; **`editor.api` itself is 752 kB gzip** —
the irreducible core of Monaco's standalone editor. Verified in a browser: the
editor mounts with 8 distinct SQL token classes, line numbers, folding chevrons,
a working Ctrl+F, `vs-dark`, a read-only textarea, and zero console errors.

One trap worth recording: `editor.main` imports `codicon.css` implicitly. Without
`features/codicon/register` the build silently drops the 141 kB icon font and the
find widget's buttons render as empty boxes — visible only in a screenshot, not
in any DOM assertion I had written.

**Still open — needs a product decision.** 805 kB gzip is a lot for a read-only
viewer, and the à-la-carte route cannot go below ~750 kB. Dropping Monaco for a
small highlighter (Prism-class, single-digit kB) would cut ~99% of it, but costs
the folding chevrons, the find widget and the editor look. I did not make that
call.

### M2. Four Monaco workers (9 MB) are built and deployed but never requested

`monacoSetup.ts:18` - `window.MonacoEnvironment = { getWorker: () => new EditorWorker() }`

`getWorker` unconditionally returns the plain editor worker, yet the build
emits `ts.worker.js` (6,916 kB), `css.worker.js` (1,075 kB),
`html.worker.js` (740 kB) and `json.worker.js` (430 kB). They are dead bytes in
the 16 MB `dist/` that the deploy rsyncs on every push. The `jsonMode`,
`cssMode`, `htmlMode`, `tsMode` and `lspLanguageFeatures` chunks come from the
same barrel import.

**Fixed** by M1: with no language services registered, the build no longer
emits them. Measured on `dist/`:

| | Before | After |
| --- | --- | --- |
| Total size | 16 MB | **5.6 MB** |
| JS chunks | 98 | **8** |
| Workers emitted | 5 (9.4 MB) | 1 (300 kB, editor only) |

That is 10 MB less to rsync on every deploy.

### M3. Single uvicorn worker in front of a serialized connection pool

`backend/Dockerfile:22` - `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "1234"]`

One process, one event loop. Every route is a sync `def`, so FastAPI dispatches
them to the AnyIO threadpool (40 threads by default) - which then all contend
on the single pooled connection from C1. Fixing C1 without also giving the
process more headroom just moves the bottleneck.

**Withdrawn — I recommended this, then measured and changed my mind.** Adding
workers would now make the app slower, for two reasons:

1. **Cache fragmentation.** Every fix in this document leans on process-local
   state: `ConnectionPool`, `column_cache`, `catalog_cache`, `count_cache`,
   `facet_cache`. Workers share none of it, so N workers mean N cold caches, N
   sets of Snowflake logins, and a 1/N chance that a page turn hits the cached
   COUNT from C2. The wins from C2/H7/M4/M9/M10 would be diluted by exactly the
   factor added.
2. **Memory.** Measured baseline RSS after importing the app is **77 MiB** (the
   Snowflake connector is heavy). Two workers is ~154 MiB of the 256 MiB
   `mem_limit` before any request, leaving little room for up to 6 pooled
   sessions per worker plus in-flight payloads (~2 MiB per 1000 x 100 preview).

With C1 in place, one worker already has a 6-session pool and a 40-thread
executor, and the JSON serialization that used to hold the GIL for 133 ms now
takes 1 ms (H5). For a single-user tool behind basic auth that is the right
shape. Revisit only if this becomes multi-user, and then raise `mem_limit` and
move the caches to something shared (Redis) in the same change.

### M4. Object listing is one query per schema

`routes/catalog.py:138-173`

```sql
SELECT TABLE_NAME, TABLE_TYPE, ROW_COUNT
FROM {db}.INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = %(schema)s
```

Expanding ten schemas in one database issues ten queries that, per C1, run
strictly one after another. `INFORMATION_SCHEMA.TABLES` is per-database, so a
single query without the `TABLE_SCHEMA` predicate returns all of them.

**Fixed.** One query per database now fetches every schema's tables, groups them
by schema and caches the map; the per-schema endpoint slices it. Verified: five
schema expansions issue **1** `INFORMATION_SCHEMA` query (was 5), grouping,
`kind` and `row_count` are preserved, an unknown schema returns `[]` without an
extra query, and a lowercase schema name still resolves.

### M5. One `useAllSchemas` query subscription per database row

`ObjectTree.tsx:1026` - `const accountSchemas = useAllSchemas(connection)`

Every `DatabaseNode` mounts its own `useQuery` against the same key. The
request is deduped, but each hook is a separate cache observer: an account with
200 databases means 200 subscriptions that all re-run their selector and
re-render on any notification for that key.

**Fixed.** `ObjectTree` calls `useAllSchemas` once, builds a
`Map<database, schemas>` via a new `groupSchemasByDatabase`, and passes a
memoized `SchemaIndex` (map + loading/error state) down to `DatabaseNode`. One
cache observer for the whole tree instead of one per database row.

### M6. The object tree has no memoization and an undebounced highlight box

`ObjectTree.tsx`

- `favFns` is a fresh object every render (`:152-157`), invalidating every
  child's props.
- `buildFavoriteForest(favorites)` runs on every render, unmemoized (`:423`).
- `favFns.hasFavoriteDescendant` linearly scans `favorites` per database and
  per schema node (`favorites.ts:214-233`).
- `favFns.isFavorite` -> `hasFavorite` builds a key string for every element on
  every call (`favorites.ts:168-171`), once per tree row.
- `catalogQ` lives on the tree root with no debounce (`:161`, `:320`), so each
  keystroke re-renders every expanded row and re-runs `highlightLabel`
  (`:818-841`) per label.
- Neither `TreeRow` nor `ObjectRow` is memoized.

**Fixed**, except the `React.memo`:

- `favoritesContext` memoizes a `Set` of favorite keys and exposes `isFavorite`
  as a stable `useCallback` doing one `Set.has` — O(rows) instead of
  O(rows x favorites).
- `favFns` and `buildFavoriteForest` are `useMemo`d.
- `hasFavoriteDescendant` now reads two `Set`s built in one pass over favorites,
  instead of scanning the whole list per database and per schema row. (Keyed with
  `\0`, matching `favoriteKey`, since Snowflake identifiers may contain spaces.)
- `catalogQ` is debounced 150 ms, so a keystroke no longer re-renders every
  expanded row and re-runs `highlightLabel` per label.

**Still open:** `React.memo` on `TreeRow`. It needs prop restructuring first —
`childRails()` builds a fresh array per child and `icon={<DatabaseIcon />}` a
fresh element per render, so memo would never hit as written. Lower value now
that H2 removed the tab-driven tree re-renders.

### M7. `TransformBuilder` has no memoization at all

`components/TransformBuilder.tsx` (2033 lines, zero `useMemo` / `useCallback` /
`memo`)

Every render rebuilds `columnEntries`, `visibleColumnEntries`,
`visibleGroupByColumns`, `aliases`, `sortColumnInfos`, `availableSteps` and the
selected-ref sets (`:316-612`). Each field edit calls `onChange` ->
`setRecipe` -> `updateTab`, which re-renders the builder **and** `ResultTable`
**and** persists all tabs synchronously (H3). Typing a rename into a column
field pays that cost per keystroke.

**Fixed** for the recomputation. The derived lists (`columnEntries`,
`visibleColumnEntries`, `visibleGroupByColumns`, `aliases`, `sortColumnInfos`,
`selectedRefs`, `groupBySet`) are now `useMemo`d, and two accidental O(n^2)
passes are gone: `columnEntries` used `recipe.columns.find()` per column and
`sortColumnInfos` used `columns.find()` per sort option — both are Maps now.
`parseColumnRef` results are also cached per column instead of being re-parsed
on every filter pass, and `columnsForAlias` groups in one pass rather than
scanning all columns per alias.

**Still open:** in-progress rename/search text still lives in the recipe, so each
keystroke round-trips through the tab context. That is now much cheaper (H3
debounced the storage write, and the memos above cut the recompute), but keeping
the text local and lifting on blur would remove it entirely.

### M8. Every context provider passes a fresh value object

`connections.tsx:72-78`, `browseTabsContext.tsx:174-189`,
`transformTabsContext.tsx:127-133`, `favoritesContext.tsx:64-68`,
plus `selectionsContext`, `transformationsContext`, `workspaceTabsContext`

None of the seven providers memoizes its value, and most define their action
functions inline. Any provider render invalidates all consumers - and these
providers are nested seven deep around the whole app (`main.tsx:24-43`).

**Fixed for six of seven.** `browseTabsContext`, `transformTabsContext`,
`favoritesContext`, `connections`, `selectionsContext` and
`transformationsContext` now `useMemo` their value and `useCallback` every
action, reading `activeId` / current items through refs so the callbacks do not
churn.

`workspaceTabsContext` is **deliberately left unmemoized**, and only its derived
`items` list is memoized. Its `closeUnified` / `saveTransformTab` close over
`order`, the current location and the dialog; a hand-maintained dep list there
risks serving a stale closure to the close-with-save flow, which would be a
correctness bug in exchange for a small win — the provider re-renders whenever
either tab list changes anyway. Making it safe means wrapping both functions in
`useCallback` with linter-checked deps, which is a refactor of the close flow
rather than a memoization tweak.

### M9. `/transform/run` re-executes the whole recipe just to count it

`routes/transform.py:141-147`

```python
count_sql = f"SELECT COUNT(*) AS cnt FROM ({inner_sql}) AS _cnt"
```

Every run and every page turn executes the full compiled statement - joins,
filters, group-by, pivot - a second time purely for the total. Same
offset-independence problem as C2.

**Fixed** the same way as C2, sharing the code. The total is cached against a
hash of the compiled `inner_sql` (so it is independent of LIMIT/OFFSET) and, on a
miss, runs concurrently with the row page. The overlap-and-cache logic now lives
in one place, `backend/rowset.py::fetch_page_with_total`, used by both endpoints.

Verified: 4 page turns issue **1** COUNT from cold (was 4), 0 when an earlier run
already warmed it, and a changed recipe — which changes the compiled SQL —
recounts.

### M10. Transform column probes are re-run and never cached

`routes/transform.py:61-73`

```python
for alias, obj in join_targets(recipe):
    names, types, _ = run_query_typed(cfg, f"SELECT * FROM {table} LIMIT 0")
```

One round trip per source, serialized (C1), on both `/transform/columns` and
`/transform/run`. So a 3-source recipe run costs 3 probes + 1 count + 1 data =
5 sequential Snowflake calls. `column_cache` and `describe_columns` already
exist for exactly this and are not used here - and `DESC TABLE` is cheaper than
`SELECT * LIMIT 0` on heavy views, which is why `columns.py` was written
(`columns.py:1`).

**Fixed.** `_probe_schemas` now goes through `describe_columns`, so it shares the
30-minute `column_cache` with Browse and uses `DESC TABLE` instead of
`SELECT * LIMIT 0` (cheaper on heavy views — the reason `columns.py` exists).

Verified: 3 calls to `/transform/columns` issue **1** `DESC TABLE` and **0**
`SELECT * LIMIT 0` (was 3 of the latter), and a following `/transform/run` adds
no probe at all.

### M11. Popover repositioning runs on capture-phase scroll, unthrottled

`ColumnFilterPopover.tsx:330-337`

```ts
window.addEventListener('scroll', update, true)   // capture: fires for the grid too
```

`update` calls `getBoundingClientRect()` (forcing layout) and `setPos()` (a
render) for every scroll event anywhere in the document, including grid
scrolling, while a filter popover is open.

**Fixed.** Both listeners now coalesce into one `requestAnimationFrame`, so at
most one `getBoundingClientRect` + `setPos` happens per frame no matter how many
scroll events fire, and the pending frame is cancelled on unmount.

### M12. `JSON.stringify(filters)` on every Explorer render

`explorer.tsx:381` - `const filterKey = JSON.stringify(filters)`

Used only as an effect dependency. Cheap per call, but it runs on every render
of the busiest component in the app (including every scroll-triggered render
from H2).

**Fixed.** The effect depends on `filters` / `sort` directly; both keep their
identity across unrelated tab updates because `updateTab` spreads the tab. The
`?? []` / `?? {}` fallbacks for "no active tab" also became shared constants, so
they no longer hand a fresh array to every dependency array on each render —
which incidentally cleared four `exhaustive-deps` warnings (23 -> 19).

---

## Low

### L1. `credentials_hash` recomputes SHA-256 several times per request

`snowflake_client.py:54-63`. Called by `_get_or_create`, again by
`connection()`'s expiry re-check, and again by each cache-key builder
(`columns.py:96`, `routes/data.py:488`, `routes/catalog.py:21`). Sub-millisecond
each, but it is pure and trivially cacheable per `SnowflakeConnection`
instance.

### L2. Compression is gzip-only and recomputed per request

`Caddyfile:9` - `encode gzip`. No zstd or brotli, and no precompressed files,
so 1.7 MB of JS is gzipped on the fly for every cold client.

**Partly fixed** with H6: now `encode zstd gzip`, verified negotiating zstd when
the client offers it. **Still open:** pre-generating `.br`/`.gz` at build time
and serving them via `file_server { precompressed zstd br gzip }`, so cold
requests do not recompress. Mostly moot now that H6 caches assets immutably.

### L3. `TtlCache` grows unbounded and evicts only on read

`query_cache.py:23-59`. No size cap, no background sweep; `clear_prefix` scans
every key. Entries accumulate per (credentials x table x column x filter
combination) in a long-lived process capped at 256 MB. Add an LRU bound
(`functools.lru_cache`-style or `cachetools.TTLCache`).

### L4. `SAMPLE BERNOULLI` is the expensive sampling mode

`routes/data.py:158-163`. `SAMPLE BERNOULLI(1)` is row-level and still scans
every row; `SAMPLE SYSTEM(1)` samples micro-partitions and is far cheaper for
an estimate. Only affects Account Usage previews, hence low. For plain tables,
`INFORMATION_SCHEMA.TABLES.ROW_COUNT` is already fetched free by the tree
(`routes/catalog.py:149`) and could seed the pager.

### L5. `usePruneStaleFavorites` re-derives and rewrites on every favorites change

`usePruneStaleFavorites.ts:26-43`. The effect depends on `favorites`, and
`replace` writes `localStorage` when the list differs. `favoritesEqual`
(`favorites.ts:174-178`) guards the loop, but the Map rebuild and the filter
pass run on every star toggle. Gate on a "pruned once per connection" ref.

### L6. Two string allocations per cell for the same value

`DataGrid.tsx:819,837` - `title={isNull ? 'NULL' : String(cell)}` and
`formatCell(cell, colType)` (`gridCells.tsx:38`, also `String(cell)`).
Folded into C4's fix.

### L7. Universal selectors during drags force a whole-document style recalc

`index.css:810` (`body.cell-range-selecting *`), `:1529`
(`body.col-resizing *`), `:1761` (`body.facet-resizing *`). Adding the class at
drag start invalidates style for every element on the page. Scope them to the
grid wrapper and the popover.

### L8. No server-side timing signal

Nothing in the backend logs request duration or query duration
(`logger` is used only for errors: `routes/data.py:53`, `routes/transform.py:33`).
There is no way to confirm in production which of C1/C2/H5 dominates. A single
middleware logging `route`, `elapsed_ms` and a `Server-Timing` header would
make the rest of this list measurable rather than argued.

---

## Suggested order for the remaining work

Critical, high and medium are done. What is left, highest value first:

1. **L8** - request timing instrumentation. Everything below is now small enough
   that guessing is worse than measuring; do this first.
2. **C3 remainder** - tree-shake ECharts via `echarts/core` + explicit `use()`
   for the six offered chart types. Shrinks the 380 kB gzip chart chunk, and it
   is the same kind of change M1 just proved out.
3. **M1 remainder** - decide whether the SQL modal keeps Monaco (805 kB gzip
   floor ~750 kB) or moves to a small highlighter.
4. **L3** - bound `TtlCache`. More pressing now: C2, H7, M4 and M9 all added
   cache entries, in a process capped at 256 MB.
5. **C4 / H1 remainders** - row windowing (needs a column-sizing decision) and
   CSS-driven range highlighting.
6. **M6 / M8 remainders** - `React.memo` on `TreeRow` (needs stable rails/icon
   props), `useCallback` on `workspaceTabsContext`'s close flow.
7. **M7 remainder** - keep in-progress builder text local, lift on blur.
8. **L1, L4, L5, L6, L7** - small, independent, low payoff.

## Verification notes

- Backend: exercised against a stubbed Snowflake (`_open_connection` /
  `run_query` / `describe_columns` replaced) plus FastAPI's `TestClient`, since
  no Snowflake credentials were available here. **No live Snowflake query was
  ever run** - the SQL text, query counts and cache keys are asserted, the
  queries themselves are not. Four suites, 36 cases: connection pool (8), count
  caching (7), HTTP payload + period cache (7), medium-tier behaviours (14).
- Caddy: verified with `caddy:2-alpine` in Docker against the real Caddyfile,
  basic auth and the API upstream stubbed out.
- Frontend: `tsc -b` and `pnpm build` pass. `oxlint` reports 19 warnings, down
  from 22 at the start.
- Browser measurements came from temporary Vite harnesses driven through
  Playwright, comparing against verbatim copies of the previous markup. They were
  deleted afterwards; the working tree contains only source changes.
- Not verified: real-world first-paint and API latency against a live Snowflake
  account. Bundle sizes and query-count reductions are exact; render timings are
  real but synthetic.
- One regression was caught only by looking at a screenshot, not by assertions
  (the missing Monaco icon font in M1). Worth remembering that DOM assertions
  pass happily on invisible glyphs.
