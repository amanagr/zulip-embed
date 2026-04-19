---
title: Troubleshooting
description: zulip-error codes, CSP gotchas, styling overrides, and the most common "widget isn't connecting" failure modes.
---

A practical cheat sheet for the most common integration issues. Paired
with [`ONBOARDING.md`](./ONBOARDING.md) — which gets you from zero to a
live embed — this file covers what to do when something looks wrong.

If your problem isn't here, open a discussion at
<https://github.com/amanagr/zulip-embed/discussions>. For a suspected
security issue, follow [`SECURITY.md`](../SECURITY.md).

## Error codes

`<zulip-chat>` dispatches a `zulip-error` `CustomEvent` on the host
element whenever a recoverable failure bubbles up from the transport.
The `detail` is `{code, error, retryAfterMs?}`.

| `code`                   | What it means                                                                              | First thing to check                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unauthorized`           | The JWT signature didn't verify, or the derived key isn't valid for the realm.             | Confirm `JWT_AUTH_KEYS[realm].key` on the Zulip server matches what your backend signed with, and the `email` claim resolves to an account in the realm. |
| `channel-not-subscribed` | The account connects, but Zulip returned no history for the scope because it can't see it. | Subscribe the bot to that channel (Settings → Organization → Streams → [channel] → Subscribers).                                                         |
| `network`                | The browser couldn't reach `server`.                                                       | Open DevTools → Network. Likely suspects: CORS mis-config, ad blocker, corporate proxy, mixed-content (HTTPS page loading HTTP Zulip), expired cert.     |
| `rate-limited`           | 429 from `/events` or `/messages`.                                                         | Nothing — the SDK backs off per `retryAfterMs`. If you see it often, slow down your agent-reply throughput or raise the per-realm limits on self-hosted. |
| `jwt-not-configured`     | You passed `auth-token` but the Zulip server doesn't have `JWT_AUTH_KEYS` set.             | Have an admin follow [`docs/jwt.md`](/guides/auth/) on the server side. Cloud tenants: file a support ticket requesting JWT auth.                             |
| `unknown`                | Catch-all for parse errors or unclassified 5xx.                                            | Check the `error` message string; reproduce with `?verbose=1` on a dev build to get a longer trace in the console.                                       |

Listen with vanilla JS:

```js
const el = document.querySelector("zulip-chat");
el.addEventListener("zulip-error", (e) => {
    console.warn("[zulip]", e.detail.code, e.detail.error);
});
```

Or with React (`zulip-embed-react`):

```jsx
<ZulipChat {...props} onError={(detail) => telemetry.capture(detail)} />
```

## Loads, but nothing shows up

You're looking at an empty rounded box. In this order:

1. **Check DevTools → Elements for `<zulip-chat>`.** If the tag is
   rendered as an unknown element (no shadow root), the custom
   element was never registered. Either the bundle didn't load
   (check Network tab) or you imported a subpath that doesn't
   register the element — e.g. `zulip-embed/agent` is a headless
   helper. Use `zulip-embed/chat` or the default `zulip-embed` entry
   to get the element side-effect.

2. **Check `height`.** The element's intrinsic height is zero. Either
   set a height in your host CSS (`zulip-chat { height: 560px }`) or
   mount it inside a flex container with a bounded height.

3. **Check the console for `zulip-error`.** See the table above.

4. **Check `demo`.** If you set `demo` by mistake on a live page, the
   element renders seeded messages and never talks to your server,
   which can look like "it's working" until you notice the author is
   always "Ada Lovelace".

5. **Look at the Network tab.** A 200 from `/api/v1/register` followed
   by no `/api/v1/events` call usually means `/register` returned a
   bad `queue_id` — typically caused by a realm being in "deactivated"
   or "being migrated" state. Log in manually on the Zulip web UI to
   confirm the realm is healthy.

## Content-Security-Policy blocks the bundle

If your page sets a strict `Content-Security-Policy`, you'll see:

```
Refused to load the script 'https://unpkg.com/zulip-embed/...' because
it violates the following Content Security Policy directive: ...
```

Three fixes, in increasing order of rigor:

1. **Allow unpkg in `script-src`**: add
   `script-src 'self' https://unpkg.com;`. Simplest; fine for internal
   tools.
2. **Self-host the bundle**: copy `node_modules/zulip-embed/dist/zulip-embed.iife.js`
   into your static assets and point the `<script src>` at it.
