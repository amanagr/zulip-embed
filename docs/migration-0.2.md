# Migrating to `zulip-embed@0.2.0`

Sprint 1 of v1 turned the auth story and the public API types inside
out. This guide walks through the four concrete migrations, in the
order they'll bite a typical consumer.

## 1. Move from `api-key` to `auth-token`

**Before.** The host page embedded a long-lived Zulip API key directly
in the DOM:

```html
<zulip-chat
  server="https://chat.example.com"
  email="viewer@example.com"
  api-key="zuliprc-xxxxxxxxxxxx"
  channel="general">
</zulip-chat>
```

Any script with access to the page (analytics pixels, extensions, XSS
bugs) could read that attribute and call the Zulip API with full
account scope.

**After.** Your server mints a short-lived JWT scoped to one viewer and
injects it into the attribute. The embed exchanges the JWT once for an
API key that never leaves the SDK's closure.

```html
<zulip-chat
  server="https://chat.example.com"
  auth-token="<short-lived JWT>"
  channel="general">
</zulip-chat>
```

**Server-side.** You need the shared secret provisioned in your Zulip
org's `JWT_AUTH_KEYS` setting. Sign an HS256 JWT with
`{email: "<viewer>", realm: "<realm>"}` and an `exp` 5-10 minutes out;
return it to the browser on page load or through a `/session` endpoint.
See [Zulip JWT docs](https://zulip.com/api/) for key provisioning.

The `api-key` attribute still works for local development but logs a
deprecation warning at mount. It is scheduled for removal in
`zulip-embed@1.0.0`.

## 2. Narrow on `Message.type` before accessing channel fields

**Before.** `Message.channelName` and `Message.topic` were always
strings, with DM messages carrying empty / undefined values that
callers had to guess about.

```ts
function label(m: Message) {
    return `#${m.channelName} > ${m.topic}`;
}
```

**After.** `Message` is a discriminated union on `type`; channel
fields only exist on the channel variant.

```ts
function label(m: Message) {
    if (m.type === "channel") {
        return `#${m.channelName} > ${m.topic}`;
    }
    return `DM: ${m.recipients.map((r) => r.fullName).join(", ")}`;
}
```

Every call site that reads `.channelName` or `.topic` has to narrow
first — `tsc` will flag them all.

## 3. Update `sendMessage` / `editMessage` call shapes

**Before.** `SendMessageParams` was a single bag with optional fields;
`editMessage` took optional `content` and `topic`.

```ts
transport.sendMessage({type: "stream", content: "hi"});
transport.editMessage({messageId: 42, content: "oops"});
```

**After.** Both are discriminated.

```ts
transport.sendMessage({
    type: "channel",
    channel: "general",
    topic: "hello",
    content: "hi",
});
transport.editMessage({
    messageId: 42,
    kind: "content",
    content: "oops",
});
// Editing topic:
transport.editMessage({messageId: 42, kind: "topic", topic: "renamed"});
// Editing both:
transport.editMessage({messageId: 42, kind: "both", content: "x", topic: "y"});
```

There is no longer a way to call `editMessage({messageId})` with
neither — the type rejects it, and the network round-trip is skipped.

## 4. Read the new `ErrorEvent.code` field

**Before.** `event.error` was a human-readable string; any routing
required regex on the message.

**After.** Every error event carries a typed `code: ErrorCode`:

```ts
client.subscribe((event) => {
    if (event.type !== "error") return;
    switch (event.code) {
        case "unauthorized":
            // Probably a stale auth-token — fetch a new one.
            break;
        case "channel-not-subscribed":
            // Show a "request access" button.
            break;
        case "rate-limited":
            // event.retryAfterMs is populated from Retry-After.
            break;
        case "network":
            // Transient; the transport is already backing off.
            break;
        case "jwt-not-configured":
            // Server-side misconfiguration — surface to operator.
            break;
    }
});
```

The string `event.error` is still there for logging.

## 5. Consume `whenReady` instead of polling `getCurrentUserId`

`ZulipClient.whenReady: Promise<User>` resolves once `/users/me` has
returned. Use it to populate "logged in as" UI without racing the
first connect:

```ts
const client = new ZulipClient({transport, scope});
await client.connect();
const me = await client.whenReady;
greetingEl.textContent = `Hi, ${me.fullName}`;
```

`getCurrentUserId()` remains as a sync helper but returns `undefined`
before the user record lands.

## 6. Handle the new `"reconnecting"` connection state

`ConnectionEvent.status` now includes `"reconnecting"` with
`{attempt, delayMs, reason}`. Your status-badge handler should render
the same amber treatment you already use for `"connecting"`:

```ts
if (event.status === "connecting" || event.status === "reconnecting") {
    badge.className = "badge-amber";
}
```

The SDK's own styling handles this for the built-in components —
consumers only need to extend their own indicators if they have any.
