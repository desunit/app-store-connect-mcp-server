# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

An MCP (Model Context Protocol) server that exposes the Apple App Store Connect API as a set of tools (apps, beta testing, bundle IDs, devices, users, analytics/reports, App Store version localizations, and Xcode scheme listing). It runs as a stdio server, intended to be launched by an MCP client (Claude Desktop, Cursor, etc.) via `npx`.

## Commands

- **Build:** `npm run build` — runs `tsc` then `chmod +x dist/src/*.js`. Output goes to `dist/` (rootDir is `.`, so emitted JS lives under `dist/src/`).
- **Run locally:** `npm start` — runs `node dist/src/index.js` (must build first).
- There is **no test suite, linter, or watch script** configured. `tsc` is the only correctness gate — run `npm run build` to typecheck.

The server requires these environment variables at runtime (validated in `AuthService.validateConfig`):
- `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_P8_PATH` (required)
- `APP_STORE_CONNECT_VENDOR_NUMBER` (optional; only needed for sales/finance report tools)

Note: `dist/` is listed in `.gitignore` but the compiled output **is committed** to the repo. After changing TS source, rebuild and commit the matching `dist/` output, or published `npx` consumers will run stale code.

## Architecture

ESM project (`"type": "module"`, TypeScript `Node16` module resolution). **All relative imports must use explicit `.js` extensions**, even from `.ts` files (e.g. `import { ... } from './services/index.js'`).

Three-layer structure, all wired together in `src/index.ts`:

1. **`src/services/`** — transport + auth.
   - `auth.ts` (`AuthService`): generates a short-lived ES256 JWT from the `.p8` private key on every request (20-min expiry, re-read + re-signed each call).
   - `appstore-client.ts` (`AppStoreConnectClient`): thin axios wrapper over `https://api.appstoreconnect.apple.com/v1`. Provides `get/post/put/delete/patch`, plus two special download paths: `getGzipReport` (for Sales/Finance reports, which return a gzipped TSV *body* via `Accept: application/a-gzip` and must be gunzipped explicitly) and `downloadFromUrl` (for following signed analytics segment URLs).

2. **`src/handlers/`** — one class per domain (`AppHandlers`, `BetaHandlers`, `BundleHandlers`, `DeviceHandlers`, `UserHandlers`, `AnalyticsHandlers`, `LocalizationHandlers`, `XcodeHandlers`). Each takes the shared `AppStoreConnectClient` in its constructor (except `XcodeHandlers`, which shells out to `xcodebuild` and needs no client). Handlers translate tool args into App Store Connect API calls and return raw response data. Re-exported via `src/handlers/index.ts`.

3. **`src/index.ts`** — the MCP server entrypoint (`AppStoreConnectServer`). Two responsibilities, and **both must be kept in sync when adding a tool**:
   - `buildToolsList()`: the JSON-Schema tool definitions returned by `ListToolsRequestSchema`.
   - `setupHandlers()`: a single `switch (request.params.name)` in the `CallToolRequestSchema` handler that routes each tool name to a handler method.

   Adding/changing a tool means editing the schema in `buildToolsList()` **and** the `case` in `setupHandlers()`.

   **Response shape — always `formatResponse(...)`, never `{ toolResult: ... }`.** Every case must return the MCP `{ content: [{ type: "text", text }] }` envelope. The local helper `formatResponse(data)` does exactly that (JSON-stringified). Returning a bare `{ toolResult: data }` makes MCP clients render the literal string **`[object Object]`** — a bug we hit repeatedly. As of the 2026-06-02 cleanup all cases use `formatResponse`; report-download cases build the `content` envelope directly because their body is already a TSV string. Do not reintroduce `toolResult`.

`src/types/` holds request/response interfaces per domain, re-exported via `src/types/index.ts`. `src/utils/validation.ts` provides shared helpers used throughout handlers: `validateRequired`, `validateEnum`, `sanitizeLimit` (clamps to 1–200, default 100), `buildFilterParams` (`filter[key]=...`), `buildFieldParams` (`fields[key]=...`).

## API gotchas (hard-won — read before touching analytics/reports)

Keep this list current: when you discover an Apple-API quirk that cost real debugging time, add it here so it isn't rediscovered.

