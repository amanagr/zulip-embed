# vanilla-cdn

The simplest possible Zulip Embed integration: one HTML file, one
script tag, no bundler, no install.

## Run it

Open [`index.html`](./index.html) in a browser. That's it.

No server, no build, no package install. The page loads
`zulip-embed.iife.js` from unpkg and mounts a `<zulip-chat demo>`
element. The `demo` attribute routes the component through an
in-memory `DemoTransport` with seeded messages and an echo bot, so
nothing leaves your machine.

## Connect to a real server

Remove `demo` and supply the live-mode attributes:

```html
<zulip-chat
    server="https://chat.example.com"
    email="you@example.com"
    api-key="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    channel="general"
    topic="welcome"
    theme="light"
    mode="inline"
    brand-name="Acme Support"
></zulip-chat>
```

`server`, `email`, and `api-key` are all required in live mode. Prefer
a JWT-based `auth-token` if you can exchange one server-side —
shipping a long-lived `api-key` to anonymous browsers is risky.

## Production: pin and verify the script

The `index.html` in this folder uses the latest-tag URL
(`https://unpkg.com/zulip-embed/dist/zulip-embed.iife.js`) so the
example keeps working as new versions ship. **For production, pin the
version and add a Subresource Integrity (SRI) hash** so a compromised
unpkg can't swap the script under you.

The per-release hashes ship inside the package at
`dist/INTEGRITY.md` (also published alongside GitHub releases). Grab
the `zulip-embed.iife.js (unpkg)` row's `sha256-...` value and use it
like this:

```html
<script
    src="https://unpkg.com/zulip-embed@0.8.0/dist/zulip-embed.iife.js"
    integrity="sha256-<copy-from-INTEGRITY.md>"
    crossorigin="anonymous"
></script>
```

Replace `<copy-from-INTEGRITY.md>` with the actual hash. The browser
will refuse to execute the script if it doesn't match, so an attacker
who tampers with the CDN can't silently run their payload on your
page. `crossorigin="anonymous"` is required for SRI to take effect on
cross-origin scripts.

Bumping the embedded version is a two-step edit: change the `@x.y.z`
pin, update the `sha256-...` hash for the same release.

## Learn more

- [Top-level `README.md`](../../README.md)
- [Supported attributes](../../README.md#attributes-zulip-chat)
- [Theming](../../README.md#theming)
