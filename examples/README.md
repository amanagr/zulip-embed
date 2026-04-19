# Zulip Embed — integration examples

Minimal, copy-pasteable integrations of
[`zulip-embed`](https://www.npmjs.com/package/zulip-embed) — one folder
per host environment. Each example is self-contained: no shared lockfile,
no workspace coupling, nothing depends on the repo root's `package.json`.

Every example boots in **demo mode** by default — it uses the in-memory
`DemoTransport` (seeded messages + an echo bot) so you can try it
without a Zulip server or API key. Each README shows the one-line tweak
to point it at a real server.

## Examples

| Folder                           | What it shows                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [`vanilla-cdn/`](./vanilla-cdn/) | Plain HTML file that loads `zulip-embed.iife.js` from unpkg. No build step, no npm install.                                 |
| [`vanilla-esm/`](./vanilla-esm/) | Plain HTML file using an ESM import map → `zulip-embed/chat`. Right choice if you want per-entry imports without a bundler. |
| [`react/`](./react/)             | React + Vite minimal app wiring `<ZulipChat>` from `zulip-embed-react`.                                                     |
| [`nextjs/`](./nextjs/)           | Next.js App Router app that mounts the component inside a `"use client"` wrapper (SSR-safe).                                |

## Demo mode — how it works

All four examples set the `demo` attribute (or `demo` prop in React):

```html
<zulip-chat demo channel="general" topic="welcome"></zulip-chat>
```

When `demo` is set, the component skips all network calls and renders
seeded messages + an echo bot. That means:

- No Zulip server required.
- No API key shipped to the browser.
- Safe to open the file straight off disk (vanilla examples) or run
  `pnpm dev` (React / Next.js examples).

To switch to a real server, drop the `demo` attribute and add
`server`, `email`, and `api-key` (or `auth-token`):

```html
<zulip-chat
    server="https://chat.example.com"
    email="you@example.com"
    api-key="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    channel="general"
    topic="welcome"
></zulip-chat>
```

See each example's `README.md` for the exact swap.

## Copying an example out of the repo

Every example uses public names (`zulip-embed`, `zulip-embed-react`) and
CDN URLs (`https://unpkg.com/zulip-embed/...`) — no `file:` or
`workspace:` references. You can move any folder to a new repo and
`pnpm install` without touching anything.