### Response shape
- **Never `{ toolResult }` → renders as `[object Object]`.** Always `formatResponse(...)`. (See Architecture §3.) This recurred multiple times; it is the single most common mistake in this repo.

### Analytics Reports API (`AnalyticsHandlers`)
The data chain is **request → reports → instances → segments → download**, and several steps have non-obvious constraints:
- **You cannot list report requests.** Apple forbids `GET_COLLECTION` on `/analyticsReportRequests` (allowed ops: CREATE, DELETE, GET_INSTANCE), and `create` returns **409 "You already have such an entity"** if one already exists for that app+accessType — *without* returning the existing id. Recover the id via the app relationship `GET /apps/{appId}/analyticsReportRequests` → tool `list_analytics_report_requests`. There is one request entity per `accessType` (`ONGOING`, `ONE_TIME_SNAPSHOT`).
- **Segments hang off an instance, not a report.** `GET /analyticsReports/{id}/segments` 404s (`relationship 'segments' ...`). Correct path: `list_analytics_report_instances` (`/analyticsReports/{id}/instances`, one instance per granularity+processingDate) → `list_analytics_report_segments` (`/analyticsReportInstances/{instanceId}/segments`).
- **`filter[category]` values are singular: `COMMERCE`, `FRAMEWORK_USAGE`** — `APP_STORE_COMMERCE` / `FRAMEWORKS_USAGE` return **400 PARAMETER_ERROR**. Valid set: `APP_STORE_ENGAGEMENT`, `APP_USAGE`, `COMMERCE`, `FRAMEWORK_USAGE`, `PERFORMANCE` (the `AnalyticsReportCategory` type mirrors these).
- **Instances are generated asynchronously** (hours → ~a day after the request is created). An empty instance list means "not ready yet", not "no data".
- **No cohort report exists.** The `COMMERCE` category has `App Downloads`, `App Store Purchases`, `App Store Subscription Event/State` (Standard/Detailed each) — but no download→paid / conversion cohort. Cohorts are App Analytics web-UI only; approximate by joining `App Downloads Detailed` + `App Store Purchases`/subscription reports on date+territory (aggregate, not per-user).

### Sales / Finance Reports API (`downloadSalesReport` / `downloadFinanceReport`)
- Requires `APP_STORE_CONNECT_VENDOR_NUMBER` (account-level, from Payments and Financial Reports — **not** the iTunes provider id, **not** an app Apple ID). Wrong vendor number → **400 PARAMETER_ERROR.INVALID**.
- Body is **gzipped TSV** via `Accept: application/a-gzip` — must be gunzipped (`getGzipReport`). The key must hold the **Sales/Finance** role (Analytics-only keys 500 here).
- Apple requires a report **`version`** and only supports certain `(reportType, version)` pairs (see `defaultVersion` map in `analytics.ts`); missing/wrong version → **500**. Subscription report types (`SUBSCRIPTION`, `SUBSCRIPTION_EVENT`, `SUBSCRIBER`) are **DAILY-only**, version `1_4`.
- Reports are account-wide — filter rows by `App Apple ID`.

## Notes

- `src/submit-app.ts` and `submit_app.py` are currently commented-out / standalone scratch files, not part of the server build path.
- `4.3.json` is the App Store Connect API OpenAPI spec (reference data, not part of the build). Upgraded from the stale `3.2.json` on 2026-06-02; `download_sales_report`'s report-type/subtype enums + default-version map were aligned to 4.3 (added `INSTALLS`, `FIRST_ANNUAL`, `WIN_BACK_ELIGIBILITY`, `SUBSCRIPTION_OFFER_CODE_REDEMPTION` and the `SUMMARY_INSTALL_TYPE/TERRITORY/CHANNEL` subtypes). Latest spec tracked at github.com/EvanBacon/App-Store-Connect-OpenAPI-Spec.
- Errors thrown as `McpError` (from validation helpers) are surfaced to the MCP client as structured tool errors.
- **Live-debugging the raw API** (faster than round-tripping through the MCP): mint a JWT with the committed key and `fetch` directly — `node` one-liner using `jsonwebtoken` (already a dep): `jwt.sign({iss:ISSUER,aud:'appstoreconnect-v1'}, fs.readFileSync(P8), {algorithm:'ES256',expiresIn:'10m',keyid:KEY_ID})`. Run it from the repo root so `node_modules` resolves.
