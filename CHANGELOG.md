# Changelog

All notable changes to `zulip-embed` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to semantic versioning.

## 0.8.0 — 2026-04-19

Sprint 5 release: pinned banners, React Native alpha, signed releases,
and a rewritten developer-documentation surface. Additive over
`0.8.0-rc.0` — no breaking changes. See
[`MIGRATION.md`](./MIGRATION.md) for the 0.7 → 0.8 upgrade walkthrough
and [`docs/RELEASING.md`](./docs/RELEASING.md) for the release
playbook.

### Added

- **`<zulip-announcement>`** — pinned-banner custom element that
  fetches a single message by id and renders it as a dismissible
  banner at the top of the embed. Emits a `announcement-dismissed`
  `CustomEvent` on the host when the viewer closes it. Ships with
  Flutter parity as the `ZulipAnnouncement` widget.
- **New subpath entry `zulip-embed/announcement`** — registers only
  `<zulip-announcement>`, ~18 KB gzipped. Added alongside the
  existing `/chat`, `/channel-list`, `/topic-list`, `/agent`, and
  `/demo` subpaths.
- **React Native alpha package** (`zulip-embed-react-native@0.8.0-rc.0-alpha`)
  — plain-text `<ZulipChatScreen>`, bundled `ZulipClient` /
  `ZulipTransport` / `DemoTransport`. Ships a one-time
  `console.warn` in `__DEV__` to flag alpha status. See
  [`packages/react-native/README.md`](./packages/react-native/README.md)
  for the per-feature status matrix and headless-client fallback.
- **Signed release manifest** — `scripts/release.mjs` produces
  `dist/INTEGRITY.json` (machine-readable sha256 + gzipped sizes per
  artifact) and `dist/INTEGRITY.md` (ready-to-paste SRI table) after
  every `pnpm build`. README gains a "Verified releases" section
  documenting how to pin bundles with `<script integrity="...">`.
- **CI-spliced SRI hashes** — `.github/workflows/release.yml` runs
  `scripts/splice-sri.mjs` on tag push, replacing the README's
  `<!-- sri:start --> … <!-- sri:end -->` block with the real hashes
  for the tag and committing the update back to `main`.
- **npm provenance** — every publishable workspace now carries
  `publishConfig: {access: "public", provenance: true}`, so
  Sigstore provenance is enforced even when an operator publishes
  manually. The release workflow runs with `NPM_CONFIG_PROVENANCE=true`.
