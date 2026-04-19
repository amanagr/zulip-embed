# Zulip Embed

Embed Zulip chat in any web app as a framework-agnostic Web Component, or
build on the headless TypeScript SDK if you want full control of the UI.

- **One-line drop-in** via `<zulip-chat>` Custom Element.
- **Shadow-DOM isolated** so host CSS can't leak in or out.
- **Themeable** via CSS variables (light + dark built in).
- **Apache-2.0** — safe to ship in closed-source products.
- **Demo mode** with an in-memory transport so you can develop without a
  Zulip server running.

This is a developer preview (v0.1). The public API will harden as Tier 2
(React / React Native / native SDKs) lands.

## Quick start

### 1. Script tag

```html
<script type="module" src="https://unpkg.com/@zulip/embed"></script>

<zulip-chat
    server="https://chat.example.com"
    email="you@example.com"
    api-key="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    channel="general"
    topic="intros"
></zulip-chat>
```

### 2. npm / pnpm

```bash
pnpm add @zulip/embed
```

```ts
// Registers <zulip-chat> as a side effect.
import "@zulip/embed";

// Or drive the transport directly:
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

### 3. Demo mode (no server required)

```html
<zulip-chat demo channel="general" topic="welcome"></zulip-chat>
```

The `demo` attribute swaps in an in-memory transport with seeded
messages and an echo bot. Useful for storybooks, unit tests, and
local development.

## Attributes

| Attribute      | Required  | Description                                                                                                                                                                |
| -------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `demo`         | —         | Use an in-memory transport instead of a real Zulip server.                                                                                                                 |
| `snapshot-url` | —         | Load a pre-fetched JSON snapshot of messages instead of opening a live event queue. Implies read-only; no credentials in the browser. See [Snapshot mode](#snapshot-mode). |
| `server`       | live mode | Base URL of the Zulip server (e.g. `https://chat.zulip.org`).                                                                                                              |
| `email`        | live mode | Account email or bot email.                                                                                                                                                |
| `api-key`      | live mode | API key for that account.                                                                                                                                                  |
| `channel`      | yes       | Stream/channel name to scope the feed. Defaults to `general`.                                                                                                              |
| `topic`        | no        | Topic inside the channel. Omit for a channel-wide view.                                                                                                                    |
| `theme`        | no        | `light` (default) or `dark`.                                                                                                                                               |
| `mode`         | no        | `inline` (default) or `floating` (bottom-right messenger).                                                                                                                 |
| `read-only`    | no        | Hide the composer and disable reaction toggles. Useful for web-public channels.                                                                                            |

## Theming

All visual tokens are CSS variables on the component. Override them from
the host page:

```css
zulip-chat {
    --zc-color-accent: #ff5722;
    --zc-radius: 8px;
    --zc-height: 600px;
    --zc-font-family: "Inter", sans-serif;
}
```

Complete token list lives in [`src/styles.ts`](./src/styles.ts).

## Snapshot mode

For public, read-only embeds where you don't want to ship API credentials
to the browser, point the component at a pre-fetched JSON file instead
of a live server:

```html
<zulip-chat
    snapshot-url="/snapshots/announce.json"
    channel="announce"
    topic="Zulip updates"
></zulip-chat>
```

The snapshot is a `{version: 1, messages: Message[], ...}` JSON payload
produced by `scripts/fetch-announce-snapshot.mjs`. This repo's Pages
deployment runs that script every six hours against chat.zulip.org and
bakes the latest ~30 messages into the site. Required secrets on the
`github-pages` environment:

- `GH_ACTIONS_BOT_API_KEY` (secret) — Zulip API key for a **Generic bot**
  subscribed to the channel you want to snapshot. **Incoming-webhook
  bots won't work** — they return HTTP 401 on `/api/v1/messages`
  because they can only post, not read.
- `ZULIP_ANNOUNCE_EMAIL` (secret) — the bot's email.
- `ZULIP_ANNOUNCE_SERVER` (environment variable, optional) — defaults to
  `https://chat.zulip.org`.

If the secret is absent, CI falls back to the checked-in snapshot at
`demo/public/snapshots/announce-zulip-updates.json`, so the site always
deploys.

## Development

```bash
pnpm install
pnpm dev          # live demo at http://localhost:5173
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest
pnpm build        # produces dist/zulip-embed.js (ESM) and dist/zulip-embed.iife.js
```

## Architecture

```
┌───────────────────────────────────────┐
│  <zulip-chat>  (Custom Element + CSS) │
├───────────────────────────────────────┤
│  ZulipClient   (events, subscribe)    │
├───────────────────────────────────────┤
│  Transport interface                  │
│  ├── DemoTransport   (in-memory)      │
│  └── ZulipTransport  (REST + events)  │
└───────────────────────────────────────┘
```

