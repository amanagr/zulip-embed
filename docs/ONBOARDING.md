# Onboarding — from zero to a live `<zulip-chat>`

This walkthrough gets you from "no Zulip server" to a live embed in
your product, end-to-end. It targets a developer who has never
provisioned a Zulip account before.

If you already have a running server and admin access to configure
`JWT_AUTH_KEYS`, skip to [step 3](#3-configure-the-jwt-handoff).

## 1. Pick a Zulip server

You have three options. The embed talks to the same REST API in all
three cases, so you can start on one and migrate later.

| Option                  | When to use                                                          | Cost                                 |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| **Zulip Cloud**         | Fastest start. No ops. Works for most product use cases.             | Free plan + paid tiers               |
| **Self-hosted Zulip**   | You need data residency, SSO, or run-of-the-mill enterprise policy. | Hardware + ops                       |
| **zulip.chat.zulip.org**| Experimentation only — it's the public dev server. Don't ship here.  | Free; subject to community cleanup   |

For Zulip Cloud, sign up at <https://zulip.com/new/> and take the
"organization URL" Zulip gives you (e.g. `acme.zulipchat.com`) — this
is your `server` value.

For self-hosted installs, follow the
[Zulip installation docs](https://zulip.readthedocs.io/en/latest/production/install.html).
Minimum viable VPS is 2 vCPUs + 4 GB RAM. The embed does not require
any special settings; the default deployment will work.

## 2. Create the account the embed will authenticate as

The embed sends messages, reads message history, and (optionally)
lists channels / topics on behalf of an account. Three shapes of
account will work:

- **A human account** — simplest for demos, embedded chat inside a
  staff tool, or internal dashboards.
- **A [generic bot](https://zulip.com/help/bots-overview)** —
  recommended for product integrations. Can send + read, and its
  activity is visibly attributed to the bot.
- **A service account** — a human account dedicated to the integration,
  with a strong password and scoped subscriptions.

Whichever you pick, subscribe it to the channels you want the embed
to surface. The embed cannot see channels the account is not subscribed
to — you will get an `error / channel-not-subscribed` event.

### Creating a generic bot

1. Go to **Settings → Personal → Bots → Add a new bot**.
2. Choose bot type "Generic bot" and pick a full name + email.
   **Do NOT choose "Incoming webhook" — those bots can only post and
   will 401 on every read request.**
3. Save. Zulip shows the bot's email + API key.
4. Subscribe the bot to each channel: **Settings → Organization →
   Streams → [channel] → Subscribers → add**.

## 3. Configure the JWT handoff

The embed authenticates via a short-lived JWT that your backend mints
per-viewer. The SDK exchanges the JWT once for a scoped API key that
stays inside the SDK; the host page never sees a long-lived credential.

Two pieces to wire up:

1. **Zulip side.** An admin adds a shared secret to
   `/etc/zulip/settings.py`:

    ```python
    JWT_AUTH_KEYS = {
        "acme.zulipchat.com": {
            "key": "<32+ random bytes>",
            "algorithms": ["HS256"],
        },
    }
    ```

    Restart the Zulip service. (Cloud tenants can request this from
    support.) Full server-side config lives in [`jwt.md`](./jwt.md).

2. **Your backend.** Mint an HS256 JWT claiming `{email, realm, exp}`
   (5–10 minutes out) with the shared key, and hand it to the page.
   Examples in [`jwt.md`](./jwt.md) for Node (`jose`) and Python
   (`pyjwt`).

Also grab your **server URL** (your org URL, including scheme, no
trailing slash, e.g. `https://acme.zulipchat.com`).

## 4. First live embed

Create an HTML file anywhere you can serve static assets. Your
backend should splice a freshly-minted JWT into `auth-token` on
each page load:

```html
<!DOCTYPE html>
<html>
    <head>
        <meta charset="utf-8" />
        <title>My Zulip embed</title>
    </head>
    <body>
        <h1>My product</h1>
        <script type="module" src="https://unpkg.com/zulip-embed"></script>
        <zulip-chat
            server="https://acme.zulipchat.com"
            auth-token="<short-lived JWT from your backend>"
            channel="general"
            topic="welcome"
            theme="light"
            brand-name="Acme"
        ></zulip-chat>
    </body>
</html>
```

Load it in a browser. You should see the chat with live messages in
10–15 seconds; the composer sends messages to the `welcome` topic in
`#general` as the viewer the JWT's `email` claim resolves to.

**If nothing shows up**, open DevTools → Console. The embed logs a
`zulip-error` `CustomEvent` with a machine-readable `code`:

- `unauthorized` — the JWT signature didn't verify, or its `email`
  claim resolves to an account that doesn't exist.
- `channel-not-subscribed` — subscribe the account to the channel.
- `network` — the browser can't reach `server`. Check CORS, ad
  blockers, and corporate proxies.
- `rate-limited` — you hit Zulip's rate limits; the embed will back
  off automatically.
- `jwt-not-configured` — the Zulip server doesn't have `JWT_AUTH_KEYS`
  set (or the realm in the token doesn't match). Re-check step 3.

## 5. Local development without a backend

If you don't have a backend to mint JWTs yet (or you're poking at
the SDK from a Node / React Native script), `ZulipTransport` also
accepts `{email, apiKey}` as a programmatic constructor option:

```ts
import {ZulipTransport} from "zulip-embed";
const transport = new ZulipTransport({
    serverUrl: "https://acme.zulipchat.com",
    email: "embed-bot@acme.zulipchat.com",
    apiKey: "YOUR_API_KEY_HERE",
    scope: {channel: "general"},
});
```

This path is **not** exposed as an HTML attribute — it only works
when you construct the transport yourself. Use it for local scripts,
tests, and React Native prototypes; never embed an `apiKey` into
HTML you serve to browsers.

## 6. Check your work

For a typical production integration, you should be able to tick each
of these:

- [ ] The embed loads without hitting `api-key` in public HTML.
- [ ] The account the JWT claims for is a generic bot or service
      account, not a real human with broad channel access.
- [ ] The bot is subscribed only to channels the embed should surface.
- [ ] The host page renders with `Content-Security-Policy`
      compatible with unpkg (or a self-hosted copy of the module).
- [ ] You listen for `zulip-error` events on the element and surface
      them in your own UI.
- [ ] Your CI does not leak the Zulip API key into client bundles
      (grep your `dist/` output).

## 7. Next steps

- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — how the transport,
  scope, and event pipeline fit together. Read this before building a
  custom headless integration.
- **[`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)** — practical
  cheat sheet for common integration failures (error codes, CSP,
  bundle-size surprises, styling).
- **[`jwt.md`](./jwt.md)** — deep dive on minting tokens.
- **[React hook quickstart](../README.md#track-2--react)** — if you
  want to build your own UI with `useZulipChat`.
- **[Bundle subpaths](../README.md#bundle-subpaths)** — cut your
  client payload down to 55 KB gzipped.
