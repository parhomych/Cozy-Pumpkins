# Tasks: Donation Platforms

**Input**: Design documents from `specs/002-donation-platforms/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`

**Tests**: Included because the specification defines automated measurable outcomes and project policy requires automated coverage for behavior changes. Provider tests must remain credential-free and offline.

**Organization**: Tasks are grouped by the three P1 user stories in `spec.md`; dependencies below identify the shared schema prerequisite and the final end-to-end story dependencies.

## Phase 1: Setup

**Purpose**: Install the documented realtime client libraries without changing the no-build frontend architecture.

- [x] T001 Add the Centrifugo v5-compatible `centrifuge` client and the DonatEx-recommended `@microsoft/signalr` client to `package.json` and synchronize `package-lock.json`.

---

## Phase 2: Foundational

**Purpose**: Add the shared SQLite persistence foundation required by provider connections, spawn settings, and event processing.

- [x] T002 Migrate `src/db/schema.sql` and `src/db/database.js` to allow token providers `twitch`, `donationalerts`, `donatex`, and `memealerts`; preserve existing encrypted token rows and all legacy donation rows under provider `donationalerts`; enforce uniqueness on `(provider, event_id)`; add `min_spawn_donation` and `spawn_command` with defaults `0` and `!тыковка`, applying the exact constraints “finite non-negative number” and “Trimmed, non-empty, bounded length”.

**Checkpoint**: The schema migration preserves existing Twitch/DonationAlerts state and provides all durable fields needed by the stories.

---

## Phase 3: User Story 1 - Connect donation platforms (Priority: P1)

**Goal**: Let the channel owner connect, independently monitor, recover, and disconnect DonationAlerts, DonatEx, and Meme Alerts using their documented OAuth and realtime transports.

**Independent Test**: Exercise each provider separately with mocked OAuth and realtime clients; verify safe account/auth/listening status, normalized event delivery to an injected handler, duplicate delivery safety, recovery after transport failure, and that stopping or failing one provider leaves the other two unchanged.

### Tests for User Story 1

- [x] T003 [P] [US1] Add offline provider contract tests for OAuth state, status isolation, transport payload mapping, reconnect/disconnect and secret redaction in `tests/providers.test.js`.

### Implementation for User Story 1

- [x] T004 [P] [US1] Add server-only client ID, client secret, redirect URI and provider-specific callback configuration for DonationAlerts, DonatEx and Meme Alerts in `src/config.js` and `.env.example`.
- [x] T005 [US1] Extend provider-bound Authorization Code URL, callback, token persistence/refresh and local logout methods in `src/auth/oauth-adapters.js`; use DonationAlerts donation scopes, DonatEx `donations.subscribe`, and Meme Alerts `oauth-user-show oauth-donation-subscribe`.
- [x] T006 [US1] Implement a reusable Centrifugo v5 connection/subscription lifecycle with refreshed subscription tokens, reconnect handling and injected client construction in `src/integrations/centrifugo-client.js`.
- [x] T007 [P] [US1] Implement DonationAlerts Centrifugo profile/channel subscription and donation-event normalization in `src/integrations/donationalerts-events.js`.
- [x] T008 [P] [US1] Implement Meme Alerts profile lookup, `$alerts:donation_<user_id>` subscription-token retrieval and donation-event normalization in `src/integrations/memealerts-events.js`.
- [x] T009 [P] [US1] Implement the DonatEx SignalR client for `https://donatex.gg/api/public-donations-hub`, `DonationCreated` and `DonationRerun` normalization, automatic reconnect, and ID-based rerun deduplication in `src/integrations/donatex-events.js`.
- [x] T010 [US1] Compose provider lifecycle startup, shutdown, OAuth callbacks, logout and event-handler injection so each stored provider starts and stops independently in `server.js` and `src/http/api.js`.
- [x] T011 [US1] Add independent connection buttons, account/auth/live status, safe error states and recovery guidance for the three donation providers in `public/admin.html`, `public/css/admin.css` and `public/js/admin-app.js`.

**Checkpoint**: Each provider connects, exposes a truthful independent live status, forwards normalized events, and can recover or disconnect without affecting another provider.

---

