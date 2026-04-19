# Zulip Embed

**Drop Zulip chat into any app in a single tag.** A framework-agnostic
Web Component, native React / React Native / Flutter wrappers, and a
headless TypeScript SDK — all Apache-2.0, all hitting the same Zulip
REST API so your data and your audit trail stay in your Zulip.

> **Status — v1.0.0, stable.** The core Web Components
> (`<zulip-chat>`, `<zulip-channel-list>`, `<zulip-topic-list>`,
> `<zulip-announcement>`), the headless `ZulipClient`, the React
> wrapper, and the Flutter package are all at v1.0.0 feature parity.
> React Native ships as `1.0.0-alpha` (plain-text rendering —
> see [package README](./packages/react-native/README.md)). SwiftUI +
> Compose are on the roadmap. The public API is frozen under semver.

<p align="center">
  <a href="https://amanagr.github.io/zulip-embed/">
    <strong>Live demo &amp; playground</strong>
  </a>
  &nbsp;·&nbsp;
  <a href="#quickstart">Quickstart</a>
  &nbsp;·&nbsp;
  <a href="#bundle-subpaths">Subpaths</a>
  &nbsp;·&nbsp;
  <a href="docs/ONBOARDING.md">Onboarding</a>
  &nbsp;·&nbsp;
  <a href="docs/ARCHITECTURE.md">Architecture</a>
  &nbsp;·&nbsp;
  <a href="#supported-zulip-features">Feature matrix</a>
</p>

## Why

- **One-line drop-in** via `<zulip-chat>` Custom Element — works in any
  framework, any bundler, or plain HTML.
- **Shadow-DOM isolated** so host CSS can't leak in or out.
- **Tiny critical path.** Subpath entries (`zulip-embed/chat`,
  `/channel-list`, `/topic-list`, `/announcement`, `/agent`, `/demo`)
  let you pay only for what you render. `zulip-embed/chat` ships at
  ~55 KB gzipped; the full `<zulip-announcement>` banner is ~18 KB.
- **Fully themeable** via `--zc-*` CSS variables (light + dark built in,
  live playground on the demo site).
- **Native SDKs, not WebViews.** Flutter and React wrappers render
  real platform widgets on top of the same transport layer. RN is an
  alpha preview.
- **Agent-native primitives.** `startAgentReply` streams tokens at
  60fps locally and broadcasts edits at ≤4 Hz; `MessagePart[]`
  renders tool calls, tool results, and inline confirmation widgets.
- **Apache-2.0** — safe to ship inside closed-source products.
- **No backend of ours.** Credentials stay in your app; requests go
  browser → your Zulip server directly.
- **Demo + snapshot modes** so you can develop offline and publish
  read-only embeds without credentials in the browser.

## Quickstart

Four tracks, pick the one that matches your stack. Before you start,
you need a Zulip server URL and an account the embed can authenticate
as — if you're setting that up from scratch, follow the step-by-step
[Onboarding guide](./docs/ONBOARDING.md).

### Track 1 — Vanilla HTML (unpkg `<script>` tag)

The smallest possible integration: paste one script tag and one
element into any HTML page.

```html
<script type="module" src="https://unpkg.com/zulip-embed"></script>

<zulip-chat
    server="https://chat.example.com"
    auth-token="{{ JWT from your backend — see docs/jwt.md }}"
    channel="general"
    topic="intros"
    theme="dark"
    brand-name="Acme Support"
></zulip-chat>
```

