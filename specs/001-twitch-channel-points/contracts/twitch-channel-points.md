# Twitch Channel Points contract

## 1. OAuth entry points

### GET /api/auth/twitch

Starts the Twitch OAuth authorization flow for the broadcaster account. Requires an admin session.

**Response**:
- Redirect to the Twitch authorization URL when credentials are configured.
- `503` with `twitch_credentials_missing` when the app does not have a Twitch client configuration.

### GET /api/auth/twitch/callback

Handles the OAuth callback and stores the connection state server-side.

**Response**:
- Redirect to `/admin.html?oauth=connected` on success.
- `400` with `oauth_failed` when the callback is invalid or the state check fails.

### POST /api/auth/twitch/logout

Disconnects the Twitch provider and clears local auth state.

**Response**:
- JSON payload with `provider`, `authStatus`, and any confirmed revoke status.
- Never logs or returns tokens or client secrets.

## 2. Reward catalog

### GET /api/twitch/rewards

Returns the reward catalog for the connected broadcaster.

**Response payload**:

```json
{
  "rewards": [
    {
      "id": "reward_123",
      "title": "Inflate",
      "cost": 500,
      "isEnabled": true,
      "isUserInputRequired": false
    }
  ],
  "message": "Rewards loaded"
}
```

Expected behavior:
- If the provider is not connected, returns a clear not-connected message.
- If the reward request fails, surfaces a safe error message without exposing tokens.

## 3. EventSub payload contract

The app listens for the Twitch EventSub event `channel.channel_points_custom_reward_redemption.add`.

**Envelope**:

```json
{
  "metadata": {
    "message_id": "abc123",
    "message_type": "channel.channel_points_custom_reward_redemption.add",
    "message_timestamp": "2026-01-01T00:00:00Z",
    "subscription_type": "channel.channel_points_custom_reward_redemption.add",
    "subscription_version": "1"
  },
  "payload": {
    "event": {
      "id": "redemption_456",
      "user_id": "1234",
      "user_login": "viewer",
      "user_name": "Viewer",
      "reward": {
        "id": "reward_123",
        "title": "Inflate",
        "cost": 500,
        "is_user_input_required": false
      },
      "status": "unfulfilled",
      "user_input": "",
      "redeemed_at": "2026-01-01T00:00:00Z"
    }
  }
}
```

Validation rules:
- `event.id` is the idempotency key.
- `event.reward.id` is matched against the saved mapping and exact reward IDs only.
- `event.user_id` or `user_login` is required before resolving the pumpkin owner.
- Invalid or duplicate payloads are rejected without side effects.

## 4. Internal server contract

The reward processor emits a single `pumpkin:action` Socket.IO event when a reward successfully resolves to a pumpkin action.

```json
{
  "id": "pumpkin-42",
  "action": "inflate",
  "payload": {
    "durationSeconds": 5,
    "scale": 1.8,
    "pushes": [
      { "id": "pumpkin-43", "x": 200, "y": 900 }
    ]
  }
}
```

This event is broadcast after the server validates ownership, detects duplicates, and confirms the mapped reward is active.
