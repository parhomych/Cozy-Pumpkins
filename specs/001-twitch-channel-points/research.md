# Research Notes: Twitch Channel Points integration

## Decision 1: Use Twitch OAuth + authoritative server-side status

**Decision**: The broadcaster authenticates through the existing OAuth flow, but the app keeps a separate `authStatus` and `connectionStatus` value. Authorization proves the account is connected; live connection requires EventSub/WebSocket listener registration and successful heartbeat or subscription confirmation.

**Rationale**: The product contract explicitly forbids reporting a provider as live solely because OAuth succeeded. This separation prevents false positives and keeps DonationAlerts status independent.

**Alternatives considered**: Combining authorization and live status into one flag, or claiming success immediately after callback. Rejected because it creates a misleading UI and violates the constitution.

## Decision 2: Match Rewards by Twitch reward ID, never by title

**Decision**: The admin panel stores mappings from action name to exact reward ID. The redemption processor resolves the mapped action from reward ID only; display names and titles are informational UI data and cannot trigger gameplay.

**Rationale**: Reward names may be edited on Twitch and can collide with other rewards. Exact ID is the stable identifier that survives renames and is compatible with event deduplication.

**Alternatives considered**: Title-based matching or fuzzy matching. Rejected because it allows false positives and violates the requirement of exact reward mapping.

## Decision 3: Use EventSub redemption events as the authoritative event source

**Decision**: The Twitch integration listens for `channel.channel_points_custom_reward_redemption.add` events from EventSub and validates the incoming subscription payload before applying a reward action.

**Rationale**: This is the documented Twitch event for redemption delivery and matches the product requirement to react when a channel point reward is activated.

**Alternatives considered**: Polling the API for redemptions or relying on webhooks without validation. Rejected because polling adds delay and increased load, while unvalidated webhook flows invite duplicate or stale processing.

## Decision 4: Resolve ownership by Twitch user ID then normalized username

**Decision**: For each redemption event, the system looks up the pumpkin by `user_id` first and falls back to a normalized `user_login` when the ID is absent or not yet mapped. It never chooses a random pumpkin when none matches.

**Rationale**: Twitch user IDs are stable and unique. Username matching remains a fallback for legacy or partially populated records, but it must not be used to mutate a foreign pumpkin.

**Alternatives considered**: Matching by display name alone or choosing the nearest pumpkin automatically. Rejected because both are ambiguous and risk unwanted scene changes.

## Decision 5: Deduplicate by redemption ID and persist state in SQLite

**Decision**: The reward service inserts the redemption ID into a dedicated dedupe table before applying any scene changes. A second delivery with the same redemption ID is discarded as duplicate.

**Rationale**: The product requirement and schema specify that redemption IDs are uniqueness keys, and the app already treats donation event IDs as idempotent keys.

**Alternatives considered**: Check only in-memory cache or compare usernames. Rejected because reconnects and retries can revisit the same event after restart, which requires persistently stored deduplication.

## Outstanding unknowns

No unresolved functional decisions remain. The remaining work during implementation is execution detail: wiring the server-side Twitch client, event listener, reward catalog fetch, status reporting, and tests.
