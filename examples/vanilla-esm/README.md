# vanilla-esm

A static HTML page that uses a native ESM **import map** to load
`zulip-embed/chat` from unpkg and mount the Web Component — no build
step, no `node_modules`, but also no IIFE bundle.

## Run it

Open [`index.html`](./index.html) in a recent browser (Chrome 89+,
Safari 16.4+, Firefox 108+ — all major evergreen browsers support
import maps). That's all.

## What an import map buys you

`zulip-embed` is published as an ESM package with several entry
points:

| Entry                      | Registers                     |
| -------------------------- | ----------------------------- |
| `zulip-embed`              | (index) — all custom elements |
| `zulip-embed/chat`         | `<zulip-chat>`                |
| `zulip-embed/channel-list` | `<zulip-channel-list>`        |
| `zulip-embed/topic-list`   | `<zulip-topic-list>`          |

With an import map, your HTML can say `import "zulip-embed/chat"`
exactly the way a bundled app would — but the browser resolves each
bare specifier through the map, straight off the CDN. No Vite, no
webpack, no `package.json`.

## When to pick ESM over IIFE

- You only need one or two entries and want a smaller wire payload
  (`chat.js` is ~300 bytes plus the chunk graph; the IIFE is one
  self-contained ~70 KB file).
- You want to pull in the headless SDK (`import {ZulipClient} from "zulip-embed"`)
  alongside the custom element, sharing the same module graph rather
  than paying twice.
- You're prototyping without a bundler but want bundler-shaped imports.

Use the [vanilla-cdn example](../vanilla-cdn/) instead if you want
the simplest possible integration (one script tag, no import map, no
ESM scripting).

## Connect to a real server

Remove `demo` and supply a `server` plus an `auth-token` JWT minted
by your backend (see [`docs/jwt.md`](../../docs/jwt.md)):

```html
<zulip-chat
    server="https://chat.example.com"
    auth-token="{{ JWT from your backend }}"
    channel="general"
    topic="welcome"
    theme="dark"
    mode="inline"
    brand-name="Acme Support"
></zulip-chat>
```

## Pinning in production

The import map URLs in this example use the floating `zulip-embed/...`
tag so the example keeps working. In production, pin the version in
each URL:

```html
<script type="importmap">
    {
        "imports": {
            "zulip-embed": "https://unpkg.com/zulip-embed@0.8.0/dist/zulip-embed.js",
            "zulip-embed/chat": "https://unpkg.com/zulip-embed@0.8.0/dist/entries/chat.js"
        }
    }
</script>
```

Subresource Integrity (`integrity="sha256-..."`) does not apply to
`<script type="module">` resolved through an import map yet — if you
need SRI verification today, use the IIFE bundle (see
[`../vanilla-cdn/`](../vanilla-cdn/)).

## Adding the other entries

To also pull in the channel picker, extend the import map:

```html
<script type="importmap">
    {
        "imports": {
            "zulip-embed/chat": "https://unpkg.com/zulip-embed/dist/entries/chat.js",
            "zulip-embed/channel-list": "https://unpkg.com/zulip-embed/dist/entries/channel-list.js"
        }
    }
</script>
<script type="module">
    import "zulip-embed/chat";
    import "zulip-embed/channel-list";
</script>
```

Then use `<zulip-channel-list>` alongside `<zulip-chat>` in the page.

## Learn more

- [Top-level `README.md`](../../README.md)
- [`<zulip-channel-list>` / `<zulip-topic-list>`](../../README.md#plug-and-play-components)