## Phase 4: User Story 2 - Configure spawn rules and preview customization (Priority: P1)

**Goal**: Persist a common spawn threshold and command, and give the admin a read-only grouped keyword catalog with an accurate visual preview for every canonical appearance value.

**Independent Test**: Save a valid threshold and command, reload settings, and verify they persist; submit a negative/non-finite threshold or empty command and verify the previous settings remain; inspect every catalog value and verify its preview does not mutate a live or persisted pumpkin.

### Tests for User Story 2

- [x] T012 [P] [US2] Add settings API/socket persistence and validation tests for `minSpawnDonation` and `spawnCommand`, plus read-only catalog-preview interaction tests in `tests/http.test.js` and `tests/frontend.test.js`.

### Implementation for User Story 2

- [x] T013 [US2] Expose and validate persisted spawn settings in the settings API and Socket.IO payloads in `src/db/database.js`, `src/http/api.js` and `src/socket/handlers.js`; enforce `min_spawn_donation` as a “finite non-negative number” and `spawn_command` as “Trimmed, non-empty, bounded length”, and include the read-only catalog returned by `src/engine/customization-parser.js` in the settings response.
- [x] T014 [P] [US2] Expose the existing canonical customization values and their Russian/English aliases as a grouped, read-only catalog in `src/engine/customization-parser.js`; restrict slots to `skin`, `eyes`, `mouth`, `hat`, or `prop` and preserve the `prop` slot.
- [x] T015 [US2] Add the threshold/command controls and grouped catalog beside them, and render isolated per-value previews through `PumpkinCharacter` with animation cleanup and no scene mutation in `public/admin.html`, `public/css/admin.css` and `public/js/admin-app.js`.

**Checkpoint**: Spawn settings persist and validate server-side; every supported canonical customization value is discoverable and previewable without modifying the scene.

---

## Phase 5: User Story 3 - Create and grow pumpkins from donations (Priority: P1)

**Goal**: Process provider donations idempotently; gate new pumpkins by currency, minimum amount, configured command and safe position while continuing to count donations for existing owners without a command.

**Independent Test**: For each provider, submit normalized events for a new owner below threshold, above threshold without the command, and above threshold with a case-insensitive command and customization keywords; verify only the qualifying event spawns once in a safe position, a duplicate has no second effect, mismatched currency is not counted, and an existing owner donation updates only that owner's pumpkin without the command.

### Tests for User Story 3

- [x] T016 [P] [US3] Add donation-engine tests for provider-scoped duplicate IDs, distinct provider identities, minimum/command spawn gates, leading whitespace and case-insensitive command matching, customization aliases, existing-owner updates, currency mismatch and No-Go-safe spawn positions in `tests/engine.test.js`.

### Implementation for User Story 3

- [x] T017 [US3] Parse a validated configurable command prefix and pass only the trailing customization tokens to the existing alias parser in `src/engine/customization-parser.js`.
- [x] T018 [US3] Add provider-scoped donation insertion and donor-owner key generation while preserving legacy DonationAlerts owner lookup and event records in `src/db/database.js` and `src/engine/donations.js`; accept only allow-listed provider identifiers and never merge new owners across providers by display name.
- [x] T019 [US3] Validate normalized events in `src/engine/donations.js` (`eventId` required and stable; `ownerId` nullable; `displayName` and `ownerNormalized` required and bounded; `amount` finite, greater than zero, and within existing bounds; `currency` required uppercase; `message` bounded); apply unique-event, exact-currency, `minSpawnDonation`, command, identity and safe-position checks before spawning, while existing owners continue receiving same-currency totals without the command.
- [x] T020 [US3] Connect each provider's normalized event callback to the donation engine and verify one end-to-end mocked donation journey per provider in `server.js`, `src/integrations/donationalerts-events.js`, `src/integrations/donatex-events.js`, `src/integrations/memealerts-events.js` and `tests/providers.test.js`.

**Checkpoint**: All three providers use the same server-authoritative donation rules and provider-scoped idempotency, with existing-owner and currency behavior preserved.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Document supported integration setup and run the complete offline acceptance checks.

