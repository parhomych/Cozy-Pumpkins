# Implementation Plan: Donation Platforms

**Branch**: `002-donation-platforms` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-donation-platforms/spec.md`

## Summary

Add three independently authorized and monitored donation sources using their documented outbound event transports: DonationAlerts and Meme Alerts via Centrifugo, and DonatEx via SignalR. Normalize provider events into the existing server-side donation pipeline, scope event and donor identity by provider, and gate new pumpkins by a persisted amount threshold and configurable command. Extend the admin panel with those settings and a shared-renderer-backed customization keyword preview.

## Technical Context

**Language/Version**: Node.js 22.23.3, native ES modules  
**Primary Dependencies**: Existing Express, Socket.IO, better-sqlite3, vanilla browser JavaScript; add `centrifuge` 5.x for Centrifugo and `@microsoft/signalr` for the DonatEx hub  
**Storage**: SQLite; encrypted provider tokens remain in `auth_tokens`; donation uniqueness becomes `(provider, event_id)`; spawn rules are added to the singleton `settings` record  
**Testing**: Node built-in test runner; provider protocol and OAuth tests use injected fetch/socket/connection fakes and no credentials or network  
**Target Platform**: Local Node.js admin/OBS overlay app, with outbound TLS connections to provider APIs and realtime services; no public inbound webhook required  
**Project Type**: Single-project web application with Express/Socket.IO backend and directly served browser modules  
**Performance Goals**: Process each valid unique event once; reconnect with bounded backoff; do not block unrelated providers or admin interaction while a provider is unavailable  
**Constraints**: Preserve server-authoritative scene mutations, shared 1920×1080 scene and renderer, encrypted token storage, no provider secrets in public payloads/logs, and no automatic currency conversion. Existing DA donation IDs must remain deduplicated after migration. OAuth app credentials and provider redirect URIs are server configuration, never browser settings.  
**Scale/Scope**: One account per provider per installation; three donation providers; existing customization slots and values only.

## Constitution Check

| Principle / constraint | Gate |
|---|---|
| Server-authoritative state and validation | Pass: provider events enter the existing backend donation service; amount, command, ownership, spawn position, and scene rules are checked server-side. |
| Validated, idempotent events | Pass: persist provider plus event ID before effects; provider adapters normalize payloads and transport retries are safe. |
| Stable scene and shared rendering | Pass: retain logical coordinates and use `PumpkinCharacter`/`PumpkinRenderer` for isolated catalog previews; `prop` remains the API slot. |
| Secret isolation and honest integrations | Pass: provider tokens remain encrypted and private; each provider reports auth and live delivery separately; logout claims only local disconnect unless revocation is confirmed. |
| Verifiable changes | Pass: mock-based tests cover each adapter, reconnect/failure isolation, migration, threshold/command behavior and preview catalog; the offline suite remains credential-free. |
| Existing runtime and architecture | Pass: no frontend framework or bundler; no inbound webhook listener or new public exposure. |

No constitution exceptions are required.

## Project Structure

### Documentation (this feature)

```text
specs/002-donation-platforms/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── provider-lifecycle.md
    └── normalized-donation.md
```

### Source Code (repository root)

```text
src/
├── auth/                 # Provider-specific OAuth URL, callback, refresh, logout
├── db/                   # Schema/migrations, provider-scoped donation keys and settings
├── engine/               # Normalized donation handling, spawn rules, customization parsing/catalog
├── http/                 # Admin-protected settings and provider connection routes
├── integrations/         # DonationAlerts and Meme Alerts Centrifugo; DonatEx SignalR
└── socket/               # Public status and persisted settings broadcasts
public/
├── admin.html
├── css/admin.css
└── js/admin-app.js        # Provider cards, spawn settings and isolated keyword previews
tests/
├── engine.test.js
├── http.test.js
└── frontend.test.js       # Extend relevant existing suites; add provider-focused tests as appropriate
```

**Structure Decision**: Extend the current single Node application and its existing provider/service seams. Keep transport-specific code in `src/integrations/`, provider authorization in `src/auth/`, and shared donation policy in `src/engine/donations.js`; do not duplicate scene effects in provider callbacks or browser code.

## Design

1. **Provider adapters and lifecycle**
   - Give each provider its own OAuth config, encrypted token row, status, event client and start/stop/reconnect lifecycle.
   - DonationAlerts uses its documented OAuth scopes and Centrifugo donation channel. Meme Alerts uses Authorization Code OAuth scopes `oauth-user-show oauth-donation-subscribe`, `/api/v1/user/oauth` for identity/socket token, the private donation channel, and Centrifugo v5. Refresh the access token and request fresh channel tokens when required; serialize refresh-token rotation.
   - DonatEx uses OAuth scope `donations.subscribe` and the documented public SignalR hub; process `DonationCreated`, and treat `DonationRerun` with the same event ID as an already-seen event rather than a second donation. Reconnect automatically and use the documented donation-history API to reconcile gaps where supported.
   - Normalize every transport event before handing it to the common donation service. Provider failures update only that provider's status. On process startup, start adapters only for stored valid credentials; on shutdown/logout, stop only the selected adapter.
2. **Persistence and identity**
   - Migrate `donations` from global `event_id` primary key to `(provider, event_id)`, copying legacy rows under `donationalerts`; preserve all recorded donation rows.
   - Extend the token-provider constraint through a safe table rebuild that preserves existing Twitch and DonationAlerts encrypted records.
   - Add validated `min_spawn_donation` and `spawn_command` fields to the singleton settings. Migrations use the specified defaults: zero threshold and `!тыковка`; requiring the command for new pumpkins is an intentional feature behavior.
   - Scope new donor identities by provider ID. Keep legacy DonationAlerts `da:<id>` and name-only keys readable so existing pumpkins retain their owners; do not merge users across providers by matching display name.
3. **Donation and spawn policy**
   - Persist unique, normalized events transactionally before any scene effect. Existing owners continue to accumulate valid same-currency donations without a spawn command.
   - New owners receive a pumpkin only when the event is unique, currency matches scene currency, amount meets the configured minimum, the trimmed message begins with the configured case-insensitive command, and a safe server-side position exists.
   - Parse customization tokens only after the configured command. Keep aliases and slot validation in the existing parser; unknown tokens do not invalidate a qualifying donation.
4. **Admin settings and preview**
   - Extend the existing authenticated settings update/read contract and Socket.IO scene/settings payload with the threshold and command; validate and persist on the server.
   - Add a grouped keyword catalog next to the spawn command. Generate it from the existing customization aliases/canonical values, not a second handwritten list.
   - Render previews with the shared character implementation in a detached/local preview container. Destroy preview animation instances on replacement and never broadcast or mutate scene state from catalog interactions.

## Complexity Tracking

No constitution violations or added architectural projects.
