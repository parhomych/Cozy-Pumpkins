# Copilot Instructions

## Project Overview

Cozy Pumpkins is a no-build Node.js app serving a local admin panel and a transparent
OBS Browser Source. Node.js 22.23.3 is pinned in `.nvmrc`; the app uses native ES
modules and serves browser files directly, with no frontend bundler.

## Commands

- Install dependencies: `npm ci`
- Start the app: `npm start`
- Run the full offline test suite: `make test` (equivalent to `npm test`)
- Run a focused test file: `node --test tests/engine.test.js`,
  `node --test tests/http.test.js`, or `node --test tests/frontend.test.js`
- Run one matching test: `node --test --test-name-pattern="No-Go Zone validation" tests/engine.test.js`
- Check backend entry points: `npm run check`
- Check a frontend module: `node --check public/js/admin-app.js` (repeat for changed
  modules; `npm run check` does not cover browser JavaScript)

There is no configured lint script. Tests use Node's built-in test runner and an
in-memory SQLite database; they do not need credentials or network access.

## Architecture and Data Flow

- `server.js` composes the Express app, SQLite database, auth and integration
  services, donation/reward engines, HTTP routes, and Socket.IO handlers. Its
  exported app/server factories support tests and injected dependencies.
- `src/db/` owns SQLite schema and persistence. `src/engine/` owns donation and
  reward processing, customization parsing, and spatial/stacking rules. HTTP and
  Socket.IO handlers both enforce admin authorization and server-side validation.
- The backend is authoritative. Mutations persist to SQLite and are broadcast as
  Socket.IO events; both browser surfaces consume the same scene and event contract.
- `public/admin.html` and `public/js/admin-app.js` provide the editor and live
  preview. `public/overlay.html` and `public/js/overlay-app.js` render the OBS
  scene. Both use `public/js/shared/` for `PumpkinRenderer`, `PumpkinCharacter`,
  artwork, and coordinate mapping. Keep animation, scene positioning, and cleanup
  behavior in this shared implementation rather than duplicating it per surface.
- OAuth URL, token storage, logout, and provider status scaffolding exist, but
  Twitch EventSub and DonationAlerts Centrifugo event processing are not wired.
  An authenticated/connected provider is not necessarily live.
- `Cozy_Pumpkins_SDD_Specification.md` is the product contract. `README.md` covers
  setup, operation, tests, security, and Docker. Consult `AGENTS.md` for additional
  repository constraints and current test limits.

## Project-Specific Conventions

- Keep all scene positions in logical `1920×1080` coordinates. Convert browser
  pointer and element geometry through the shared coordinate helpers.
- Validate bounds, No-Go Zone overlap, ownership, reward IDs, parent links, and
  state changes on the server; client-side checks are for interaction, not authority.
- Socket drag moves use strictly increasing per-session `sequence` values.
  Intermediate moves are broadcast, but only the final validated position is
  persisted; disconnect handling must preserve the latest validated position.
- Donation event IDs and Twitch redemption IDs are SQLite uniqueness keys. Preserve
  idempotency across retries and reconnects.
- Use the `prop` customization slot in JSON, API, and frontend contracts (not
  `accessory`). Keep Twitch and DonationAlerts status, failure, and logout behavior
  independent. Claim remote token revocation only when provider-confirmed.
- Keep `.env`, provider tokens, encryption keys, and `data/*.sqlite` out of source,
  browser storage, API/Socket.IO payloads, and normal logs. Use `.env.example` for
  configuration placeholders.
- The donation simulator at `POST /api/dev/donation` is local-admin-only and
  non-production; it exercises the actual donation processing service.
- Preserve tests covering deduplication, No-Go validation, drag/reconnect behavior,
  stacking limits, independent provider failures, and GSAP cleanup after deletion.
  Keep `.nvmrc`, `package-lock.json`, `Makefile`, and `Dockerfile` aligned when
  changing runtime or dependency setup.
