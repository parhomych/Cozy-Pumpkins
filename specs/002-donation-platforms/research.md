# Research: Donation Platforms

**Date**: 2026-10-20  
**Scope**: Official authorization and event delivery for DonationAlerts, DonatEx, and Meme Alerts; compatibility with the current Cozy Pumpkins implementation.

## Findings and decisions

### Decision: Use the documented outbound realtime transport for each provider

**Rationale**: All three official sources document a server-consumable realtime event channel. Cozy Pumpkins currently binds locally, so outbound WebSocket/SignalR connections fit the existing deployment model without requiring a public callback endpoint or relay.

**Alternatives considered**: Provider webhooks would require a public callback or tunnel and are unnecessary for the documented transports. Polling alone would add latency and does not replace the documented live-event channels.

#### DonationAlerts

- Official API documentation: <https://www.donationalerts.com/apidoc>
- OAuth Authorization Code and refresh-token flow; request only identity and donation-subscription scopes.
- Donation events are delivered by Centrifugo at `wss://centrifugo.donationalerts.com/connection/websocket`; obtain channel subscription tokens through the documented API.
- Keep this adapter independent from Twitch and from the other donation providers. The existing project already has DonationAlerts OAuth scaffolding, but provider-specific live donation delivery still needs to be added.
- No remote logout/revocation is claimed unless the provider confirms a documented revoke operation.

#### DonatEx

- Official documentation: <https://donatex.gg/api-docs>
- Realtime guide: <https://donatex.gg/api-docs/realtime>
- The public SignalR hub is `https://donatex.gg/api/public-donations-hub`; OAuth requires `donations.subscribe`. The documented event names include `DonationCreated`, `DonationRerun`, and `GoalUpdated`.
- Donation payloads expose `id`, `username`, `message`, `currency`, `amount`, `timestamp`, and moderation/test metadata. Map only the stable ID, donor identity, amount, currency, and message into the normalized donation contract.
- The documentation advises automatic reconnect, history reconciliation through `GET /v1/donations`, and deduplication on `id`, since a donation may appear as both a creation and rerun event. Do not count a rerun with an existing ID as a second donation.
- The provider requires a user OAuth token with the documented scope. Client credentials and the registered redirect URI must be configured server-side; no secrets belong in the admin browser.

#### Meme Alerts

- Official developer documentation: <https://memealerts.com/developers/api>
- The live documentation describes OAuth 2.0 Authorization Code and Centrifugo v5 for real-time delivery.
- Use scopes `oauth-user-show` and `oauth-donation-subscribe`; fetch the authenticated profile through `GET /api/v1/user/oauth`. Subscribe to `$alerts:donation_<user_id>` by obtaining a subscription token from `POST /api/v1/centrifuge/subscribe`, then connect to `wss://memealerts.com/connection/websocket`.
- Access tokens expire, refresh tokens rotate, and channel/socket tokens are time-limited. The adapter must coordinate refresh-token rotation and fetch new channel tokens after reconnect/expiry rather than retaining a stale token.
- The documentation marks the external API as under test and says application registration is handled through Meme Alerts support. Treat obtaining production application credentials as a deployment prerequisite; fail with a clear per-provider status if credentials are absent.

### Decision: Normalize identity and event uniqueness by provider

**Rationale**: Different providers can reuse event IDs and donor names are not proof of a shared person. Provider-scoped event keys prevent cross-platform collisions and provider-scoped new owner keys prevent accidental account merging. Legacy DonationAlerts owner keys and donation rows are retained.

**Alternatives considered**: A single globally unique event ID conflicts with the three independent provider namespaces. Matching names across providers could merge unrelated donors and is explicitly out of scope.

### Decision: Preserve the existing direct-app and test architecture

**Rationale**: The app already injects fetch/client dependencies, uses SQLite, has independently surfaced provider statuses, and tests without credentials. The current package manifest has no Centrifugo or SignalR client, so use the documented Centrifugo v5-compatible `centrifuge` SDK and the DonatEx-recommended `@microsoft/signalr` client, wrapped behind injectable adapters for offline tests. This avoids handwritten realtime protocol implementations without introducing a frontend build step or requiring live credentials.

**Alternatives considered**: Handwriting the Centrifugo or SignalR protocol would duplicate maintained protocol clients; a central external broker or webhook relay is operationally more complex and not required by the official APIs.

## Operational prerequisites and limits

- Register OAuth clients and allow the configured local/server callback URL with each provider. Keep client secrets in server environment configuration and user tokens in the existing encrypted token store.
- Meme Alerts explicitly documents the public API as being in a testing phase and application registration via support; production availability depends on provider approval.
- Live provider tests require each provider to issue an application/client ID and secret. Offline tests must use mocks and must not require provider credentials or network access.
- Currency conversion is not documented as a product requirement; events in a different currency from the scene currency do not satisfy the spawn threshold or increase the scene total.
