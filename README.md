# Zulip Embed

**Drop Zulip chat into any app in a single tag.** A framework-agnostic
Web Component, native React / React Native / Flutter wrappers, and a
headless TypeScript SDK — all Apache-2.0, all hitting the same Zulip
REST API so your data and your audit trail stay in your Zulip.

> **Status — v0.1 developer preview.** Web Component, headless SDK,
> Flutter, React, and React Native are all shipping. SwiftUI + Compose
> are on the roadmap. The public API may still move before 1.0.

<p align="center">
  <a href="https://amanagr.github.io/zulip-embed/">
    <strong>▶ Live demo &amp; playground</strong>
  </a>
  &nbsp;·&nbsp;
  <a href="#quick-start">Quick start</a>
  &nbsp;·&nbsp;
  <a href="#frameworks">Frameworks</a>
  &nbsp;·&nbsp;
  <a href="#theming">Theming</a>
  &nbsp;·&nbsp;
  <a href="#supported-zulip-features">Feature matrix</a>
</p>

## Why

- **One-line drop-in** via `<zulip-chat>` Custom Element — works in any
  framework, any bundler, or plain HTML.
- **Shadow-DOM isolated** so host CSS can't leak in or out.
- **Fully themeable** via `--zc-*` CSS variables (light + dark built in,
  live playground on the demo site).
- **Native SDKs, not WebViews.** Flutter, React, React Native wrappers
  all render real platform widgets on top of the same transport layer.
- **Apache-2.0** — safe to ship inside closed-source products.
- **No backend of ours.** Credentials stay in your app; requests go
  browser → your Zulip server directly.
- **Demo + snapshot modes** so you can develop offline and publish
  read-only embeds without credentials in the browser.

## Quick start

### 1. Script tag (any site)

```html
<script type="module" src="https://unpkg.com/@zulip/embed"></script>

<zulip-chat
    server="https://chat.example.com"
    email="you@example.com"
    api-key="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    channel="general"
    topic="intros"
    theme="dark"
    brand-name="Acme Support"
></zulip-chat>
```

### 2. React — [`@zulip/react`](./packages/react/)

```tsx
import {ZulipChat} from "@zulip/react";

export function SupportPage() {
    return (
        <ZulipChat
            server="https://chat.example.com"
            email="you@example.com"
            apiKey={import.meta.env.VITE_ZULIP_KEY}
            channel="general"
            theme="dark"
            brandName="Acme Support"
        />
    );
}
```

Includes `<ZulipChat>`, `<ZulipChannelList>`, and `<ZulipTopicList>`
— all thin wrappers over the Web Components with idiomatic camelCase
props and typed event callbacks.

### 3. React Native — [`@zulip/react-native`](./packages/react-native/)

```tsx
import {ZulipChatScreen, ZulipTransport, DARK_THEME} from "@zulip/react-native";

const transport = new ZulipTransport({
    server: "https://chat.example.com",
    email: "you@example.com",
    apiKey: process.env.ZULIP_KEY!,
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

Pure React Native — `FlatList` + `TextInput` + `KeyboardAvoidingView`.
No WebView, no browser bridge.

### 4. Flutter — [`packages/flutter/`](./packages/flutter/)

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

Pure Dart widgets (no WebView). The [`example/`](./packages/flutter/example/)
app is compiled to Flutter web as part of CI and published at
[`amanagr.github.io/zulip-embed/flutter/`](https://amanagr.github.io/zulip-embed/flutter/).

### 5. Headless SDK — `@zulip/embed`

When you want full control over the UI:

```ts
import {ZulipClient, ZulipTransport} from "@zulip/embed";

const client = new ZulipClient({
    transport: new ZulipTransport({
        serverUrl: "https://chat.example.com",
        email: "bot@example.com",
        apiKey: "xxxx",
        scope: {channel: "general", topic: "support"},
    }),
});
await client.connect();
client.subscribe((event) => {
    if (event.type === "message") console.log(event.message);
});
```

### 6. Demo mode (no server required)

```html
<zulip-chat demo channel="general" topic="welcome"></zulip-chat>
```

The `demo` attribute swaps in an in-memory transport with seeded
messages and an echo bot. Perfect for storybooks, tests, and offline
development.

## Attributes (`<zulip-chat>`)

| Attribute      | Required  | Description                                                                                                                                                                |
| -------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `demo`         | —         | Use an in-memory transport instead of a real Zulip server.                                                                                                                 |
| `snapshot-url` | —         | Load a pre-fetched JSON snapshot of messages instead of opening a live event queue. Implies read-only; no credentials in the browser. See [Snapshot mode](#snapshot-mode). |
| `server`       | live mode | Base URL of the Zulip server (e.g. `https://chat.zulip.org`).                                                                                                              |
| `email`        | live mode | Account email or bot email.                                                                                                                                                |
| `api-key`      | live mode | API key for that account.                                                                                                                                                  |
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

