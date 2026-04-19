# Onboarding — from zero to a live `<zulip-chat>`

This walkthrough gets you from "no Zulip server" to a live embed in
your product, end-to-end. It targets a developer who has never
provisioned a Zulip account before.

If you already have a running server and an account you can get an
API key for, skip to [step 4](#4-first-live-embed).

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

## 3. Get credentials out of Zulip

You need a `server`, an `email`, and an `api-key`. For the account
you created in step 2:

- **Server URL.** Your org URL, including scheme, no trailing slash.
  Example: `https://acme.zulipchat.com`.
- **Email.** The bot email or account email.
- **API key.** For a bot, it's on the bot-details page. For a human
  account, **Settings → Account & privacy → Show API key**.

Treat the API key like a password. Don't commit it to Git.

## 4. First live embed

Create an HTML file anywhere you can serve static assets:

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
            email="embed-bot@acme.zulipchat.com"
            api-key="YOUR_API_KEY_HERE"
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
`#general` under the bot's name.

**If nothing shows up**, open DevTools → Console. The embed logs a
`zulip-error` `CustomEvent` with a machine-readable `code`:

- `unauthorized` — the email + api-key pair is wrong, or the account
  doesn't exist.
- `channel-not-subscribed` — subscribe the account to the channel.
- `network` — the browser can't reach `server`. Check CORS, ad
  blockers, and corporate proxies.
- `rate-limited` — you hit Zulip's rate limits; the embed will back
  off automatically.
- `jwt-not-configured` — only happens if you're using `auth-token` on
  a server that doesn't have `JWT_AUTH_KEYS` set.

## 5. Graduate from `api-key` to `auth-token` for production

Shipping an `api-key` attribute in production HTML is a foot-gun —
anything on the page (analytics pixels, browser extensions, an XSS bug)
can read it and call the Zulip API with the full account's scope.

For production deployments, use the `auth-token` attribute instead.
Your backend mints a short-lived JWT per-viewer that the embed
exchanges once for a scoped API key. The key stays inside the SDK;
the host page never sees it.

Requirements:

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
   and hand it to the page. Examples in [`jwt.md`](./jwt.md) for Node
   (`jose`) and Python (`pyjwt`).

3. **Your page.** Replace `email` + `api-key` with `auth-token`:

    ```html
    <zulip-chat
        server="https://acme.zulipchat.com"
        auth-token="<short-lived JWT you served with the page>"
        channel="general"
    ></zulip-chat>
    ```

The embed POSTs the JWT once to `/api/internal/jwt/fetch_api_key`,
caches the returned key in closure, and uses it for subsequent calls.
Refresh-on-401 is wired through `refreshAuthToken` on the headless
client — see [`jwt.md`](./jwt.md#refresh-before-expiry).

## 6. Check your work

For a typical production integration, you should be able to tick each
of these:

- [ ] The embed loads without hitting `api-key` in public HTML.
- [ ] The account is a generic bot or a service account, not a real
      human with broad channel access.
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
- **[`jwt.md`](./jwt.md)** — deep dive on minting tokens.
- **[React hook quickstart](../README.md#track-2--react)** — if you
  want to build your own UI with `useZulipChat`.
- **[Bundle subpaths](../README.md#bundle-subpaths)** — cut your
  client payload down to 55 KB gzipped.
