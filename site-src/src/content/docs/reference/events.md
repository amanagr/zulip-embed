---
title: Custom events reference
description: Every zulip-chat CustomEvent, the detail shape, when it fires, and a minimum-viable handler.
---

Every `<zulip-*>` element dispatches bubbling `CustomEvent`s on its
host so framework-agnostic consumers can wire listeners with
`addEventListener` (or React-style `on*` props via
[`zulip-embed-react`](/frameworks/react/)). This page is the canonical
list — one entry per event, with the detail shape, trigger, and a
minimum-viable handler snippet.

Pair with [troubleshooting](/guides/troubleshooting/) for
`zulip-error` codes, and [agents](/reference/agents/) for the
`zulip-confirmation-response` orchestration pattern.

## Quick reference

| Event name                     | Emitted by                          | Detail type                             | Bubbles | Composed |
| ------------------------------ | ----------------------------------- | --------------------------------------- | ------- | -------- |
| `zulip-message`                | `<zulip-chat>`                      | `ZulipMessageEventDetail`               | yes     | yes      |
| `zulip-connection-change`      | `<zulip-chat>`                      | `ZulipConnectionChangeEventDetail`      | yes     | yes      |
| `zulip-error`                  | `<zulip-chat>`                      | `ZulipErrorEventDetail`                 | yes     | yes      |
| `zulip-confirmation-response`  | `<zulip-chat>` (re-dispatched host) | `ZulipConfirmationResponseEventDetail`  | yes     | yes      |
| `channel-selected`             | `<zulip-channel-list>`              | `{channelId: number, name: string}`     | yes     | yes      |
| `topic-selected`               | `<zulip-topic-list>`                | `{topic: string}`                       | yes     | yes      |
| `dm-selected`                  | `<zulip-dm-list>`                   | `{userIds, users, lastMessageId}`       | yes     | yes      |
| `announcement-dismissed`       | `<zulip-announcement>`              | `{messageId?: number}`                  | yes     | yes      |

All eight events pierce the shadow root (`composed: true`) so a
listener on the document or any ancestor sees them. The one exception
is the widget-internal `zulip-confirmation-response` fired from
`src/render.ts` — that one is scoped to the shadow root
(`composed: false`) and then re-dispatched on the host by the
`<zulip-chat>` element so consumers only observe one event per click.

Every detail shape is exported from `zulip-embed` — `import type
{ZulipMessageEventDetail, …} from "zulip-embed"` — so you can type
handlers without re-declaring the fields.

## `zulip-message`

**When it fires.** The transport delivered a new message (or a
snapshot row) that passed the scope filter. Fires once per message;
never refires on edits — use your local state + `subscribe` on the
client if you need edit tracking.

**Emitted by.** `<zulip-chat>`.

**Detail.**

```ts
interface ZulipMessageEventDetail {
    message: Message;  // discriminated: {type: "channel"} | {type: "direct"}
}
```

`Message` is the normalized SDK shape. For channel messages:
`{type: "channel", id, senderId, senderFullName, content,
contentIsHtml, parts?, reactions, timestamp, channelName, topic}`. For
DMs: `{type: "direct", …, recipients: User[]}`.

**Handler.**

```js
document.querySelector("zulip-chat").addEventListener("zulip-message", (e) => {
    if (e.detail.message.type === "channel") {
        telemetry.capture("zulip_message", {
            channel: e.detail.message.channelName,
            topic: e.detail.message.topic,
        });
    }
});
```

**React equivalent.** `onMessage={(detail) => …}`.

## `zulip-connection-change`

**When it fires.** The underlying transport transitioned between
connection states (`idle` → `connecting` → `connected`, or the reverse
on disconnect / reconnect). Fires on every transition including
backoff attempts, so consumers can draw a live connection dot.

**Emitted by.** `<zulip-chat>`.

**Detail.**

```ts
interface ZulipConnectionChangeEventDetail {
    status: "idle" | "connecting" | "connected"
          | "reconnecting" | "disconnected" | "error";
    attempt?: number;     // 1-indexed; set while status === "reconnecting"
    delayMs?: number;     // backoff delay before the next retry
    reason?: string;      // human-readable description of why
}
```

