# Cozy Pumpkins

Cozy Pumpkins is a no-build Node.js OBS Browser Source widget: DonationAlerts, DonatEx, and Meme Alerts donations create and grow customizable pumpkins, Twitch Channel Points can trigger actions including the global Pumpkin tower, and the local admin panel edits the live 1920×1080 scene.

## Requirements

- Node.js `22.23.3` (see `.nvmrc`)
- npm
- Optional: OBS Studio with a Browser Source

## Setup

```bash
npm ci
cp .env.example .env
```

For local development, the generated development secrets are sufficient. Register each integration's OAuth application and configure its client ID, client secret, and exact callback URL in `.env`. Credentials and user tokens stay server-side; never paste them into the admin panel or commit them.

After authorizing Twitch, use the Channel Points section in the admin panel to refresh the broadcaster's reward list and assign rewards to Cozy Pumpkins actions, including the global Pumpkin tower. Mappings are saved by Twitch reward ID, so renaming a reward does not change its action. Authorization and the live redemption connection are shown separately: a connected account is not live until the EventSub listener is active.

The default Twitch callback is `http://localhost:3000/api/auth/twitch/callback`; register the exact value of `TWITCH_REDIRECT_URI`. Reward IDs do not need to be copied into `.env` when assigning actions in the admin panel. After a successful OAuth flow, the server starts the EventSub listener automatically; on server restart it attempts to restore the listener from the saved authorization.

Twitch authorization states are `Disconnected`, `Connected`, and `Failed`. Live-event states are `Disconnected`, `Listening`, `Retrying`, and `Error`. Temporary socket interruptions trigger bounded automatic retries (up to eight attempts, with delays capped at 30 seconds); an expired authorization or revoked subscription requires reconnecting Twitch. Twitch logout stops its listener and clears local credentials regardless of whether Twitch confirms remote token revocation. This does not disconnect DonationAlerts.

### Donation providers

The supported donation providers connect independently from the admin panel:

| Provider | OAuth configuration | Callback |
|---|---|---|
| DonationAlerts | `DA_CLIENT_ID`, `DA_CLIENT_SECRET`, `DA_REDIRECT_URI` | `http://localhost:3000/api/auth/donationalerts/callback` |
| DonatEx | `DONATEX_CLIENT_ID`, `DONATEX_CLIENT_SECRET`, `DONATEX_REDIRECT_URI` | `http://localhost:3000/api/auth/donatex/callback` |
| Meme Alerts | `MEMEALERTS_CLIENT_ID`, `MEMEALERTS_CLIENT_SECRET`, `MEMEALERTS_REDIRECT_URI` | `http://localhost:3000/api/auth/memealerts/callback` |

Set each redirect URI to the URL registered with that provider; the defaults shown above assume the app is reachable at `localhost:3000`. DonationAlerts and Meme Alerts use their Centrifugo event streams: the server obtains a private socket token, connects first, then uses Centrifugo's assigned client ID to request the private-channel token. DonationAlerts documents Centrifugo 2.2.1's legacy JSON protocol; both providers use a compatible legacy client to avoid sending unsupported modern protocol frames. DonatEx uses its public SignalR donations hub. OAuth authorization and live-event delivery are reported separately. On restart, the server restores each provider from its saved authorization, and a failure or logout of one provider does not stop the others. Meme Alerts API access may require provider approval because the public API is still described as under test.

DonationAlerts and Meme Alerts logout disconnects and deletes the local token; it does not claim that the provider revoked access remotely. DonatEx remote revocation is reported only when the provider confirms it. The Twitch login and Channel Points controls remain independent of donation connections.

In **Donation spawn and growth rules**, set the minimum donation in the configured scene currency and the command required at the start of a message. Defaults are `0` and `!тыковка`. New viewers need one same-currency donation meeting the threshold plus the command to create a pumpkin; listed Russian/English customization keywords after the command set its appearance. Existing owners' same-currency donations continue to grow their pumpkin without the command. Other currencies are not converted or counted.

The same section shows four isolated pumpkin previews and cumulative donor-total thresholds for stages two through four. Defaults are `300`, `1000`, and `3000` in the scene currency. Values must be finite, non-negative, and strictly increasing. These saved thresholds control donation-driven evolution and are separate from the minimum amount for creating a pumpkin. Dense integration, scene, reward, and inspector controls can be collapsed without clearing their current values. The **Live preview** stays visible in a responsive 16:9 frame.

## Run

```bash
npm start
```

Open `http://localhost:3000/admin.html` for the control panel. Add `http://localhost:3000/overlay.html` as a transparent OBS Browser Source at **1920 × 1080**. The browser files are served directly by Express; there is no frontend build step or CDN dependency.

The development-only donation simulator appears in the admin panel when `NODE_ENV` is not `production`. It exercises the same server-side donation path and deduplication logic as an integration event. The Twitch reward section also exposes a local **Test Pumpkin tower activation** button that runs the global tower animation without Twitch credentials or a real redemption.
The tower's fall delay can be randomized by setting minimum and maximum seconds in **Scene settings → Pumpkin tower animation**. Each activation chooses one delay on the server and shares it between the admin preview and OBS.
The same section lets you choose whether tower layers are filled in a random pumpkin order or from largest to smallest; random is the default.

## Test and checks

```bash
make test
npm run check
```

`make test` is the single offline test command. The test suite uses an in-memory SQLite database and mocked OAuth/realtime clients; it does not require Twitch, donation-provider credentials, or network access.

## Configuration and security

- Keep real values only in `.env`; never commit it, provider tokens, or `data/*.sqlite`.
- The overlay receives scene state and animation events only. OAuth secrets and token storage are server-only.
- The backend validates coordinates against the 1920×1080 scene and No-Go Zone. Drag intermediate positions are broadcast but only the final validated position is persisted.
- Donation event IDs are unique per provider and Twitch redemption IDs are unique in SQLite, so retries do not repeat effects.
- Donation totals only accumulate in the scene currency; there is no automatic exchange-rate conversion.
- Twitch rewards are matched by exact reward ID; ordinary actions run only for the pumpkin linked to the redeeming viewer, while the global Pumpkin tower action intentionally affects every active pumpkin.
- Twitch logout uses the official revoke endpoint and reports success only after the provider confirms it. DonationAlerts logout is explicitly local unless a documented remote revoke mechanism is verified.
- OAuth client secrets, access/refresh tokens, and realtime channel tokens are never exposed to browser payloads or normal logs.
- Offline verification uses mocked provider API, WebSocket, and SignalR responses; `make test` does not require provider credentials or a network connection.

## Project layout

- `server.js` — Express/Socket.IO entrypoint.
- `src/` — configuration, SQLite persistence, business rules, auth scaffolding, HTTP API, and Socket.IO handlers.
- `public/js/shared/` — renderer and `PumpkinCharacter`, shared by admin preview and OBS overlay.
- `public/assets/pumpkin-reference.svg` — supplied reference pumpkin artwork, loaded locally and split into animation layers at runtime.
- `public/admin.html` — scene editor, search, inspector, No-Go Zone controls, and provider statuses.
- `public/overlay.html` — transparent OBS Browser Source.
- `Cozy_Pumpkins_SDD_Specification.md` — product contract and acceptance scenarios.

## Docker

```bash
docker build -t cozy-pumpkins .
docker run --rm -p 3000:3000 --env-file .env -v "$(pwd)/data:/app/data" cozy-pumpkins
```

The volume keeps SQLite state across container replacement. For a public deployment, use HTTPS and add a real admin access boundary; the MVP is designed for a local host.
