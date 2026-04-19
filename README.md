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

## Roadmap

- [x] Tier 1 — Web Component with demo + live transports
- [ ] Tier 2 — React bindings and a styled component library
- [ ] Tier 2 — JWT SSO handoff + scoped API keys
- [ ] Tier 3 — React Native, SwiftUI, Compose SDKs
- [ ] Reactions, threads, file uploads, presence
- [ ] Sanitized rendering of server HTML (DOMPurify)

See the parent discussion for the full Tier 1 → Tier 3 plan.

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