The `status` string is the same enum the raw `ConnectionEvent` on
`ZulipClient` uses. `attempt` + `delayMs` are populated only while
the transport is in exponential-backoff retry.

**Handler.**

```js
document
    .querySelector("zulip-chat")
    .addEventListener("zulip-connection-change", (e) => {
        statusDot.dataset.status = e.detail.status;
        if (e.detail.status === "reconnecting") {
            statusDot.title = `Retry ${e.detail.attempt} in ${e.detail.delayMs}ms`;
        }
    });
```

**React equivalent.** `onConnectionChange={(detail) => …}`.

## `zulip-error`

**When it fires.** A recoverable failure bubbled up from the transport
— authentication failed, the realm has no JWT config, the viewer
can't see the channel, the browser can't reach the server, or Zulip
rate-limited us. See [troubleshooting](/guides/troubleshooting/) for
the full code-by-code handling guide.

**Emitted by.** `<zulip-chat>`.

**Detail.**

```ts
interface ZulipErrorEventDetail {
    code:
        | "unauthorized"
        | "channel-not-subscribed"
        | "network"
        | "rate-limited"
        | "jwt-not-configured"
        | "unknown";
    error: string;             // human-readable message for logs
    retryAfterMs?: number;     // only set on "rate-limited"
}
```

The `code` is the stable machine handle; the SDK classifies errors
once and never changes the string for an existing category. The
`error` field can vary between releases — never parse it; key UI off
`code`.

**Handler.**

```js
document.querySelector("zulip-chat").addEventListener("zulip-error", (e) => {
    if (e.detail.code === "rate-limited") return;  // SDK backs off on its own
    if (e.detail.code === "channel-not-subscribed") {
        toast("Subscribe the bot to this channel in Zulip settings.");
        return;
    }
    console.warn("[zulip]", e.detail.code, e.detail.error);
});
```

**React equivalent.** `onError={(detail) => …}`.

## `zulip-confirmation-response`

**When it fires.** The viewer clicked **Approve** or **Deny** inside
an inline `ConfirmationMessagePart` widget. The click handler is
idempotent — a second click on either button of the same card is a
no-op, so the event fires at most once per card lifetime.

**Emitted by.** `<zulip-chat>` (re-dispatched on the host).

Internally the card dispatches a `composed: false` event inside the
shadow root; the component listens for that, stops the event
bubbling past the root, and emits a fresh `composed: true` event on
the host so embedders see exactly one event per click.

**Detail.**

```ts
interface ZulipConfirmationResponseEventDetail {
    id: string;              // ConfirmationMessagePart.id
    action: "approve" | "deny";
    payloadSig: string;      // opaque to the widget; echo-verified by your server
}
```

`payloadSig` is minted on your backend over `(id, prompt, action)` and
echoed verbatim through the UI. **Always re-verify the signature on
the server before acting on the action** — the widget has no
cryptographic guarantees; it's a plain DOM button.

**Handler.**

```js
document
    .querySelector("zulip-chat")
    .addEventListener("zulip-confirmation-response", async (e) => {
        const res = await fetch("/api/agent/confirm", {
            method: "POST",
            body: JSON.stringify(e.detail),
        });
        if (!res.ok) toast("Failed to record your choice, try again.");
    });
```

**React equivalent.** `onConfirmationResponse={(detail) => …}` (on
the `<ZulipChat>` wrapper).

