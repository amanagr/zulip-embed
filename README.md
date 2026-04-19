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

| Attribute | Required | Description |
| --- | --- | --- |
| `demo` | — | Use an in-memory transport instead of a real Zulip server. |
| `server` | live mode | Base URL of the Zulip server (e.g. `https://chat.zulip.org`). |
| `email` | live mode | Account email or bot email. |
| `api-key` | live mode | API key for that account. |
| `channel` | yes | Stream/channel name to scope the feed. Defaults to `general`. |
| `topic` | no | Topic inside the channel. Omit for a channel-wide view. |
| `theme` | no | `light` (default) or `dark`. |
| `mode` | no | `inline` (default) or `floating` (bottom-right messenger). |
| `read-only` | no | Hide the composer and disable reaction toggles. Useful for web-public channels. |

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

| Element | Status |
| --- | --- |
| Paragraphs, headings (`h1`–`h6`), horizontal rules | ✅ |
| Bold, italic, strikethrough, underline | ✅ |
| Inline code, fenced code blocks | ✅ |
| Ordered + unordered lists (incl. nesting) | ✅ |
| Blockquotes (incl. nested) | ✅ |
| Tables with header row | ✅ |
| Links (http/https/mailto only, `rel="noopener noreferrer nofollow ugc"`) | ✅ |
| Autolinked plain-text URLs | ✅ |
| Inline images (relative paths resolved against `server`) | ✅ |
| Unicode emoji | ✅ |
| Custom Zulip emoji (`<img class="emoji">`) | ✅ |
| `@user` mentions, `#channel` references, `#channel > topic` links | ✅ |
| Keyboard shortcuts (`<kbd>`), abbreviations, sub/sup | ✅ |
| Spoilers | 🚧 (structural, no reveal toggle yet) |
| KaTeX math | 🚧 (markup passes through, no KaTeX stylesheet bundled) |
| Code-block syntax highlighting (Pygments classes) | 🚧 (classes preserved, theme not bundled) |
| Polls | ❌ |
| Widgets / custom message extensions | ❌ |
| File / image attachment previews beyond `<img>` | ❌ |

### Live data & interaction

| Feature | Status |
| --- | --- |
| Channel + topic scoped narrow | ✅ |
| Long-poll event queue via `/register` + `/events` | ✅ |
| Send messages to channel | ✅ |
| Message edits (live, incremental DOM update) | ✅ |
| Message deletes (live) | ✅ |
| Emoji reactions — read, add, remove (live) | ✅ |
| Avatar images (with initials fallback) | ✅ |
| Rich showcase + read-only `#announce` demos | ✅ |
| Floating-messenger mode | ✅ |
| Light + dark themes | ✅ |
| Direct messages | ❌ (scoped to channels for v0.1) |
| Typing indicators | ❌ |
| Presence (online/offline dots) | ❌ |
| File uploads from the composer | ❌ |
| Message search | ❌ |
| Thread / per-topic nav drawer | ❌ |
| Unread counters, read receipts | ❌ |
| Draft persistence | ❌ |

## Roadmap

Prioritized by what's blocking real-world embedding use cases. Checked
items ship in the current preview; the rest are in rough "we'd work on
next" order.

**v0.2 — Read-path completeness**
1. ✅ Sanitized HTML rendering (DOMPurify)
2. ✅ Live message edits, deletes, and reactions
3. ✅ Rendering showcase + `#announce` read-only demo
4. Spoiler reveal toggle
5. Code-block syntax highlighting (bundle a Pygments-compatible theme)
6. KaTeX math rendering (opt-in, lazy-loaded)
7. Unread separator + "new messages" indicator

**v0.3 — Write-path completeness**
8. Emoji picker (replace `prompt()` fallback)
9. Composer file / image upload (multipart to `/user_uploads`)
10. Message edit + delete from the composer
11. Typing indicators (send + receive)
12. Draft autosave per channel + topic

**v0.4 — Navigation & scale**
13. Channel / topic switcher inside the widget
14. Direct messages
15. Message history paging (scroll up to load older)
16. Message search
17. Unread counts + read-receipt events

**v0.5 — Identity & auth**
18. JWT SSO handoff (replace HTML-attribute `api-key`)
19. Scoped API keys with channel-level ACLs
20. Guest / web-public read mode without any credentials

**v1.0 — Cross-tier parity**
21. React bindings with typed props + hooks
22. React Native + SwiftUI + Compose SDKs
23. Publish `zulip_embed` to pub.dev + DartPad snippets in docs
24. Subresource integrity + signed release bundles
25. CSP-friendly build (no inline styles in host page)

See the parent discussion for the full Tier 1 → Tier 3 plan.

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
