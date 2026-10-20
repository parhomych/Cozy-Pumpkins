# Quickstart: Donation Platforms

This guide describes credential-free validation and the optional live-provider smoke test. Implementation details and event/settings shapes are in [data-model.md](./data-model.md) and [contracts/](./contracts/).

## Prerequisites

- Node.js 22.23.3 (`.nvmrc`)
- Dependencies installed with `npm ci`
- No external service or provider credential is needed for automated tests

## Offline validation

From the repository root, run:

```powershell
npm test
npm run check
node --check public/js/admin-app.js
```

Expected results:

- All existing and new tests pass without network access.
- Provider adapter tests verify payload mapping, event identity, reconnect and provider failure isolation through injected fakes.
- Donation tests verify duplicate events, provider-scoped IDs, migration preservation, currency/threshold/command behavior, owner updates, and server-validated spawn positions.
- Frontend tests verify settings validation/persistence wiring and that catalog previews do not mutate the live scene.

## Local UI smoke test

1. Start the app with `npm start` and sign in to the local admin panel.
2. Set a non-zero spawn threshold and a custom command, save, reload the panel, and verify both values remain.
3. Review the grouped customization keyword catalog. Select several preview values and verify the live scene and persisted pumpkins do not change.
4. In a non-production environment, use the existing donation simulator to submit a below-threshold event and a qualifying event with the configured command plus customization keywords. The simulator automatically includes the configured command; the missing-command case is covered by the offline engine tests.
5. Verify only the qualifying new-owner event creates a pumpkin; verify an existing owner donation still updates the existing pumpkin without the spawn command.

## Optional live-provider smoke test

1. Register provider OAuth clients and configure client ID, client secret, and the exact callback URL in server-only environment configuration. Do not paste credentials into the browser or commit them.
2. Start the app and connect each provider independently from the admin panel. Confirm account/auth state and realtime listening state are reported separately.
3. Send a low-value test event and a qualifying donation with the configured command; verify exactly one expected scene effect.
4. Restart the app or briefly interrupt one provider connection. Verify it reconnects and the other integrations remain operational.
5. Disconnect one provider and verify its local event loop stops while other providers remain connected. Do not infer or claim remote token revocation unless the provider confirms it.

Meme Alerts API credentials may require provider approval because its documentation describes the external API as under test. Live tests are optional and are not part of the offline acceptance gate.