- [x] T021 [P] Update `README.md` with provider OAuth registration/configuration, independent live status/recovery, local-only logout semantics, Meme Alerts app-approval prerequisite, spawn settings and currency behavior.
- [x] T022 Run the offline acceptance commands in `specs/002-donation-platforms/quickstart.md` and resolve any regressions in the affected implementation or test files.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No prerequisites; add the selected realtime clients.
- **Foundational (Phase 2)**: Follows T001; database migrations must be in place before story-level persistence work.
- **User Stories (Phase 3+)**: Depend on T002. US1 and US2 are independently testable after the foundation; US3 depends on the provider event contract from US1 and persisted spawn rules from US2.
- **Polish (Phase 6)**: Documentation can proceed independently after configuration is defined; final quickstart verification depends on all desired stories being implemented.

### User Story Dependencies

- **US1 (P1)**: Depends on T002 only; independent OAuth/live transport lifecycle.
- **US2 (P1)**: Depends on T002 only; settings and preview are usable without connecting providers.
- **US3 (P1)**: Depends on US1 normalized provider events and US2 persisted settings and command/catalog parser.

### Task Dependencies

```text
T001 -> T002
T002 -> T003-T016
T003 -> T005-T010
T004 -> T005, T007-T009
T005 -> T006, T009-T010
T006 -> T007-T008
T007-T009 -> T010
T010 -> T011, T020
T012 -> T013-T015
T013, T014 -> T015
T014 -> T017
T010 -> T016-T019
T013 -> T016, T018-T019
T016-T018 -> T019
T007-T010, T017-T019 -> T020
T020, T021 -> T022
```

### Parallel Opportunities

- After T002, T004 and T003 can proceed in parallel because they touch configuration and provider-test files respectively.
- After T005 and T006, the DonationAlerts, Meme Alerts and DonatEx adapter tasks T007-T009 operate on separate provider modules and can be implemented in parallel.
- After T002, the US2 catalog logic T014 is separable from server settings work T013; the US1 provider modules are also separate from settings work.
- T021 documentation can be prepared independently once the environment variable names in T004 are settled; T022 remains the final integrated verification after T020 and T021.

## Parallel Example: User Story 1

```text
After T005 and T006:
Task T007: DonationAlerts adapter in src/integrations/donationalerts-events.js
Task T008: Meme Alerts adapter in src/integrations/memealerts-events.js
Task T009: DonatEx adapter in src/integrations/donatex-events.js
```

## Parallel Example: User Story 2

```text
After T012:
Task T013: Persist and validate settings in src/db/database.js, src/http/api.js, src/socket/handlers.js
Task T014: Derive the read-only keyword catalog in src/engine/customization-parser.js
```

## Implementation Strategy

### MVP First

All three user stories are P1 and the feature is only complete when donation events reach the same spawn rules. Implement and verify T001-T002, then US1 provider ingestion, US2 settings, and US3 event processing as one integrated MVP. Validate US1 and US2 independently at their checkpoints, then run US3 and the full quickstart.

### Incremental Delivery

1. Complete T001-T002 to establish dependencies and data migration.
2. Complete US1 and validate each provider transport independently with mocks.
3. Complete US2 and validate persisted controls and read-only previews without provider credentials.
4. Complete US3 and prove event idempotency, spawn gates, existing-owner updates and currency handling across all three providers.
5. Complete documentation and T022 offline verification.

## Requirement Coverage

| Requirement | Tasks |
|---|---|
| FR-001 | T005, T010, T011 |
| FR-002 | T006-T010, T020 |
| FR-003 | T003, T005-T011, T020 |
| FR-004 | T002, T012-T013, T019 |
| FR-005 | T012-T013, T015, T017 |
| FR-006 | T016, T018-T020 |
| FR-007 | T016, T019 |
| FR-008 | T014, T016-T017 |
| FR-009 | T014-T015 |
| FR-010 | T012, T015 |
| FR-011 | T002-T003, T016, T018, T020 |
| FR-012 | T016, T019 |
| FR-013 | T016, T019 |
| FR-014 | T002, T012-T015, T021 |
| FR-015 | T003-T005, T010-T011 |
| FR-016 | T003-T005, T010-T011, T021 |