The headless SDK and the Web Component are split so framework bindings
(React, Vue, SwiftUI, Compose) can reuse the same transport layer.

## Native mobile &amp; desktop (Flutter)

A first-class Flutter package lives at [`packages/flutter/`](./packages/flutter/).
No WebView — pure Dart widgets talking to the Zulip REST API.

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
)
```

The [`example/`](./packages/flutter/example/) app is compiled for Flutter
web as part of CI and published under `/flutter/` on the demo site, so you
can click through a real Flutter build right from the landing page.

## Supported Zulip features

### Message rendering

Rich HTML returned by Zulip's server-side markdown renderer is run through
DOMPurify with a strict allow-list before it hits the DOM. See
[`SECURITY.md`](./SECURITY.md) for the threat model.

| Element                                                                  | Status                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------- |
| Paragraphs, headings (`h1`–`h6`), horizontal rules                       | ✅                                                      |
| Bold, italic, strikethrough, underline                                   | ✅                                                      |
| Inline code, fenced code blocks                                          | ✅                                                      |
| Ordered + unordered lists (incl. nesting)                                | ✅                                                      |
| Blockquotes (incl. nested)                                               | ✅                                                      |
| Tables with header row                                                   | ✅                                                      |
| Links (http/https/mailto only, `rel="noopener noreferrer nofollow ugc"`) | ✅                                                      |
| Autolinked plain-text URLs                                               | ✅                                                      |
| Inline images (relative paths resolved against `server`)                 | ✅                                                      |
| Unicode emoji                                                            | ✅                                                      |
| Custom Zulip emoji (`<img class="emoji">`)                               | ✅                                                      |
| `@user` mentions, `#channel` references, `#channel > topic` links        | ✅                                                      |
| Keyboard shortcuts (`<kbd>`), abbreviations, sub/sup                     | ✅                                                      |
| Spoilers (click / keyboard reveal)                                       | ✅                                                      |
| KaTeX math                                                               | 🚧 (markup passes through, no KaTeX stylesheet bundled) |
| Code-block syntax highlighting (Pygments classes)                        | ✅                                                      |
| Polls                                                                    | ❌                                                      |
| Widgets / custom message extensions                                      | ❌                                                      |
| File / image attachment previews beyond `<img>`                          | ❌                                                      |

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
| Light + dark themes                                        | ✅        |
| Typing indicators (send + receive, per-scope filtered)     | ✅        |
| Unread separator + "new messages" jump-to-bottom pill      | ✅        |
| Curated emoji reaction picker                              | ✅        |
| Message pagination (scroll-up loads older)                 | ✅        |
| KaTeX math (lazy-loaded)                                   | ✅        |
| Channel + topic enumeration (`listChannels`, `listTopics`) | ✅        |
| Direct messages                                            | ❌ (v0.5) |
| Presence (online/offline dots)                             | ❌        |
| File uploads from the composer                             | ❌        |
| Message search                                             | ❌        |
| Unread counters, read receipts                             | ❌        |
| Draft persistence                                          | ❌        |

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

## Frameworks

| Framework                           | Status     | Path                                       |
| ----------------------------------- | ---------- | ------------------------------------------ |
| Web Components (framework-agnostic) | ✅         | this repo root                             |
| Flutter                             | ✅         | [`packages/flutter/`](./packages/flutter/) |
| React (thin wrapper over WCs)       | ✅         | [`packages/react/`](./packages/react/)     |
| React Native                        | ⏳         | `packages/react-native/`                   |
| SwiftUI (iOS)                       | ⏳ planned | `packages/swiftui/`                        |
| Jetpack Compose (Android)           | ⏳ planned | `packages/compose/`                        |

## Roadmap

**v1.0 — Component + framework parity**

1. ✅ Sanitized HTML rendering (DOMPurify) + KaTeX math
2. ✅ Live message edits, deletes, reactions, typing
3. ✅ Message pagination + unread separator
4. ✅ Flutter parity (live chat, edit/delete, typing, snapshot)
5. ✅ `Transport.listChannels()` + `listTopics()` primitives
6. ✅ `<zulip-channel-list>` + `<zulip-topic-list>` components
7. ✅ React wrapper package (`@zulip/react`)
8. ⏳ React Native package
9. ⏳ Composer file / image upload (multipart to `/user_uploads`)
10. ⏳ Direct messages, presence, search, inbox/recent views
11. ⏳ JWT SSO handoff (replace HTML-attribute `api-key`)
12. ⏳ SwiftUI + Compose native SDKs
13. ⏳ Publish to npm + pub.dev; developer-docs site

See [`SECURITY.md`](./SECURITY.md) for the threat model and
[`CLAUDE.md`](./CLAUDE.md) for code conventions.

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
