# Data model: Twitch reward integration

## Entities

### Twitch connection

Represents the broadcaster account and provider status.

| Field | Type | Notes |
|---|---|---|
| provider | text | Fixed value `twitch` |
| authStatus | text | `Disconnected`, `Connected`, `Failed` |
| connectionStatus | text | `Disconnected`, `Listening`, `Retrying`, `Error` |
| accessTokenEnc | text | Stored encrypted server-side only |
| refreshTokenEnc | text | Stored encrypted server-side only |
| accountId | text | Stable Twitch user ID |
| accountLogin | text | Canonical username |
| lastUpdatedAt | ISO timestamp | Audit timestamp |

Validation rules:
- `provider` is unique and must be one of the supported providers.
- A user can be `Connected` to Twitch without `Listening` to EventSub.
- Token fields are never exposed to any browser, API response, or runtime log output.

### Reward mapping

Represents the admin-defined mapping between a Twitch reward and a gameplay action.

| Field | Type | Notes |
|---|---|---|
| action | text | One of `inflate`, `jump_on`, `morph_fly`, `bat`, `ghost` |
| rewardId | text | Stable Twitch reward identifier |
| rewardTitle | text | Display value for admin UI |
| cost | integer | Channel point cost as exposed by Twitch |
| isEnabled | boolean | Whether the mapping is active |
| updatedAt | ISO timestamp | Last admin modification |

Validation rules:
- `rewardId` is unique per mapped action.
- One reward ID may map to only one action.
- Reward titles are informational and cannot trigger an action without a matching reward ID.

### Redemption event

Represents a processed or rejected Twitch activation.

| Field | Type | Notes |
|---|---|---|
| redemptionId | text | Primary key, idempotency key |
| rewardId | text | Twitch reward ID |
| userId | text | Stable Twitch user ID |
| userLogin | text | Normalized login name |
| status | text | `processed`, `duplicate`, `ignored_reward`, `no_pumpkin_for_user`, `invalid_event` |
| receivedAt | ISO timestamp | Event ingestion time |
| processedAt | ISO timestamp | Action processing time |

Validation rules:
- `redemptionId` prevents repeated events from re-running the same action.
- A receipt with an unrecognized reward ID is ignored without mutating the scene.
- Events without the required identity fields are rejected and logged as invalid.

### Pumpkin identity linkage

Represents the connection between a pumpkin and a broadcaster viewer identity.

| Field | Type | Notes |
|---|---|---|
| pumpkinId | text | Pumpkin entity ID |
| twitchUserId | text | Stable identity for primary match |
| twitchUsername | text | Normalized username fallback |
| ownerNormalized | text | Fallback / normalized owner name for matching |

Validation rules:
- `twitchUserId` takes precedence over username matching.
- If no matching pumpkin exists, no action is applied and the event is recorded as `no_pumpkin_for_user`.

## State transitions

### Provider connection lifecycle

`Disconnected -> Authorizing -> Connected -> Listening` with possible transitions to `Retrying` or `Error`.

- `Disconnected`: no valid Twitch auth saved.
- `Connected`: OAuth authorized and token exists, but EventSub listener may still be unavailable.
- `Listening`: EventSub listener is active and receiving redemption events.
- `Error`: listener failure or token problem; no longer treated as live.

### Reward mapping lifecycle

`Unmapped -> Saved -> Active -> Updated/Disabled`.

- `Unmapped`: no ID stored for an action.
- `Saved`: mapping persisted to the database.
- `Active`: reward is available and eligible for a matching redemption.
- `Updated/Disabled`: mapping changed, cleared, or the reward is not available on the channel.

### Redemption lifecycle

`Received -> Inserted -> Processed` or `Rejected`.

- `Received`: event came through EventSub.
- `Inserted`: row written to dedupe table.
- `Processed`: action completed for the linked pumpkin.
- `Rejected`: invalid payload, no mapped reward, no pumpkin owner, or duplicate ID.

## Relationships

- One Twitch connection has many reward mappings.
- One pumpkin can have zero or one Twitch owner link.
- One redemption event is recorded once and may become `processed`, `duplicate`, or `ignored`.
- The reward mapping triggers action execution on exactly one pumpkin owner when the redemption is valid.