The unpkg URL serves the `zulip-embed` IIFE build (`dist/zulip-embed.iife.js`)
with every custom element registered — `<zulip-chat>`,
`<zulip-channel-list>`, `<zulip-topic-list>`, `<zulip-announcement>`.
If you want to cut the critical path, import subpath entries from
your bundler instead — see [Bundle subpaths](#bundle-subpaths).

### Track 2 — React

Install [`zulip-embed-react`](./packages/react/) for typed JSX wrappers

- the headless `useZulipChat` hook.

```bash
npm i zulip-embed zulip-embed-react
```

```tsx
"use client";
import {ZulipChat} from "zulip-embed-react";

export function SupportPage() {
    return (
        <ZulipChat
            server="https://chat.example.com"
            authToken={await fetchZulipAuthToken()}
            channel="general"
            theme="dark"
            brandName="Acme Support"
        />
    );
}
```

Prefer a headless integration? `useZulipChat(transport, scope)` returns
`{messages, status, sendMessage, loadOlder, client}` for bring-your-own-UI:

```tsx
"use client";
import {useMemo} from "react";
import {useZulipChat} from "zulip-embed-react";
import {ZulipTransport} from "zulip-embed";

export function InboxPane() {
    const transport = useMemo(
        () =>
            new ZulipTransport({
                serverUrl: "https://chat.example.com",
                authToken: await fetchZulipAuthToken(),
                scope: {channel: "general"},
            }),
        [],
    );
    const {messages, status, sendMessage} = useZulipChat(transport, {
        channel: "general",
    });
    return (
        <section>
            <header>Status: {status}</header>
            <ul>
                {messages.map((m) => (
                    <li key={m.id}>
                        <b>{m.senderFullName}</b>: {m.content}
                    </li>
                ))}
            </ul>
            <button onClick={() => sendMessage("hello!")}>Send</button>
        </section>
    );
}
```

Also ships [`<ZulipChannelList>`](./packages/react/src/zulip-channel-list.tsx)
and [`<ZulipTopicList>`](./packages/react/src/zulip-topic-list.tsx).

### Track 3 — React Native (alpha)

> **Alpha preview (`1.0.0-alpha`).** Plain-text rendering only.
> Reactions / typing / message-action UI not yet wired in the
> `<ZulipChatScreen>` widget. Headless `ZulipClient` works end-to-end.
> See [`packages/react-native/README.md`](./packages/react-native/README.md)
> for the full status matrix.

```bash
npm i zulip-embed zulip-embed-react-native
```

```tsx
import {ZulipChatScreen, ZulipTransport, DARK_THEME} from "zulip-embed-react-native";

const transport = new ZulipTransport({
    serverUrl: "https://chat.example.com",
    authToken: process.env.ZULIP_AUTH_TOKEN!,
    scope: {channel: "general"},
});

export default function SupportScreen() {
    return (
        <ZulipChatScreen
            transport={transport}
            scope={{channel: "general"}}
            theme={DARK_THEME}
            brandName="Acme Support"
        />
    );
}
```

### Track 4 — Flutter

Pure Dart widgets, no `WebView`. See [`packages/flutter/`](./packages/flutter/)
and the Flutter-web demo at
[`amanagr.github.io/zulip-embed/flutter/`](https://amanagr.github.io/zulip-embed/flutter/).

```dart
import 'package:zulip_embed/zulip_embed.dart';

ZulipChat(
  transport: ZulipTransport(
    serverUrl: Uri.parse('https://chat.example.com'),
    email: 'you@example.com',
    apiKey: '...',
  ),
  channel: 'general',
  topic: 'welcome',
  theme: ZulipTheme.dark,
)
```

Also ships `ZulipChannelList`, `ZulipTopicList`, and `ZulipAnnouncement`.

### Demo mode (no server required)

Works in any track. On the Web Component it's a single attribute:

```html
<zulip-chat demo channel="general" topic="welcome"></zulip-chat>
```

In React / Flutter / RN pass `new DemoTransport()` where you would
pass a live transport. The demo transport bundles seeded messages and
an echo bot — perfect for storybooks, tests, and offline development.

## Verified releases

Every tagged release publishes a signed npm package (npm provenance +
Sigstore) and a subresource-integrity (SRI) manifest covering every
file a browser is likely to load from `unpkg` or your own CDN. Pin the
SRI hash in your `<script>` tag so a compromised CDN can't slip a
rewritten bundle past the browser:

```html
<script
    type="module"
    src="https://unpkg.com/zulip-embed@VERSION/dist/zulip-embed.iife.js"
    integrity="sha256-…"
    crossorigin="anonymous"
></script>
```

SRI hashes and per-entry gzipped sizes for each release are published
in the signed artifact manifest on the
[GitHub Release page](https://github.com/amanagr/zulip-embed/releases)
and in `INTEGRITY.json` inside each npm tarball. The release workflow
([scripts/release.mjs](./scripts/release.mjs) computes the values,
[`.github/workflows/release.yml`](./.github/workflows/release.yml)
commits them back to the tag) also splices a per-version table into
this README between the `<!-- sri:start -->` / `<!-- sri:end -->`
markers on every tag push.

<!-- sri:start -->

_The verified-release table is populated by `scripts/splice-sri.mjs` on
tag push. For unreleased `main`, run `pnpm build && node
scripts/release.mjs` locally and read `dist/INTEGRITY.md`._

<!-- sri:end -->

## Bundle subpaths

The default entry (`zulip-embed`) imports everything and registers every
element — convenient but heavy. For production, import the subpath
entry you actually need. Sizes are static gzipped budgets enforced by
CI (`scripts/bundle-check.mjs`).

| Subpath                    | Registers                            | Gzip budget |
| -------------------------- | ------------------------------------ | ----------- |
| `zulip-embed/chat`         | `<zulip-chat>`                       | 60 KB       |
| `zulip-embed/channel-list` | `<zulip-channel-list>`               | 8 KB        |
| `zulip-embed/topic-list`   | `<zulip-topic-list>`                 | 8 KB        |
| `zulip-embed/announcement` | `<zulip-announcement>`               | 20 KB       |
| `zulip-embed/agent`        | `startAgentReply` helpers            | 5 KB        |
| `zulip-embed/demo`         | `DemoTransport`, `SnapshotTransport` | 28 KB       |
| `zulip-embed/all`          | everything (compat shim)             | —           |

Heavy dependencies (the emoji picker, the `DemoTransport` seed data,
the `SnapshotTransport` fixture loader) are dynamically imported
inside the custom elements, so they aren't pulled into the critical
path until the viewer opens a picker or the host opts into demo mode.

```ts
// Import only what you render:
import "zulip-embed/chat";
import "zulip-embed/channel-list";
```

## Attributes (`<zulip-chat>`)

| Attribute      | Required  | Description                                                                                                                                                                |
| -------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `demo`         | —         | Use an in-memory transport instead of a real Zulip server.                                                                                                                 |
| `snapshot-url` | —         | Load a pre-fetched JSON snapshot of messages instead of opening a live event queue. Implies read-only; no credentials in the browser. See [Snapshot mode](#snapshot-mode). |
| `server`       | live mode | Base URL of the Zulip server (e.g. `https://chat.zulip.org`).                                                                                                              |
| `auth-token`   | live mode | Short-lived JWT the SDK exchanges once for a scoped API key. Host page never sees the key. See [`docs/jwt.md`](./docs/jwt.md) for the exchange.                            |
| `channel`      | yes       | Channel name to scope the feed. Defaults to `general`.                                                                                                                     |
| `topic`        | no        | Topic inside the channel. Omit for a channel-wide view.                                                                                                                    |
| `theme`        | no        | `light` (default) or `dark`.                                                                                                                                               |
| `mode`         | no        | `inline` (default) or `floating` (bottom-right messenger).                                                                                                                 |
| `read-only`    | no        | Hide the composer and disable reaction toggles. Useful for web-public channels.                                                                                            |
| `brand-name`   | no        | Replaces the `#channel › topic` header with a product string (e.g. "Acme Support").                                                                                        |
| `brand-logo`   | no        | URL to a small logo shown next to the header text. http(s) or relative paths only — `javascript:` / `data:` / protocol-relative URIs are rejected.                         |

## Theming

All visual tokens are CSS variables on the component. Override them
from the host page:

```css
zulip-chat {
    --zc-color-accent: #ff5722;
    --zc-color-bg: #ffffff;
    --zc-color-surface: #f7f7f9;
    --zc-color-text: #111827;
    --zc-radius: 8px;
    --zc-height: 600px;
    --zc-font-family: "Inter", sans-serif;
    --zc-font-size: 14px;
    --zc-brand-logo-size: 24px;
}
```

Complete token list lives in [`src/styles.ts`](./src/styles.ts). The
[live playground](https://amanagr.github.io/zulip-embed/#playground)
exposes every token through a GUI and generates a copy-paste snippet.

## Snapshot mode

For public, read-only embeds where you don't want to ship API
credentials to the browser, point the component at a pre-fetched JSON
file instead of a live server:

```html
<zulip-chat
    snapshot-url="/snapshots/announce.json"
    channel="announce"
    topic="Zulip updates"
></zulip-chat>
```

The snapshot is a `{version: 1, messages: Message[], channels?, topics?}`
JSON payload produced by `scripts/fetch-announce-snapshot.mjs`. This
repo's Pages deployment runs that script every six hours against
chat.zulip.org and bakes the latest ~30 messages into the site.
Required secrets on the `github-pages` environment:

- `GH_ACTIONS_BOT_API_KEY` (secret) — Zulip API key for a **Generic bot**
  subscribed to the channel you want to snapshot. **Incoming-webhook
  bots won't work** — they return HTTP 401 on `/api/v1/messages` because
  they can only post, not read.
- `ZULIP_ANNOUNCE_EMAIL` (secret) — the bot's email.
- `ZULIP_ANNOUNCE_SERVER` (environment variable, optional) — defaults to
  `https://chat.zulip.org`.

If the secret is absent, CI falls back to the checked-in snapshot at
`demo/public/snapshots/announce-zulip-updates.json`, so the site
always deploys.

## Plug-and-play components

v1.0 ships a catalog of composable custom elements so you can drop any
subset of the Zulip web app's UI into your own product:

| Component              | Status         | Description                                                                      |
| ---------------------- | -------------- | -------------------------------------------------------------------------------- |
| `<zulip-chat>`         | done           | Full channel/topic feed + composer + reactions + typing + edit/delete            |
| `<zulip-channel-list>` | done           | Subscribed channels with unread / pin / color / mute; fires `channel-selected`   |
| `<zulip-topic-list>`   | done           | Topics inside a channel (newest-first), resolved markers; fires `topic-selected` |
| `<zulip-announcement>` | done           | Pinned-message banner; dismissible; fetches a single message by id               |
| `<zulip-dm-list>`      | v1.x (planned) | Direct-message pane                                                              |
| `<zulip-compose>`      | v1.x           | Standalone composer (drafts, scheduled send, file upload)                        |
| `<zulip-inbox>`        | v1.x           | Unreads grouped by channel > topic                                               |
| `<zulip-recent>`       | v1.x           | Recent conversations view                                                        |
| `<zulip-user-list>`    | v1.x           | Presence sidebar                                                                 |
| `<zulip-user-card>`    | v1.x           | Hover / click profile popover                                                    |
| `<zulip-search>`       | v1.x           | Advanced-filter search box + results                                             |
| `<zulip-message>`      | v1.x           | Single-message embed for quote-of-the-day widgets                                |

Each Web Component is mirrored by a typed React wrapper in
[`zulip-embed-react`](./packages/react/) as soon as it lands.

## Frameworks

| Framework                           | Status  | Package                                                |
| ----------------------------------- | ------- | ------------------------------------------------------ |
| Web Components (framework-agnostic) | done    | [`zulip-embed`](./src/)                                |
| React                               | done    | [`zulip-embed-react`](./packages/react/)               |
| React Native                        | alpha   | [`zulip-embed-react-native`](./packages/react-native/) |
| Flutter                             | done    | [`packages/flutter/`](./packages/flutter/)             |
| SwiftUI (iOS)                       | planned | `packages/swiftui/`                                    |
| Jetpack Compose (Android)           | planned | `packages/compose/`                                    |

## Architecture

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the transport
interface, scope model, event pipeline, and bundle strategy in depth.

```
┌──────────────────────────────────────────────────────────────────┐
│  Framework wrappers                                              │
│  ├── zulip-embed-react         (typed JSX over custom elements)  │
│  ├── zulip-embed-react-native  (FlatList-based; alpha)           │
│  └── zulip_embed (Flutter)     (pure Dart widgets)               │
├──────────────────────────────────────────────────────────────────┤
│  UI layer — Custom Elements + Shadow DOM (dynamic transport loading)│
│  ├── <zulip-chat>                                                │
│  ├── <zulip-channel-list>                                        │
│  ├── <zulip-topic-list>                                          │
│  └── <zulip-announcement>                                        │
├──────────────────────────────────────────────────────────────────┤
│  ZulipClient — state, subscriptions, event fan-out,              │
│                agent-reply streaming                             │
├──────────────────────────────────────────────────────────────────┤
│  Transport interface                                             │
│  ├── ZulipTransport      (REST + long-poll /events, JWT exchange)│
│  ├── DemoTransport       (in-memory, seeded, echo bot)           │
│  └── SnapshotTransport   (read-only, pre-fetched JSON)           │
└──────────────────────────────────────────────────────────────────┘
```

The headless SDK and the Web Components are split so framework
bindings (React, RN, Flutter, SwiftUI, Compose) can reuse the same
transport layer.

## Supported Zulip features

### Message rendering

Rich HTML returned by Zulip's server-side markdown renderer is run
through DOMPurify with a strict allow-list before it hits the DOM.
See [`SECURITY.md`](./SECURITY.md) for the threat model.

| Element                                                                   | Status  |
| ------------------------------------------------------------------------- | ------- |
| Paragraphs, headings (`h1`–`h6`), horizontal rules                        | done    |
| Bold, italic, strikethrough, underline                                    | done    |
| Inline code, fenced code blocks                                           | done    |
| Ordered + unordered lists (incl. nesting)                                 | done    |
| Blockquotes (incl. nested)                                                | done    |
| Tables with header row                                                    | done    |
| Links (http/https/mailto only, `rel="noopener noreferrer nofollow ugc"`)  | done    |
| Autolinked plain-text URLs                                                | done    |
| Inline images (relative paths resolved against `server`)                  | done    |
| Unicode emoji                                                             | done    |
| Custom Zulip emoji (`<img class="emoji">`)                                | done    |
| `@user` mentions, `#channel` references, `#channel > topic` links         | done    |
| Keyboard shortcuts (`<kbd>`), abbreviations, sub/sup                      | done    |
| Spoilers (click / keyboard reveal)                                        | done    |
| KaTeX math (lazy-loaded)                                                  | done    |
| Code-block syntax highlighting (Pygments classes)                         | done    |
| Structured `MessagePart[]` (text/code/tool_call/tool_result/confirmation) | done    |
| Polls                                                                     | planned |
| Widgets / custom message extensions                                       | planned |
| File / image attachment previews beyond `<img>`                           | planned |

### Live data & interaction

| Feature                                                    | Status         |
| ---------------------------------------------------------- | -------------- |
| Channel + topic scoped narrow                              | done           |
| Long-poll event queue via `/register` + `/events`          | done           |
| Send messages to channel                                   | done           |
| Message edits (live, incremental DOM update)               | done           |
| Message deletes (live)                                     | done           |
| Emoji reactions — read, add, remove (live)                 | done           |
| Avatar images (with initials fallback)                     | done           |
| Rich showcase + read-only `#announce` demos                | done           |
| Floating-messenger mode                                    | done           |
| Light + dark themes + branded header                       | done           |
| Typing indicators (send + receive, per-scope filtered)     | done           |
| Unread separator + "new messages" jump-to-bottom pill      | done           |
| Curated emoji reaction picker                              | done           |
| Message pagination (scroll-up loads older)                 | done           |
| Channel + topic enumeration (`listChannels`, `listTopics`) | done           |
| Streaming agent replies (`startAgentReply`)                | done           |
| Pinned-message banner (`<zulip-announcement>`)             | done           |
| JWT SSO handoff (`auth-token`)                             | done           |
| Direct messages                                            | v1.x (planned) |
| Presence (online/offline dots)                             | planned        |
| File uploads from the composer                             | planned        |
| Message search                                             | planned        |
| Unread counters, read receipts                             | planned        |
| Draft persistence                                          | planned        |

## Repository layout

```
zulip-embed/
├── src/                   # zulip-embed — Web Components + headless SDK
│   └── entries/           # subpath-entry files (chat, channel-list, …)
├── tests/                 # Vitest suite
├── demo/                  # Landing page + playground (this repo's Pages site)
├── scripts/               # CI snapshot fetchers, bundle-size checker
├── docs/                  # Developer documentation
│   ├── ONBOARDING.md      # step-by-step Zulip server + auth-token setup
│   ├── ARCHITECTURE.md    # transport / scope / event / bundle model
│   ├── TROUBLESHOOTING.md # error codes, CSP, bundle size, styling
│   ├── agents.md          # startAgentReply + MessagePart reference
│   ├── events.md          # CustomEvent catalog (detail shapes, triggers)
│   ├── theming.md         # --zc-* token table, brand-name/logo, pitfalls
│   ├── jwt.md             # JWT provisioning
│   └── migration-0.2.md   # 0.1 → 0.2 migration notes
├── packages/
│   ├── react/             # zulip-embed-react         (done)
│   ├── react-native/      # zulip-embed-react-native  (alpha)
│   └── flutter/           # zulip_embed               (done)
└── .github/workflows/     # CI: test, typecheck, build, deploy Pages, release
```

## Development

```bash
pnpm install
pnpm dev          # live demo at http://localhost:5173
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest
pnpm build        # produces dist/zulip-embed.js (ESM) + dist/zulip-embed.iife.js + subpath entries
pnpm check:bundle # verify per-subpath gzip budgets
pnpm build:site   # static landing page + playground into ./site
```

### React package

```bash
cd packages/react
pnpm typecheck
pnpm test
```

### React Native package

```bash
cd packages/react-native
pnpm typecheck
pnpm test
```

### Flutter package

```bash
cd packages/flutter
dart pub get
dart analyze
dart test
```

## Try it

- **Live demo + playground:** <https://amanagr.github.io/zulip-embed/>
- **Flutter demo:** <https://amanagr.github.io/zulip-embed/flutter/>
- **Source:** you're already here.

## Further reading

- [`docs/ONBOARDING.md`](./docs/ONBOARDING.md) — step-by-step Zulip
  server + auth-token setup for first-time users.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — transport
  interface, scope model, event pipeline, bundle strategy.
- [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) — error
  codes, CSP directives, bundle-size surprises, shadow-DOM styling.
- [`docs/agents.md`](./docs/agents.md) — `startAgentReply` streaming
  primitive, `MessagePart` union, confirmation widget orchestration.
- [`docs/events.md`](./docs/events.md) — canonical list of every
  `CustomEvent` the `<zulip-*>` elements dispatch.
- [`docs/theming.md`](./docs/theming.md) — `--zc-*` CSS custom-property
  table, brand-name/logo attributes, dark-mode mechanics.
- [`docs/jwt.md`](./docs/jwt.md) — minting auth tokens on your
  backend for the `auth-token` attribute.
- [`docs/migration-0.2.md`](./docs/migration-0.2.md) — 0.1 → 0.2
  migration notes.
- [`SECURITY.md`](./SECURITY.md) — threat model and reporting.
- [`CLAUDE.md`](./CLAUDE.md) — code conventions (including why this
  SDK always says "channel" instead of the legacy "stream").
- [`CHANGELOG.md`](./CHANGELOG.md) — release notes per version.

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
