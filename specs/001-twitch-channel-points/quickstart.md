# Quickstart validation guide

## Prerequisites

- Node.js 22.23.3 from `.nvmrc`
- Local project dependencies installed via `npm ci`
- Twitch app credentials in `.env` for `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `TWITCH_REDIRECT_URI`
- A broadcaster account with at least one custom channel point reward

## Setup

1. Copy `.env.example` to `.env` if needed.
2. Provide a Twitch app client ID, secret, and redirect URI.
3. Register the exact `TWITCH_REDIRECT_URI` value (default `http://localhost:3000/api/auth/twitch/callback`) in the Twitch developer console. Grant the `channel:read:redemptions` scope when authorizing.
4. Start the app with `npm start`.

## Verification scenarios

### Scene connection and reward catalog

1. Open the admin app and click the Twitch card.
2. Complete the OAuth flow.
3. Confirm the broadcaster account appears, authorization shows `Connected`, and the live state changes to `Listening` after EventSub subscribes.
4. Click **Refresh Twitch rewards** and verify channel rewards appear with their title, cost, and availability.

Expected result: the app displays the broadcaster account and reward metadata without exposing token values. OAuth success alone is not reported as live.

### Reward mapping and persistence

1. Assign each supported action (`inflate`, `jump_on`, `morph_fly`, `bat`, `ghost`) to a reward from the refreshed list, or leave it disabled.
2. Save the mapping.
3. Reload the admin page.

Expected result: the mapping persists by Twitch reward ID and remains associated with the same reward after a page refresh or server restart; each reward can be mapped to at most one action.

### Reward activation flow

1. Ensure the viewer is linked to a pumpkin (for example, by creating the pumpkin through a donation from that Twitch account).
2. Redeem the mapped channel point reward from that viewer's channel account.
3. Observe the effect in the admin preview and overlay.

Expected result: EventSub delivers the redemption and the mapped action runs once for the linked pumpkin; the effect is visible in both surfaces. Redemptions from unlinked viewers or rewards that are not mapped do not mutate the scene.

### Duplicate and invalid events

1. Run the offline duplicate-redemption test twice with the same mocked redemption ID.
2. Run the offline tests for unassigned rewards, missing viewer identity, and unlinked viewers.

Expected result: a repeated redemption ID is ignored; an unassigned or invalid event produces no scene mutation.

### Failure and recovery

1. Temporarily interrupt the WebSocket and confirm the live status changes to `Retrying`, then returns to `Listening`.
2. Revoke the subscription or invalidate OAuth and confirm the status reports `Error` with reconnect guidance.
3. Disconnect Twitch from the admin panel and confirm the Twitch listener stops while DonationAlerts remains connected.

Expected result: authorization and live-delivery states remain distinct; temporary interruptions retry automatically (up to eight attempts with a maximum 30-second delay). Revoked subscriptions and exhausted retries require a Twitch reconnect. Twitch logout clears local credentials even if remote revocation cannot be confirmed, and does not affect DonationAlerts.

## Automated checks

- `npm test` for the offline suite
- `npm run check` for backend entry-point validation
- `node --check public/js/admin-app.js` for the browser admin module
- Focused tests use mocked Helix/EventSub responses and do not require Twitch credentials, live channel rewards, or network access.