See [agents reference](/reference/agents/#example--dm-with-tool-call--confirmation)
for a full orchestrator loop that waits on this event before running
a tool call.

## `channel-selected`

**When it fires.** The viewer clicked a channel row inside a
`<zulip-channel-list>`. Fires once per click, not on programmatic
selection changes.

**Emitted by.** `<zulip-channel-list>`.

**Detail.**

```ts
interface ChannelSelectedDetail {
    channelId: number;
    name: string;             // channel name, without the leading "#"
}
```

**Handler.**

```js
document
    .querySelector("zulip-channel-list")
    .addEventListener("channel-selected", (e) => {
        document.querySelector("zulip-chat")
            .setAttribute("channel", e.detail.name);
    });
```

**React equivalent.** `onChannelSelected={(detail) => …}`.

## `topic-selected`

**When it fires.** The viewer clicked a topic row inside a
`<zulip-topic-list>`.

**Emitted by.** `<zulip-topic-list>`.

**Detail.**

```ts
interface TopicSelectedDetail {
    topic: string;
}
```

Paired with `channel-selected` above, this lets you build a two-pane
layout: channel list on the left, topic list in the middle, chat on
the right — all state-synced via the two events.

**Handler.**

```js
document
    .querySelector("zulip-topic-list")
    .addEventListener("topic-selected", (e) => {
        document.querySelector("zulip-chat")
            .setAttribute("topic", e.detail.topic);
    });
```

**React equivalent.** `onTopicSelected={(detail) => …}`.

## `dm-selected`

**When it fires.** The viewer clicked a direct-message conversation
row inside a `<zulip-dm-list>`. Fires once per click.

**Emitted by.** `<zulip-dm-list>`.

**Detail.**

```ts
interface DmSelectedDetail {
    userIds: number[];        // sorted-ascending list including the viewer
    users: User[];            // the *other* participants, not the viewer
    lastMessageId: number;    // newest message id in the thread
}
```

`userIds` is canonicalized the same way `DmScope.userIds` is, so you
can hand it straight to `<zulip-chat dm-user-ids="42,99">` (comma-
delimited) or build a `{kind: "dm", userIds}` scope for a headless
`ZulipClient`.

**Handler.**

```js
document
    .querySelector("zulip-dm-list")
    .addEventListener("dm-selected", (e) => {
        const chat = document.querySelector("zulip-chat");
        chat.setAttribute("dm-user-ids", e.detail.userIds.join(","));
        chat.removeAttribute("channel");
    });
```

**React equivalent.** `onDmSelected={(detail) => …}`.

## `announcement-dismissed`

**When it fires.** The viewer clicked the close button on a
`<zulip-announcement>` banner whose `dismissible` attribute is set.
Persists the dismissal in `localStorage` keyed on the message id, so
the banner stays hidden across page loads for that viewer.

**Emitted by.** `<zulip-announcement>`.

**Detail.**

```ts
interface AnnouncementDismissedDetail {
    messageId?: number;       // pinned-message id; undefined if unknown
}
```

`messageId` is undefined only in the degenerate case where the banner
never resolved a message (e.g. snapshot-missing). In practice it's
always present.

**Handler.**

```js
document
    .querySelector("zulip-announcement")
    .addEventListener("announcement-dismissed", (e) => {
        telemetry.capture("announcement_dismissed", {id: e.detail.messageId});
    });
```

**React equivalent.** No `<ZulipAnnouncement>` wrapper ships in
v1.0.0; use the custom element directly inside JSX and attach the
listener in a `useEffect`.

## Listening at the document root

Every event bubbles + is composed, so one document-level listener
catches all `<zulip-*>` elements on the page:

```js
document.addEventListener("zulip-error", (e) => {
    errorBoundary.capture(e.detail);
});
document.addEventListener("zulip-connection-change", (e) => {
    statusPanel.render(e.detail.status);
});
```

Handy when you mount multiple embeds (e.g. one per support channel)
and don't want to bind a listener per element.

## TypeScript

The detail types are exported from the package root. In TS:

```ts
import type {
    ZulipMessageEventDetail,
    ZulipConnectionChangeEventDetail,
    ZulipErrorEventDetail,
    ZulipConfirmationResponseEventDetail,
} from "zulip-embed";

const el = document.querySelector("zulip-chat")!;
el.addEventListener("zulip-message", (e) => {
    const detail: ZulipMessageEventDetail =
        (e as CustomEvent<ZulipMessageEventDetail>).detail;
    // detail.message is a fully-typed Message union
});
```

The `channel-selected` / `topic-selected` / `dm-selected` /
`announcement-dismissed` detail types are local to their respective
elements and re-exported from the React wrapper as
`ChannelSelectedDetail`, `TopicSelectedDetail`, `DmSelectedDetail`,
and `AnnouncementDismissedDetail`.

## Event ordering guarantees

The pipeline is deterministic; consumers that rely on ordering can:

- Trust `zulip-connection-change` with `status === "connected"` fires
  **before** the first `zulip-message`. The client pumps its initial
  message page after `connect()` resolves.
- Trust `zulip-message` fires **before** any scope-filter change takes
  effect in the UI. The render pass is synchronous with the event
  dispatch.
- **Not** trust the relative order of `zulip-message` and
  `zulip-error`. An error while reconnecting can land between two
  message events for an unaffected transport-level queue.
- Trust `zulip-confirmation-response` fires at most once per card id.
  The underlying buttons are disabled on the first click, and the
  component deduplicates the re-dispatch.

## Handler patterns

### Dedupe on reconnect

Transports re-subscribe to the event queue after a drop. A handler
that triggers side-effects off `zulip-message` should key on the
message id to avoid double-firing when a reconnect replays recent
messages:

```js
const seen = new Set();
document.addEventListener("zulip-message", (e) => {
    if (seen.has(e.detail.message.id)) return;
    seen.add(e.detail.message.id);
    sideEffect(e.detail.message);
});
```

The SDK does not persist "seen" ids across page loads — that's your
layer.

### Typed React `on*` handlers

The wrapper forwards detail shapes verbatim:

```tsx
import {ZulipChat} from "zulip-embed-react";

<ZulipChat
    server="https://acme.zulipchat.com"
    authToken={token}
    channel="general"
    onMessage={(detail) => console.log(detail.message.senderFullName)}
    onConnectionChange={(detail) => setStatus(detail.status)}
    onError={(detail) => sentry.captureMessage(detail.code)}
/>
```

No prop for `zulip-confirmation-response` in v1.0.0 — attach a DOM
listener in `useEffect` or use the ref-forwarded element. This gap is
tracked on the v1.x roadmap.

### Removing a listener

Capture the handler reference so you can unregister on teardown:

```js
const onMsg = (e) => render(e.detail.message);
const el = document.querySelector("zulip-chat");
el.addEventListener("zulip-message", onMsg);

// later, before element removal:
el.removeEventListener("zulip-message", onMsg);
```

Both browser and JSDOM (used by the test suite) leak event listeners
if you forget — the component's own listeners are internally cleaned
up when the element disconnects, but listeners *you* bind aren't the
SDK's problem.

## What about the underlying `ZulipEvent` stream?

Every `CustomEvent` above is a host-layer re-emit of a lower-level
`ZulipEvent` travelling through `ZulipClient`. If you're building a
custom UI with the headless client, subscribe directly:

```ts
client.subscribe((event: ZulipEvent) => {
    switch (event.type) {
        case "message": /* … */ break;
        case "message-update": /* not reflected as a CustomEvent */ break;
        case "message-delete": /* not reflected as a CustomEvent */ break;
        case "connection": /* … */ break;
        case "reaction": /* not reflected as a CustomEvent */ break;
        case "typing": /* not reflected as a CustomEvent */ break;
        case "error": /* … */ break;
    }
});
```

Three event types — `message-update`, `message-delete`, and
`reaction` — aren't re-emitted as host `CustomEvent`s today. The
reasoning is that consumers who care about edits / deletes / reactions
usually already own the message list (via the headless client or a
React hook) and re-derive from there. If your use case needs them at
the DOM-event layer, file an issue.

## Further reading

- [Troubleshooting](/guides/troubleshooting/) — `zulip-error`
  code-by-code handling guide, plus CSP + styling gotchas.
- [Agents & AI](/reference/agents/) — `zulip-confirmation-response`
  in a full tool-call orchestration loop.
- [React wrapper](/frameworks/react/) — every `on*` prop on every
  React wrapper.
