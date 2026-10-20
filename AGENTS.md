# Agent guidance

## Commands and layout

- Use Node `22.23.3` from `.nvmrc`; install with `npm ci`, run with `npm start`, run the offline suite with `make test`, and run backend syntax checks with `npm run check`.
- Focused checks are `node --test tests/engine.test.js` and `node --test tests/http.test.js`; frontend modules need separate `node --check public/js/**/*.js` checks because `npm run check` covers only the backend entrypoints.
- `better-sqlite3` is native; on Linux, an `invalid ELF header` after a cross-platform install means the local binary is Windows-built—run `npm rebuild better-sqlite3 --build-from-source` before testing.
- `server.js` owns Express/Socket.IO; `src/` owns SQLite, auth scaffolding, and server rules; `public/` is served directly with no build step. Do not add a frontend framework or bundler.
- `public/js/shared/` contains the single renderer/`PumpkinCharacter` implementation shared by the admin preview and transparent OBS overlay. The overlay is logically `1920×1080`; GSAP is served from local `public/vendor/gsap.min.js`, not a CDN.
- `Cozy_Pumpkins_SDD_Specification.md` is the product contract; `README.md` documents setup, OBS, tests, and Docker.

## Boundaries future changes must preserve

- The backend is the source of truth: validate pumpkin bounds, No-Go Zone, ownership, reward IDs, parent links, and all state changes server-side.
- Store logical positions in `1920×1080` coordinates. Socket drag moves carry strictly increasing per-session `sequence`; persist only the final validated position.
- Donation event IDs and Twitch redemption IDs are SQLite uniqueness keys; retries/reconnects must not repeat effects.
- Keep `.env`, provider tokens, encryption keys, and `data/*.sqlite` out of Git and out of client files, browser storage, Socket.IO payloads, JSON responses, and normal logs. Use `.env.example` for placeholders.
- The implementation uses customization slot `prop` (not `accessory`) in the JSON/API/frontend contract, even where the specification uses “accessory” descriptively.
- Keep Twitch and DonationAlerts independent. Twitch revoke may be claimed only after the official endpoint confirms it; never claim undocumented DonationAlerts remote revoke.

## Current integration/test limits

- OAuth URL/token storage/logout and status scaffolding exist, but provider-specific Twitch EventSub and DonationAlerts Centrifugo event loops are not wired; do not report `Connected` as `Live`.
- `POST /api/dev/donation` is a non-production, local-admin simulator that exercises real donation processing; tests use in-memory SQLite and need no credentials or network.
- When changing behavior, preserve tests for deduplication, No-Go validation, continuous drag/reconnect, stacking limits, independent provider failure, and GSAP cleanup after deletion; keep `package-lock.json`, `Dockerfile`, `.nvmrc`, and `Makefile` aligned.