3. **Use subpath imports with SRI**: `import "zulip-embed/chat"` +
   pin the version + paste the SHA-256 from
   [`INTEGRITY.md`](../dist/INTEGRITY.md) into your `<script integrity="...">`
   tag. This is the shape [`SECURITY.md`](../SECURITY.md) recommends
   for production.

`connect-src` also needs your Zulip server's origin. A typical
directive:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://unpkg.com;
  style-src 'self' 'unsafe-inline';
  connect-src 'self' https://acme.zulipchat.com;
  img-src 'self' https: data:;
```

The `style-src 'unsafe-inline'` is currently required because the
element injects scoped styles into its shadow root. An opt-in
nonce-based path is on the roadmap — track <https://github.com/amanagr/zulip-embed/issues>
for progress.

## The bundle is bigger than I expected

If your chunk analysis shows ~200 KB for `zulip-embed`, you imported
the default entry, which includes demo + snapshot + emoji-picker lazy
loaders as part of the graph.

For a production integration that only needs the chat element, import
the subpath directly:

```js
import "zulip-embed/chat";
```

Expected gzip sizes (tracked in CI via `pnpm check:bundle`):

| Subpath                    | Gzip budget | What you get                                    |
| -------------------------- | ----------- | ----------------------------------------------- |
| `zulip-embed/chat`         | 60 KB       | `<zulip-chat>` live mode only                   |
| `zulip-embed/channel-list` | 8 KB        | `<zulip-channel-list>` element                  |
| `zulip-embed/topic-list`   | 8 KB        | `<zulip-topic-list>` element                    |
| `zulip-embed/announcement` | 20 KB       | `<zulip-announcement>` pinned-banner            |
| `zulip-embed/agent`        | 5 KB        | `startAgentReply` helper for host-driven agents |
| `zulip-embed/demo`         | 28 KB       | In-memory `DemoTransport` (code-split)          |

The main `zulip-embed` default export re-registers every element and
lazy-loads `demo` + `snapshot` + `emoji-picker` on first use. If your
app code references any of those features, you'll see a second chunk
load on demand — that's expected.

## Theme and styling aren't applying

The element renders inside a shadow root, so host-page CSS selectors
don't pierce by default. Two supported override paths:

1. **`theme` attribute.** `theme="light"` and `theme="dark"` swap a
   curated token set. Set `theme="auto"` to honor
   `prefers-color-scheme`.

2. **CSS custom properties on the host.** The element reads a small,
   documented set of custom properties for the tokens most integrators
   want to brand:

    ```css
    zulip-chat {
        --zc-color-accent: #5f3dc4;
        --zc-color-accent-contrast: #fff;
        --zc-radius: 10px;
        --zc-font-family: "Inter", system-ui, sans-serif;
    }
    ```

    See [`ARCHITECTURE.md §Styling`](https://github.com/amanagr/zulip-embed/blob/main/docs/ARCHITECTURE.md) for the full
    token list.

Structural changes (hiding the composer, replacing the message list,
etc.) are not supported via CSS — they're explicit attributes on the
element (`read-only`, `hide-composer`, etc.) or headless-client
territory.

## Messages send twice / duplicate on reconnect

When the transport reconnects after a drop, it re-subscribes to the
event queue. If your host page also listens to `zulip-message` events
and triggers a send in response (e.g. an agent-reply loop that isn't
idempotent), you can wire yourself into a loop.

Fix: key your handler on `detail.message.id` and dedupe. The SDK does
not persist "seen" IDs across reloads on your behalf.

For agent-reply flows specifically, the `startAgentReply` primitive
handles streaming-update idempotency for you — use it instead of
rolling your own `sendMessage` loop. See
[`ARCHITECTURE.md §Agent-reply`](https://github.com/amanagr/zulip-embed/blob/main/docs/ARCHITECTURE.md).

## Flutter and TypeScript behave differently

They're not supposed to. Both SDKs share a domain model (Transport,
DemoTransport, ZulipTransport, ZulipClient) and any divergence is a
bug — file an issue with a minimal repro on both sides.

A handful of behaviors are intentionally platform-specific:

- **Shadow-root styling.** TS uses CSS custom properties; Flutter uses
  `ThemeData`. The mapping is documented per-widget.
- **Event dispatch.** TS dispatches `CustomEvent`s on the element
  host; Flutter invokes `ValueChanged<T>` callbacks on the widget.
- **Snapshot mode.** Both accept the same `SnapshotFile` shape, but
  TS loads via `fetch()` while Flutter loads via `rootBundle` or a
  user-supplied `Future<String>` — whichever matches your platform.