v1 ships a catalog of composable custom elements so you can drop any
subset of the Zulip web app's UI into your own product:

| Component              | Status | Description                                                                      |
| ---------------------- | ------ | -------------------------------------------------------------------------------- |
| `<zulip-chat>`         | ✅     | Full channel/topic feed + composer + reactions + typing + edit/delete            |
| `<zulip-channel-list>` | ✅     | Subscribed channels with unread / pin / color / mute; fires `channel-selected`   |
| `<zulip-topic-list>`   | ✅     | Topics inside a channel (newest-first), resolved markers; fires `topic-selected` |
| `<zulip-compose>`      | ⏳     | Standalone composer (drafts, scheduled send, file upload)                        |
| `<zulip-inbox>`        | ⏳     | Unreads grouped by channel > topic                                               |
| `<zulip-recent>`       | ⏳     | Recent conversations view                                                        |
| `<zulip-dm-list>`      | ⏳     | Direct-message pane                                                              |
| `<zulip-user-list>`    | ⏳     | Presence sidebar                                                                 |
| `<zulip-user-card>`    | ⏳     | Hover / click profile popover                                                    |
| `<zulip-search>`       | ⏳     | Advanced-filter search box + results                                             |
| `<zulip-message>`      | ⏳     | Single-message embed for quote-of-the-day widgets                                |

Each Web Component is mirrored by a typed React wrapper in
[`@zulip/react`](./packages/react/) as soon as it lands.

## Frameworks

| Framework                           | Status     | Package                                    |
| ----------------------------------- | ---------- | ------------------------------------------ |
| Web Components (framework-agnostic) | ✅         | [`@zulip/embed`](./src/)                   |
| React                               | ✅         | [`@zulip/react`](./packages/react/)        |
| React Native                        | ✅         | [`@zulip/react-native`](./packages/react-native/) |
| Flutter                             | ✅         | [`packages/flutter/`](./packages/flutter/) |
| SwiftUI (iOS)                       | ⏳ planned | `packages/swiftui/`                        |
| Jetpack Compose (Android)           | ⏳ planned | `packages/compose/`                        |

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Framework wrappers                                              │
│  ├── @zulip/react           (typed JSX over custom elements)     │
│  ├── @zulip/react-native    (FlatList-based ZulipChatScreen)     │
│  └── zulip_embed (Flutter)  (pure Dart widgets)                  │
├──────────────────────────────────────────────────────────────────┤
│  UI layer — Custom Elements + Shadow DOM                         │
│  ├── <zulip-chat>                                                │
│  ├── <zulip-channel-list>                                        │
│  └── <zulip-topic-list>                                          │
├──────────────────────────────────────────────────────────────────┤
│  ZulipClient — state, subscriptions, event fan-out               │
├──────────────────────────────────────────────────────────────────┤
│  Transport interface                                             │
│  ├── ZulipTransport      (REST + long-poll /events)              │
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

| Element                                                                  | Status |
| ------------------------------------------------------------------------ | ------ |
| Paragraphs, headings (`h1`–`h6`), horizontal rules                       | ✅     |
| Bold, italic, strikethrough, underline                                   | ✅     |
| Inline code, fenced code blocks                                          | ✅     |
| Ordered + unordered lists (incl. nesting)                                | ✅     |
| Blockquotes (incl. nested)                                               | ✅     |
| Tables with header row                                                   | ✅     |
| Links (http/https/mailto only, `rel="noopener noreferrer nofollow ugc"`) | ✅     |
| Autolinked plain-text URLs                                               | ✅     |
| Inline images (relative paths resolved against `server`)                 | ✅     |
| Unicode emoji                                                            | ✅     |
| Custom Zulip emoji (`<img class="emoji">`)                               | ✅     |
| `@user` mentions, `#channel` references, `#channel > topic` links        | ✅     |
| Keyboard shortcuts (`<kbd>`), abbreviations, sub/sup                     | ✅     |
| Spoilers (click / keyboard reveal)                                       | ✅     |
| KaTeX math (lazy-loaded)                                                 | ✅     |
| Code-block syntax highlighting (Pygments classes)                        | ✅     |
| Polls                                                                    | ❌     |
| Widgets / custom message extensions                                      | ❌     |
| File / image attachment previews beyond `<img>`                          | ❌     |

