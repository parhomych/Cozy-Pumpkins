# Provider Lifecycle Contract

## Private server-side provider operations

Every provider exposes the same lifecycle shape to application composition:

| Operation | Behavior |
|---|---|
| `authorizationUrl(provider)` | Return provider OAuth URL with provider-bound, CSRF-protected `state`; fail clearly when client configuration is absent. |
| `callback(provider, code, state)` | Verify state, exchange the code, fetch provider identity, persist encrypted tokens, then start only that provider's event client. |
| `start(provider)` | Connect to the official provider transport, publish `Listening` only after a successful subscription, otherwise publish `Retrying`/`Error` for that provider. |
| `stop(provider)` | Stop the provider client and retries, delete its stored tokens when explicitly disconnected, and report remote revocation only if confirmed. |
| `status(provider)` | Return safe auth, live-connection, account, and diagnostic state; never include secrets. |

Provider transports:

| Provider | Authorization / delivery |
|---|---|
| DonationAlerts | Existing OAuth Authorization Code scaffolding; Centrifugo donation event channel. |
| DonatEx | OAuth with `donations.subscribe`; SignalR public donations hub; handle creation and rerun events idempotently. |
| Meme Alerts | OAuth Authorization Code with `oauth-user-show oauth-donation-subscribe`; Centrifugo v5 private donation channel and refreshed channel tokens. |

## Admin-visible status

The existing status response and Socket.IO `integration:status` event expose a separate status entry for each provider with:

```json
{
  "provider": "donatex",
  "authStatus": "Connected",
  "connectionStatus": "Listening",
  "account": "channel-name",
  "message": null
}
```

Only status/account metadata is public. OAuth access/refresh tokens, socket/channel tokens, and client secrets are excluded from API responses, Socket.IO payloads, browser storage, and normal logs.

## Spawn settings surface

The authenticated settings read/update contract and `scene:init`/`settings:updated` messages include `minSpawnDonation` and `spawnCommand`. The server rejects invalid values and retains the previous valid settings. The client catalog is read-only and uses the existing customization dictionary and shared renderer.
