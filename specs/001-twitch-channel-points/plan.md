# Implementation Plan: Twitch Channel Points

**Branch**: `001-twitch-channel-points` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-twitch-channel-points/spec.md`

## Summary

This feature adds a server-authoritative Twitch integration for channel point rewards: the admin connects the broadcaster account, loads reward metadata from Twitch, persists reward-to-action mappings by reward ID, and listens to EventSub redemption events to trigger the matching Pumpkin action only for the owner of the linked Twitch identity. The design preserves the existing DonationAlerts independence, keeps secrets server-side, and enforces idempotent processing using the redemption ID.

## Technical Context

**Language/Version**: Node.js 22.23.3

**Primary Dependencies**: Express, Socket.IO, better-sqlite3, dotenv, native ES modules, local GSAP, OAuth helper layer, server-side SQLite

**Storage**: SQLite for scene state, provider settings, reward mappings, redemption deduplication, and pumpkin lookup keyed by Twitch user data

**Testing**: Node's built-in test runner (`node --test`), plus backend syntax checks via `npm run check`

**Target Platform**: Local Node.js web app serving admin panel and transparent OBS overlay

**Project Type**: Web application / local service with browser admin and overlay surfaces

**Performance Goals**: Reward metadata loads within a few seconds, redemption processing completes in under 5 seconds, repeated redemption IDs are ignored without duplicate side effects

**Constraints**: Twitch and DonationAlerts statuses remain independent; no secrets in browser payloads or logs; live connection must be separately represented from OAuth success; EventSub only triggers when a reward is mapped by exact Twitch reward ID

**Scale/Scope**: Single broadcaster, per-instance scene state, one active Twitch connection, multiple mapped reward actions, and a local admin UI for configuration and live status

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Pass: Server-authoritative validation remains the source of truth for pumpkin state and admin actions.
- Pass: Twitch redemptions use unique redemption IDs and must be treated as idempotent events to avoid duplicate commands.
- Pass: Scene coordinates stay in logical 1920×1080 space and use the shared renderer contract across admin and OBS surfaces.
- Pass: Secrets and tokens remain on the server. Twitch and DonationAlerts are isolated and cannot be reported as live solely because authorization succeeded.
- Pass: Behavior changes remain testable without credentials or external services; the feature uses the existing offline test pattern.
- No constitutional violations require special justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-twitch-channel-points/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── twitch-channel-points.md
├── checklists/
│   └── requirements.md
└── spec.md
```

### Source Code (repository root)

```text
src/
├── auth/
│   ├── oauth-adapters.js
│   ├── session.js
│   └── status.js
├── db/
│   ├── schema.sql
│   └── db.js
├── engine/
│   ├── rewards.js
│   ├── donations.js
│   ├── spatial-rules.js
│   └── animation.js
├── http/
│   └── api.js
├── socket/
│   └── handlers.js
├── config.js
├── utils/
│   └── normalize.js
└── services/
    └── twitch/
        ├── client.js
        ├── eventsub.js
        └── reward-sync.js

tests/
├── engine.test.js
├── http.test.js
└── frontend.test.js

public/
├── admin.html
├── overlay.html
├── js/
│   ├── admin-app.js
│   ├── overlay-app.js
│   └── shared/
└── vendor/
    └── gsap.min.js
```

**Structure Decision**: This remains a single Node.js project with the feature implemented in the existing `src/` service layer and existing `public/` surfaces. No separate framework structure is introduced because the app is already organized around a single server, shared rest API, Socket.IO broadcasts, and shared frontend renderer.

## Complexity Tracking

No additional complexity exceptions are required; the feature fits the existing app architecture and constitution constraints without introducing a second runtime or parallel service boundary.
