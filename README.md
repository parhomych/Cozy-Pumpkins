# Cozy Pumpkins

Cozy Pumpkins is a no-build Node.js OBS Browser Source widget: DonationAlerts donations grow customizable pumpkins, Twitch Channel Points can trigger actions, and the local admin panel edits the live 1920×1080 scene.

## Requirements

- Node.js `22.23.3` (see `.nvmrc`)
- npm
- Optional: OBS Studio with a Browser Source

## Setup

```bash
npm ci
cp .env.example .env
```

For local development, the generated development secrets are sufficient. To use the available OAuth scaffolding, fill the Twitch and/or DonationAlerts values in `.env`; integrations remain independent. The current build stores OAuth state and tokens and implements safe logout, but provider-specific EventSub/Centrifugo live event loops still require separate implementation and verification, so `Connected` must not be treated as `Live`.

## Run

```bash
npm start
```

Open `http://localhost:3000/admin.html` for the control panel. Add `http://localhost:3000/overlay.html` as a transparent OBS Browser Source at **1920 × 1080**. The browser files are served directly by Express; there is no frontend build step or CDN dependency.

The development-only donation simulator appears in the admin panel when `NODE_ENV` is not `production`. It exercises the same server-side donation path and deduplication logic as an integration event.

## Test and checks

```bash
make test
npm run check
```

`make test` is the single offline test command. The test suite uses an in-memory SQLite database and does not require Twitch, DonationAlerts, network access, or credentials.

## Configuration and security

- Keep real values only in `.env`; never commit it, provider tokens, or `data/*.sqlite`.
- The overlay receives scene state and animation events only. OAuth secrets and token storage are server-only.
- The backend validates coordinates against the 1920×1080 scene and No-Go Zone. Drag intermediate positions are broadcast but only the final validated position is persisted.
- Donation event IDs and Twitch redemption IDs are unique in SQLite, so retries do not repeat effects.
- Twitch logout uses the official revoke endpoint and reports success only after the provider confirms it. DonationAlerts logout is explicitly local unless a documented remote revoke mechanism is verified.

## Project layout

- `server.js` — Express/Socket.IO entrypoint.
- `src/` — configuration, SQLite persistence, business rules, auth scaffolding, HTTP API, and Socket.IO handlers.
- `public/js/shared/` — renderer and `PumpkinCharacter`, shared by admin preview and OBS overlay.
- `public/assets/pumpkin-reference.svg` — supplied reference pumpkin artwork, loaded locally and split into animation layers at runtime.
- `public/admin.html` — scene editor, search, inspector, No-Go Zone controls, and provider statuses.
- `public/overlay.html` — transparent OBS Browser Source.
- `Cozy_Pumpkins_SDD_Specification.md` — product contract and acceptance scenarios.

## Docker

```bash
docker build -t cozy-pumpkins .
docker run --rm -p 3000:3000 --env-file .env -v "$(pwd)/data:/app/data" cozy-pumpkins
```

The volume keeps SQLite state across container replacement. For a public deployment, use HTTPS and add a real admin access boundary; the MVP is designed for a local host.
