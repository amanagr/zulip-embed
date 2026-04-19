# Changelog

All notable changes to `@zulip/embed` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to semantic versioning.

## 0.2.0 — 2026-04-19

Sprint 1 release: auth + types foundation.

### Breaking

- **Message type is now a discriminated union.** `Message.channelName` and
  `Message.topic` only exist on `Message` values where `type === "channel"`.
  DMs are represented as `{type: "direct", recipients: User[], ...}`.
  Consumers that read `message.channelName` must narrow on `message.type`
  first.
- **`SendMessageParams` is discriminated by `type`.** Callers of
  `transport.sendMessage(...)` now pass either
  `{type: "channel", channel, topic, content}` or
  `{type: "direct", recipients, content}`. The previous "optional every
  field" shape is gone — missing topics on channel sends are now a compile
  error.
- **`EditMessageParams` is discriminated by `kind`.** Use
  `{kind: "content", content}`, `{kind: "topic", topic}`, or
  `{kind: "both", content, topic}`. Editing neither (`{}`) is no longer
  expressible, eliminating the dead code path.
- **`ErrorEvent.code: ErrorCode` is now required.** Listeners that only
  read `event.error` keep working, but anyone routing on the event shape
  should switch on `event.code`. Codes: `"unauthorized" |
  "channel-not-subscribed" | "network" | "rate-limited" |
  "jwt-not-configured" | "unknown"`.

### Added

- **JWT handoff via `auth-token`.** `<zulip-chat auth-token="...">`
  exchanges a short-lived JWT for an API key through
  `POST /api/internal/jwt/fetch_api_key`. The JWT lives in closure
  afterwards — no long-lived Zulip credential touches the DOM.
  `<zulip-channel-list>` and `<zulip-topic-list>` accept the same
  attribute.
- **`ZulipClient.whenReady: Promise<User>`.** Resolves once the
  transport has fetched the current user record. Prefer over
  `getCurrentUserId()` when you need email / full name / avatar.
- **`Transport.getCurrentUser()`.** Returns the full `User` record.
  `DemoTransport`, `SnapshotTransport`, and `ZulipTransport` all
  implement it; `SnapshotTransport` rejects (anonymous reads have no
  viewer).
- **`ConnectionEvent.status === "reconnecting"`** with `{attempt,
  delayMs, reason}`. Emitted by `ZulipTransport.pollLoop` with
  decorrelated-jitter backoff (1s base, 30s cap). Once the event queue
  recovers a `"connected"` event is dispatched so UI banners can clear.
- **HTTP error classification.** 401 → `unauthorized`; 403 + "Not
  subscribed" → `channel-not-subscribed`; 429 → `rate-limited`
  (`retryAfterMs` populated from `Retry-After`); 404 from the JWT
  endpoint → `jwt-not-configured`; `TypeError` from `fetch` →
  `network`.

### Deprecated

- **`api-key` and `email` attributes on `<zulip-chat>`,
  `<zulip-channel-list>`, and `<zulip-topic-list>`.** Still accepted
  for local development with a console warning at mount time. Will be
  removed in the 1.0 release. See `docs/migration-0.2.md` for the
  recommended server-side JWT minting flow.

### Notes

- Flutter package parity for the discriminated union changes lands in
  the same sprint — the domain model stays lockstep across TS and Dart.