- **Developer documentation** — new
  [`docs/ONBOARDING.md`](./docs/ONBOARDING.md) (zero-to-live-embed
  walkthrough) and [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
  (transport / scope / event / bundle deep dive). README rewritten
  into four quickstart tracks (vanilla HTML, React, React Native
  alpha, Flutter) with links out to both new docs.

### Changed

- **README** — rewritten to reflect the v0.8 surface (the
  `<zulip-announcement>` element, RN alpha status, subpath entries,
  the "Verified releases" table, and links to the new onboarding +
  architecture docs).
- **Bundle-size gates** — `scripts/bundle-check.mjs` now also
  enforces the `entries/announcement.js` budget (20 KB gz).

### Fixed

- No user-visible bug fixes since `0.8.0-rc.0`. Fixes that landed
  earlier in the 0.8 cycle are listed in that entry.

### Dependencies

- No dependency changes.

### Package versions

- `zulip-embed` → `0.8.0`
- `zulip-embed-react` → `0.8.0`
- `zulip-embed-react-native` → `0.8.0-alpha` (narrower surface; API
  may still move before 1.0 without a major-version bump)
- `zulip_embed` (Flutter) → `0.8.0`

## 0.8.0-rc.0 — 2026-04-19

Sprint 4 release: surface area + distribution. First release candidate;
unchanged API contract from 0.6 except where noted.

### Added

- **Subpath entries.** `zulip-embed/chat`, `/channel-list`,
  `/topic-list`, `/agent`, `/demo`, `/element`, `/all` each register
  exactly the custom elements or SDK helpers they name. The default
  `.` entry stays the register-everything shim for back-compat.
- **Per-subpath gzip budgets.** `scripts/bundle-check.mjs` walks each
  entry's static transitive graph and fails CI on regressions. Wired
  into GitHub Pages deploy.
- **`.github/workflows/release.yml`.** Topological `pnpm publish` to
  npm (`zulip-embed` → `-react` → `-react-native`). Dry-run by default
  from the Actions UI; `v*` tag push runs live after `NPM_TOKEN` is
  provisioned.

### Changed

- **Package name for the React wrapper is `zulip-embed-react`** (was
  `@zulip/react` in the internal 0.4 draft). React Native is
  `zulip-embed-react-native`. Unscoped because the `@zulip` npm scope
  is not controlled by this project.
- **Dynamic transport loading.** `<zulip-chat>`, `<zulip-channel-list>`,
  and `<zulip-topic-list>` lazy-load `DemoTransport`,
  `SnapshotTransport`, `ZulipTransport`, and `createEmojiPicker` on
  first demand. A live-mode embed no longer pays for the demo fixture
  surface, and vice versa. Net effect on static per-subpath gzip:
  `/chat` 66KB → 55KB, `/channel-list` 32KB → 4KB, `/topic-list`
  32KB → 4KB.

### Notes

- First RC to be published to the npm registry. Consumers should
  expect a follow-up RC once the registry round-trip surfaces any
  `exports` / `types` resolution quirks.

## 0.6.0 — 2026-04-19

Sprint 3 release: agent-native primitives.

### Added

- **`Message.parts?: MessagePart[]`** — discriminated union of
  `text` / `code` / `tool_call` / `tool_result` / `confirmation`
  variants. `renderContent` prefers `parts` over `content` when
  present.
- **`ZulipClient.startAgentReply`** — streaming primitive that
  local-echoes tokens at 60fps and broadcasts edits at ≤4Hz via a
  trailing-edge 250ms debounce. Abort lands a terminal edit with a
  sentinel `tool_result`. Transport gained `sendMessageWithId()` for
  synchronous id handoff.
- **`ConfirmationMessagePart`** — inline confirm-before-tool-call
  widget with idempotent double-click guard. Re-emits a composed
  `zulip-confirmation-response` `CustomEvent` on the host.
- **`Message.author`** — `{kind: "human" | "agent", agentModel?}`.
  Agent-authored rows get a gradient avatar and "AI" badge.
- **Flutter parity** for Sprint 1 discriminated unions.

## 0.4.0 — 2026-04-19

Sprint 2 release: events + React hook.

### Added

- **`zulip-embed-react` package** — `useZulipChat(transport, scope)`
  hook, `<ZulipChat>` / `<ZulipChannelList>` / `<ZulipTopicList>`
  wrappers, and headless `ZulipClient` passthrough.
- **`ZulipClient` event API** — subscribe/unsubscribe model for
  `message` / `message-update` / `message-delete` / `reaction` /
  `connection-change` / `error` events, plus typed host CustomEvents.
- **`<zulip-channel-list>` and `<zulip-topic-list>`** — standalone
  custom elements with demo + snapshot + live modes.
- **Compose bar parity** with the Zulip web app (bold / italic /
  code / link / quote / list / spoiler / mention / emoji picker).
- **Open-in-Zulip message actions** — kebab dropdown with
  configurable `message-actions` attribute.
- **React Native package** (`zulip-embed-react-native`) — subset
  of the Web Component: plain-text message list, compose, typing.
- **KaTeX lazy math rendering, spoiler reveal, syntax highlighting.**
- **Snapshot transport** — read-only embeds backed by a baked JSON
  file. Used for the chat.zulip.org #announce feed on the demo site.

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
