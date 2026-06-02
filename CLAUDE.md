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

   Adding/changing a tool means editing the schema in `buildToolsList()` **and** the `case` in `setupHandlers()`. Most cases return `{ toolResult: ... }`; report-download cases return `{ content: [{ type: "text", text: ... }] }`.

`src/types/` holds request/response interfaces per domain, re-exported via `src/types/index.ts`. `src/utils/validation.ts` provides shared helpers used throughout handlers: `validateRequired`, `validateEnum`, `sanitizeLimit` (clamps to 1–200, default 100), `buildFilterParams` (`filter[key]=...`), `buildFieldParams` (`fields[key]=...`).

## Notes

- `src/submit-app.ts` and `submit_app.py` are currently commented-out / standalone scratch files, not part of the server build path.
- `3.2.json` is a large reference data file, not source code.
- Errors thrown as `McpError` (from validation helpers) are surfaced to the MCP client as structured tool errors.
