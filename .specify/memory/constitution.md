<!--
Sync Impact Report
Version change: Uninitialized template -> 1.0.0 (initial adoption)
Modified principles: None; the prior document contained only template placeholders.
Added sections: Core Principles; Additional Constraints; Development Workflow; Governance.
Removed sections: None.
Follow-up TODOs: Confirm the original ratification date.
-->
# Cozy Pumpkins Constitution

## Core Principles

### I. Server-Authoritative State
The backend MUST validate pumpkin bounds, No-Go Zone rules, ownership, reward IDs,
parent links, and every state-changing request. Clients MUST treat server state as
authoritative and MUST NOT bypass server validation when changing scene state. This
keeps the admin panel, overlay, and persisted scene consistent.

### II. Validated, Idempotent Events
Donation event IDs and Twitch redemption IDs MUST be uniquely persisted so retries
and reconnects cannot repeat effects. Drag updates MUST use strictly increasing
per-session sequence numbers; the server MUST validate updates and persist only the
final validated position. These rules prevent duplicate rewards and stale movement
from corrupting the scene.

### III. Stable Scene and Shared Rendering
Scene positions MUST use logical 1920×1080 coordinates. The admin preview and OBS
overlay MUST use the shared renderer and `PumpkinCharacter` implementation, and
customization contracts MUST use the `prop` slot. This preserves predictable layout
and appearance across both surfaces.

### IV. Secret Isolation and Honest Integrations
`.env` values, provider tokens, encryption keys, and SQLite database files MUST NOT
be exposed to browser code, browser storage, Socket.IO payloads, API responses, or
normal logs. Twitch and DonationAlerts MUST remain independently operable and a
failure in one MUST NOT be represented as a failure in the other. OAuth connection
status MUST NOT be described as live event processing; provider revocation MUST
only be reported when confirmed through a documented provider mechanism.

### V. Verifiable Changes
Behavior changes MUST have relevant automated test coverage, and existing tests for
deduplication, No-Go validation, drag/reconnect behavior, stacking limits, provider
failure isolation, and animation cleanup MUST remain valid. Changes MUST be checked
with the narrowest existing test and syntax/check commands that cover their impact.
This keeps changes testable without requiring credentials or external services.

## Additional Constraints

The project MUST use Node.js 22.23.3 and preserve the existing Node.js, Express,
Socket.IO, SQLite, vanilla JavaScript ES modules, SVG, and local GSAP architecture
unless an approved constitution amendment changes it. Browser files are served
directly; frontend framework and bundler additions are out of scope without such
an amendment. GSAP MUST remain locally served rather than loaded from a CDN.

Twitch and DonationAlerts integrations MUST remain separate. The development
donation simulator MUST remain non-production and MUST exercise the real
server-side donation processing path. A provider MUST NOT be described as live
until its event loop is implemented and verified. DonationAlerts remote revoke
MUST NOT be claimed without a documented and verified provider mechanism.

## Development Workflow

Feature specifications, implementation plans, and code reviews MUST identify
applicable principles and acceptance checks. Changes affecting a behavior MUST
update or add tests for that behavior. Use `make test` for the offline suite and
`npm run check` for backend syntax checks; frontend JavaScript changes MUST also
receive the applicable `node --check` validation. Tests MUST NOT require provider
credentials or network access.

Changes spanning server state, the admin panel, and the overlay MUST preserve
consistent contracts across those surfaces. Documentation MUST be updated when
project setup, operation, security boundaries, or supported integration behavior
changes.

## Governance

This constitution governs project specifications, plans, implementation, and
reviews. Amendments MUST include a rationale, affected principles or sections,
compatibility impact, and the required semantic version change. Maintainers MUST
review and approve amendments before they are adopted. The constitution MUST be
updated whenever an approved amendment changes project policy.

Versioning follows Semantic Versioning: MAJOR for incompatible governance changes,
MINOR for new or materially expanded principles or sections, and PATCH for
clarifications and non-semantic refinements. The amendment date MUST be recorded
in ISO 8601 date format. The original ratification date MUST be preserved across
subsequent amendments. Compliance MUST be reviewed during specification and code
review; deviations require an explicit rationale and an approved amendment when
they change a governing rule.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): confirm original adoption date | **Last Amended**: 2026-10-20
