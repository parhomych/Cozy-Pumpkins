# Tasks: Twitch Channel Points

**Input**: Design documents from `/specs/001-twitch-channel-points/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Automated tests are included because the project constitution requires behavior changes to have relevant test coverage and to remain verifiable without Twitch credentials or network access.

**Organization**: Tasks are grouped by the user stories in [spec.md](./spec.md), in priority order.

## Phase 1: Setup

**Purpose**: Prepare existing project configuration and documentation for a Twitch channel-points integration.

- [x] T001 [P] Document Twitch OAuth credentials, callback setup, reward configuration, and the distinction between authorization and live processing in `.env.example` and `README.md`.

---

## Phase 2: Foundational

**Purpose**: Provide the shared Twitch API capability required by reward catalog and live-event work.

**⚠️ CRITICAL**: Complete this phase before starting user-story implementation.

- [x] T002 Create a server-only Twitch Helix API client in `src/integrations/twitch-api.js` that sends the configured client ID and saved bearer token, applies a bounded request timeout, validates non-success responses, and returns safe errors without exposing credentials.

**Checkpoint**: Shared Twitch API requests are available for integration features; no browser code receives tokens.

---

## Phase 3: User Story 1 - Подключить канал и сопоставить награды (Priority: P1) 🎯 MVP

**Goal**: Connect the broadcaster account, load its reward catalog, and persist unambiguous mappings from Twitch reward IDs to supported actions.

**Independent Test**: With mocked Twitch responses, complete OAuth, display channel rewards with their title, cost, and availability, map rewards to actions, reload settings, and confirm mappings remain attached to reward IDs after a reward is renamed.

### Tests for User Story 1

- [x] T003 [P] [US1] Add HTTP tests in `tests/http.test.js` for authenticated reward listing, disconnected-account responses, provider failures, returned reward fields, reward-mapping persistence across database reopen, and token/secret non-disclosure.
- [x] T004 [P] [US1] Add reward-mapping validation tests in `tests/engine.test.js` proving only `inflate`, `jump_on`, `morph_fly`, `bat`, and `ghost` are accepted and one Twitch reward ID cannot be assigned to multiple actions.
- [x] T005 [P] [US1] Add admin UI assertions in `tests/frontend.test.js` for refreshing and displaying Twitch rewards, assigning reward IDs, duplicate-assignment feedback, and preserving empty action mappings.

### Implementation for User Story 1

- [x] T006 [US1] Validate the OAuth access token with Twitch, persist the broadcaster Twitch user ID and login through `src/auth/oauth-adapters.js` and `src/db/database.js`, and expose only account identity and safe provider status through `src/integrations/status.js`.
- [x] T007 [US1] Add a Twitch reward-catalog method to `src/integrations/twitch-api.js` that requests the authenticated broadcaster's rewards and normalizes ID, title, cost, and availability without treating titles as identifiers.
- [x] T008 [US1] Inject the Twitch API client through `server.js` and implement the authenticated `GET /api/twitch/rewards` response in `src/http/api.js`, returning a clear disconnected state and sanitized provider errors.
- [x] T009 [US1] Update `src/engine/rewards.js` to reject duplicate non-empty reward IDs across supported actions while retaining valid empty IDs as disabled mappings.
- [x] T010 [US1] Replace manual reward-ID text fields in `public/admin.html` with reward selectors and update `public/js/admin-app.js` to refresh the catalog, show title/cost/availability, preserve selected IDs across renames, prevent duplicate assignment, and retain saved mappings when refresh fails.

**Checkpoint**: An administrator can independently connect, browse, and save reward mappings without receiving or processing live activations.

---

## Phase 4: User Story 2 - Выполнить действие при активации награды (Priority: P1)

**Goal**: Process each valid Twitch redemption once and execute only its mapped action for the redeemer's linked pumpkin.

**Independent Test**: With a saved reward mapping and mocked EventSub messages, deliver one assigned redemption for a linked viewer, replay the same redemption ID, then deliver an unassigned reward and a redemption for an unlinked viewer; only the first event changes the correct pumpkin and broadcasts its action.

### Tests for User Story 2

- [x] T011 [P] [US2] Add EventSub WebSocket lifecycle tests in `tests/twitch.test.js` for welcome/session setup, redemption notification parsing, keepalive handling, reconnect messages, and invalid payload rejection without requiring network access.
- [x] T012 [P] [US2] Extend `tests/engine.test.js` to verify exact reward-ID matching, Twitch user-ID-first ownership lookup, no mutation for unlinked viewers, and one effect only for duplicate redemption IDs.

### Implementation for User Story 2

- [x] T013 [US2] Implement the Twitch EventSub WebSocket client in `src/integrations/twitch-eventsub.js`, subscribing to `channel.channel_points_custom_reward_redemption.add` for the authenticated broadcaster and handling welcome, notification, keepalive, reconnect, revocation, and transport errors.
- [x] T014 [US2] Wire EventSub notifications to `RewardService.handle()` and the existing server-authoritative broadcast path in `server.js`; start listening only after Twitch authorization and ensure the EventSub session ID and subscription use the connected broadcaster identity.
- [x] T015 [US2] Adapt `src/engine/rewards.js` to accept the normalized EventSub event shape and preserve its transaction around redemption insertion and scene mutation; keep `src/db/schema.sql` and `src/db/database.js` redemption-ID uniqueness as the duplicate guard.

**Checkpoint**: Assigned live activations produce the mapped scene event only once and only for the linked viewer's pumpkin; both existing browser surfaces consume the shared event.

---

## Phase 5: User Story 3 - Понимать состояние подключения и восстанавливаться (Priority: P2)

**Goal**: Report Twitch authorization and live-event delivery separately, recover from temporary disconnects, and stop Twitch processing cleanly without affecting DonationAlerts.

**Independent Test**: Simulate OAuth success without a listener, successful EventSub connection, a transient socket failure and recovery, and Twitch logout; confirm each status is accurate and DonationAlerts status and processing remain unchanged.

### Tests for User Story 3

- [x] T016 [P] [US3] Add status lifecycle tests in `tests/http.test.js` and `tests/twitch.test.js` for authorized-but-not-live state, listener failure/recovery, revoked subscriptions, logout cleanup, and unchanged DonationAlerts status.

### Implementation for User Story 3

- [x] T017 [US3] Extend `src/integrations/status.js` to expose the broadcaster identity and keep `authStatus` within `Disconnected`, `Connected`, or `Failed` and `connectionStatus` within `Disconnected`, `Listening`, `Retrying`, or `Error`, excluding all token data.
- [x] T018 [US3] Implement bounded reconnect and subscription restoration in `src/integrations/twitch-eventsub.js`; report retrying/error/listening transitions and stop retrying when the provider is disconnected or its subscription is revoked.
- [x] T019 [US3] Update `src/auth/oauth-adapters.js`, `src/http/api.js`, and `server.js` so Twitch logout stops the EventSub listener before local token deletion, startup does not report a saved token as live, and shutdown closes listener resources without changing DonationAlerts.
- [x] T020 [US3] Update `public/js/admin-app.js` and `public/admin.html` to show the broadcaster account, authorization state, live-event state, and actionable connection errors separately, preserving the existing independent DonationAlerts card.

**Checkpoint**: Admins can distinguish authenticated from live, see and recover from interruptions, and disconnect Twitch without affecting DonationAlerts.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Align operating guidance with the delivered feature and verify the complete offline test and syntax-check surface.

- [x] T021 [P] Update `README.md` and `specs/001-twitch-channel-points/quickstart.md` with the finished OAuth setup, reward refresh/mapping flow, EventSub status meanings, recovery behavior, and no-credentials offline validation steps.
- [x] T022 Run `npm test`, `npm run check`, and `node --check` for `public/js/admin-app.js`; record any required fixes in the failing source and test files.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No code prerequisites.
- **Foundational (Phase 2)**: Depends on setup; the shared Twitch API client blocks story implementation.
- **User Story 1 (Phase 3)**: Depends on the shared API client; delivers the first usable administrator workflow.
- **User Story 2 (Phase 4)**: Depends on the foundational API client and the existing reward processor. Event notifications can be tested independently of the catalog UI, but end-to-end use requires a saved mapping.
- **User Story 3 (Phase 5)**: Depends on OAuth from User Story 1 and the EventSub lifecycle from User Story 2.
- **Polish (Phase 6)**: Depends on all stories selected for release.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Phase 2; no dependency on another story.
- **User Story 2 (P1)**: Starts after Phase 2 and can be independently exercised with a seeded mapping; full admin-to-activation flow integrates with User Story 1.
- **User Story 3 (P2)**: Starts after User Stories 1 and 2 because status, recovery, and shutdown span their OAuth and EventSub lifecycles.

### Parallel Opportunities

- T001 is independent of implementation and can run in parallel with T002.
- Within User Story 1, T003, T004, and T005 target separate test files and can be written in parallel; after the shared client exists, T006, T007, and T009 can proceed in parallel when their file ownership is coordinated.
- Within User Story 2, T011 and T012 target separate test files and can be written in parallel; EventSub client work can proceed alongside engine-contract tests before server wiring.
- User Story 1 and User Story 2 can be implemented in parallel after Phase 2 if the team agrees on the redemption and broadcaster identity contracts.
- User Story 3 tests can be prepared while User Story 2 is under implementation; its production integration depends on the completed OAuth and EventSub lifecycles.

## Parallel Example: User Story 1

```text
Task: T003 Add Twitch reward endpoint tests in tests/http.test.js
Task: T004 Add mapping validation tests in tests/engine.test.js
Task: T005 Add admin reward selector tests in tests/frontend.test.js
```

## Parallel Example: User Story 2

```text
Task: T011 Add EventSub lifecycle tests in tests/twitch.test.js
Task: T012 Add redemption ownership and deduplication tests in tests/engine.test.js
```

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Setup and Foundational phases.
2. Complete User Story 1 to make broadcaster rewards visible and configurable.
3. Validate OAuth, catalog refresh, mapping uniqueness, and persistence with mocked Twitch responses.
4. Continue with User Story 2 to activate mapped scene actions, then User Story 3 for reliable live status and recovery.

### Incremental Delivery

1. Deliver User Story 1 as the initial admin-facing increment.
2. Add User Story 2 and verify redemption ownership, exact ID matching, and idempotency.
3. Add User Story 3 and verify reconnect, logout, and provider isolation.
4. Complete the offline test suite, syntax checks, and operational documentation.
