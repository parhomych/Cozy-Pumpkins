# Data Model: Donation Platforms

## Provider

One configured integration per provider key: `donationalerts`, `donatex`, or `memealerts`.

| Field | Source | Rules |
|---|---|---|
| `provider` | System | Allow-listed provider identifier; independent lifecycle and status. |
| `authStatus` | OAuth lifecycle | `Disconnected`, `Connected`, or `Failed`. |
| `connectionStatus` | Realtime client | `Disconnected`, `Listening`, `Retrying`, or `Error` (provider contract may map labels consistently). |
| `account` | Provider profile | Public display name only; never token material. |
| `message` | Adapter | Safe user-facing status/error code; no tokens or full donation payloads. |

Provider OAuth client credentials are server configuration. Access/refresh tokens, scopes, provider user ID/login, and expiry remain in encrypted `auth_tokens`. Migration expands its provider allow-list without losing Twitch or DonationAlerts rows.

## Donation event

An adapter maps provider payloads into this internal shape before processing:

| Field | Type | Validation / use |
|---|---|---|
| `provider` | allow-listed string | Required; determines source and event namespace. |
| `eventId` | string | Required, normalized, stable provider event identifier. |
| `ownerId` | string or null | Provider-scoped donor ID where supplied. |
| `displayName` | string | Required bounded public display name. |
| `ownerNormalized` | string | Required normalized fallback identity. |
| `amount` | finite number | Greater than zero and within the existing donation bounds. |
| `currency` | string | Required uppercase provider currency; no implicit conversion. |
| `message` | string | Bounded comment, empty when provider omits it. |
| `receivedAt`, `processedAt` | ISO timestamps | Server-generated processing metadata. |

SQLite `donations` uses composite uniqueness `(provider, event_id)`. The migration inserts all legacy event rows with provider `donationalerts` before replacing the old global primary key. Replaying an event with the same provider and ID has no side effect; matching IDs from different providers remain distinct.

## Donor and pumpkin ownership

- Existing `pumpkins.owner_key` remains unique.
- Existing DonationAlerts identity formats (`da:<provider-id>` and legacy `name:<normalized-name>`) remain resolvable.
- New provider IDs use provider-scoped owner keys, for example `donatex:<provider-id>` or `memealerts:<provider-id>`. Name-only fallback for new integrations is namespaced by provider.
- No cross-provider display-name matching or automatic account linking.
- The existing pumpkin customization and scene-position fields remain unchanged; new donations continue to update the owning pumpkin only according to existing server-side rules.

## Spawn settings

Add persisted values to the singleton `settings` record:

| Field | Type | Default | Validation |
|---|---|---:|---|
| `min_spawn_donation` | finite non-negative number | `0` | Reject invalid/negative values; compare only when event currency equals scene currency. |
| `spawn_command` | string | `!тыковка` | Trimmed, non-empty, bounded length; parsed as a literal prefix at the start of a message, case-insensitively. |

New-pumpkin transition requires all of: unique valid event, matching currency, amount at least the saved minimum, command prefix, and an available server-validated spawn position. Existing owners continue to receive qualifying same-currency totals without the spawn command. The defaults are specified as zero threshold and `!тыковка`; requiring the command for new pumpkins is an intentional change from the current spawn behavior.

## Customization catalog entry

The admin preview catalog is derived from the existing customization alias map; it is not separately persisted.

| Field | Type | Rules |
|---|---|---|
| `slot` | `skin`, `eyes`, `mouth`, `hat`, or `prop` | Existing shared-renderer contract; do not expose `accessory`. |
| `value` | canonical customization value | Must be an existing value from the server dictionary. |
| `keywords` | string array | Existing supported aliases for the canonical value. |
| `preview` | rendered character state | Local isolated instance; catalog interactions never change persisted or live scene state. |
