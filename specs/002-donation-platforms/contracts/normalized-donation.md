# Normalized Donation Contract

## Adapter input to donation engine

Each provider adapter emits a normalized event to the existing backend donation path:

```json
{
  "provider": "donationalerts",
  "id": "provider-event-id",
  "ownerId": "provider-donor-id",
  "displayName": "Viewer",
  "username": "viewer",
  "amount": 100,
  "currency": "RUB",
  "message": "!тыковка ghost stars"
}
```

`provider` must be one of `donationalerts`, `donatex`, or `memealerts`. `id`, donor display identity, finite positive `amount`, and non-empty `currency` are required. Provider-specific event fields are not forwarded to the browser. Adapters must reject malformed events with safe provider-scoped diagnostics and must not log authorization headers, access/refresh tokens, or complete private event payloads.

The storage idempotency key is `(provider, id)`. Provider-specific ID collisions do not collide across providers. A DonatEx rerun with the original event ID is a duplicate and has no second donation effect.

## Donation processing behavior

- A same-currency donation for an existing provider-scoped owner updates that owner's existing pumpkin without requiring the spawn command.
- A new owner is spawned only when the event currency equals the scene currency, the amount meets `min_spawn_donation`, the comment begins with the configured command after leading whitespace (case-insensitively), and the server selects a safe position.
- Customization parsing begins after the configured command and accepts only current canonical values and aliases, including `prop`. Unknown words are ignored.
- A mismatched currency is not converted, does not satisfy the threshold, and does not increase the scene total.
- Uniqueness is recorded before scene mutation in the same database transaction.