### Live data & interaction

| Feature                                                    | Status    |
| ---------------------------------------------------------- | --------- |
| Channel + topic scoped narrow                              | ✅        |
| Long-poll event queue via `/register` + `/events`          | ✅        |
| Send messages to channel                                   | ✅        |
| Message edits (live, incremental DOM update)               | ✅        |
| Message deletes (live)                                     | ✅        |
| Emoji reactions — read, add, remove (live)                 | ✅        |
| Avatar images (with initials fallback)                     | ✅        |
| Rich showcase + read-only `#announce` demos                | ✅        |
| Floating-messenger mode                                    | ✅        |
| Light + dark themes + branded header                       | ✅        |
| Typing indicators (send + receive, per-scope filtered)     | ✅        |
| Unread separator + "new messages" jump-to-bottom pill      | ✅        |
| Curated emoji reaction picker                              | ✅        |
| Message pagination (scroll-up loads older)                 | ✅        |
| Channel + topic enumeration (`listChannels`, `listTopics`) | ✅        |
| Direct messages                                            | ❌ (v0.5) |
| Presence (online/offline dots)                             | ❌        |
| File uploads from the composer                             | ❌        |
| Message search                                             | ❌        |
| Unread counters, read receipts                             | ❌        |
| Draft persistence                                          | ❌        |

## Repository layout

```
zulip-embed/
├── src/                   # @zulip/embed — Web Components + headless SDK
├── tests/                 # Vitest suite (276 tests)
├── demo/                  # Landing page + playground (this repo's Pages site)
├── scripts/               # CI snapshot fetchers
├── packages/
│   ├── react/             # @zulip/react         (done)
│   ├── react-native/      # @zulip/react-native  (done)
│   └── flutter/           # zulip_embed          (done)
└── .github/workflows/     # CI: test, typecheck, build, deploy Pages
```

## Development

```bash
pnpm install
pnpm dev          # live demo at http://localhost:5173
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest (276 tests)
pnpm build        # produces dist/zulip-embed.js (ESM) + dist/zulip-embed.iife.js
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
```

### Flutter package

```bash
cd packages/flutter
dart pub get
dart analyze
dart test
```

## Roadmap

**v1.0 — Component + framework parity**

1. ✅ Sanitized HTML rendering (DOMPurify) + KaTeX math
2. ✅ Live message edits, deletes, reactions, typing
3. ✅ Message pagination + unread separator
4. ✅ Flutter parity (live chat, edit/delete, typing, snapshot)
5. ✅ `Transport.listChannels()` + `listTopics()` primitives
6. ✅ `<zulip-channel-list>` + `<zulip-topic-list>` components
7. ✅ React wrapper package (`@zulip/react`)
8. ✅ React Native package (`@zulip/react-native`)
9. ✅ Branded header (`brand-name`, `brand-logo`) + theming playground
10. ⏳ Composer file / image upload (multipart to `/user_uploads`)
11. ⏳ Direct messages, presence, search, inbox/recent views
12. ⏳ JWT SSO handoff (replace HTML-attribute `api-key`)
13. ⏳ SwiftUI + Compose native SDKs
14. ⏳ Publish to npm + pub.dev; dedicated developer-docs site

See [`SECURITY.md`](./SECURITY.md) for the threat model and
[`CLAUDE.md`](./CLAUDE.md) for code conventions (including why this
SDK always says "channel" instead of the legacy "stream").

## Try it

- **Live demo + playground:** <https://amanagr.github.io/zulip-embed/>
- **Flutter demo:** <https://amanagr.github.io/zulip-embed/flutter/>
- **Source:** you're already here.

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
