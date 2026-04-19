# Architecture

`zulip-embed` splits into four layers that stay decoupled on purpose:

1. **Transports** push events and fulfill commands.
2. **`ZulipClient`** owns the event pipeline, derived state, and the
   agent-reply streaming primitive.
3. **Custom Elements / framework wrappers** render the state.
4. **Subpath entries** package each element + helper into independently
   loadable bundles.

This document walks through each layer, then the cross-cutting
concerns (scope model, event pipeline, bundle strategy, Flutter
parity).

## 1. Transport interface

Every live Zulip backend, demo fixture, and JSON snapshot talks to
the rest of the SDK through the same [`Transport`](../src/transport.ts)
interface. A transport is responsible for:

- opening a connection (`connect(onEvent)`) and delivering typed
  `ZulipEvent` values over the callback,
- answering one-shot queries (`getMessages`, `listChannels`,
  `listTopics`, `fetchMessage`),
- fulfilling commands (`sendMessage`, `editMessage`, `deleteMessage`,
  `addReaction` / `removeReaction`, `sendTyping`),
- identifying the connected viewer (`getCurrentUser`,
  `getCurrentUserId`).

Ship-in-package implementations:

| Transport           | Connects to                                   | Use case                                 |
| ------------------- | --------------------------------------------- | ---------------------------------------- |
| `ZulipTransport`    | live Zulip server over `/register` + `/events`| Production                               |
| `DemoTransport`     | in-memory state + seeded channels + echo bot  | Offline dev, storybooks, tests           |
| `SnapshotTransport` | pre-fetched JSON snapshot (`SnapshotFile`)    | Public read-only embeds, CI screenshots  |

The interface is small enough that hosts can hand-roll their own
transport (e.g. to route through an existing internal API gateway)
without depending on `ZulipTransport`. Optional methods are marked
as such on the type — read-only transports can omit them; the client
degrades the matching UI affordances instead of throwing.

### JWT exchange

`ZulipTransport` supports both `email + apiKey` credentials and
short-lived `authToken` JWTs. When an `authToken` is supplied, the
transport POSTs it to `/api/internal/jwt/fetch_api_key` on
`connect()` and caches the returned API key in closure. On a 401,
the transport invokes the optional `refreshAuthToken` callback,
retries, and resumes without dropping messages. See
[`docs/jwt.md`](./jwt.md) for the server-side setup.

## 2. `ZulipClient` and the event pipeline

`ZulipClient` is the DOM-free surface consumers build against when
they want their own UI. It owns:

- **Scope state** — messages, connection status, typing indicators,
  and reactions, derived from the transport's event stream.
- **Event subscriptions** — `client.subscribe(event => …)` delivers
  raw `ZulipEvent` values; `client.subscribeState(listener)` delivers
  the derived state each time it changes (used by the React hook).
- **Commands** — `sendMessage`, `loadOlder`, plus pass-through for
  reactions / edit / delete / typing on transports that support them.
- **Lifecycle** — `whenReady` resolves with the `User` record once the
  transport identifies the viewer.
- **Agent replies** — `startAgentReply` produces an `AgentReplyHandle`
  that local-echoes tokens at 60fps via an optimistic message,
  broadcasts edits at ≤4Hz through a trailing-edge 250ms debounce,
  and lands a terminal edit (with a sentinel `tool_result` part on
  abort) when finished.

The client does not know about DOM / React / Flutter. Rendering layers
subscribe to its state and draw whatever makes sense for the host
platform.

### Event shapes

Events are a discriminated union on `type` in
[`src/types.ts`](../src/types.ts):

- `connection` — `status` is `idle | connecting | connected |
  reconnecting | disconnected | error`. `reconnecting` carries
  `{attempt, delayMs, reason}` during exponential backoff.
- `message` / `message-update` / `message-delete` — CRUD on the message
  list. `message-update` can carry a new `parts` array for structured
  content (used by the streaming primitive).
- `reaction` — full replacement of a message's `reactions` array.
- `typing` — scoped typing-indicator state.
- `error` — stable `code` + human-readable `error`. See the `ErrorCode`
  union for the machine-handled cases.

The `<zulip-chat>` element also dispatches **host** `CustomEvent`s so
hosts that aren't wiring a `ZulipClient` directly can still listen:
`zulip-message`, `zulip-connection-change`, `zulip-error`, and
`zulip-confirmation-response`. The React wrapper forwards them as
camelCase `on*` props.

## 3. Scope model

A `ScopeFilter` picks the slice of Zulip the current view is showing:

```ts
export interface ScopeFilter {
    channel: string;
    topic?: string | undefined;
}
```

- `{channel: "general"}` — all messages in `#general`, across topics.
- `{channel: "general", topic: "welcome"}` — a single topic.

Events from the transport are filtered to the active scope before
they land in `ZulipClient.getState().messages`. The client re-derives
from scratch when the scope changes — no stale messages from the
previous narrow bleed through.

> **v0.8 planned.** `ScopeFilter` is being widened to a discriminated
> union that also covers direct-message scopes:
>
> ```ts
> type ScopeFilter =
>     | {type: "channel"; channel: string; topic?: string}
>     | {type: "dm"; userIds: number[]};
> ```
>
> The migration keeps the flat channel-only shape readable at call
> sites for one release with a runtime warning, then narrows. Track
> item #12 in [`docs/V1_PLAN.md`](./V1_PLAN.md).

## 4. Custom Elements and framework wrappers

Each custom element (`<zulip-chat>`, `<zulip-channel-list>`,
`<zulip-topic-list>`, `<zulip-announcement>`) is a thin shell that:

1. Reads configuration from observed attributes on the element.
2. **Dynamically imports** its transport only when needed
   (`DemoTransport`, `SnapshotTransport`, `ZulipTransport` live in
   separate chunks so the critical path of a live-mode embed never
   pulls the demo fixture, and vice versa).
3. Wires a `ZulipClient` subscription into its shadow DOM.
4. Dispatches typed host `CustomEvent`s for parent-level listeners.

Shadow DOM isolates every element's CSS — the host page's styles
can't leak in, and the embed's styles can't leak out. Visual tokens
are exposed as `--zc-*` CSS variables on `:host` so consumers can
theme without forking.

The React wrapper (`zulip-embed-react`) wraps each element in a typed
React component, forwards camelCase props to hyphenated attributes,
and surfaces custom events as `on*` props. The `useZulipChat` hook is
a headless alternative for bring-your-own-UI integrations.

The Flutter wrapper (`zulip_embed`) mirrors the same domain model in
pure Dart — the `Transport` interface, `DemoTransport`,
`ZulipTransport`, `ZulipClient`, and widget surfaces are all
reimplemented so Flutter apps don't need a `WebView`. The parity rule
from [`CLAUDE.md`](../CLAUDE.md) requires every domain-model change
in `src/` to mirror in `packages/flutter/lib/src/` in the same sprint.

## 5. Subpath entries and bundle strategy

The default entry (`zulip-embed`) imports every element and is the
register-everything shim — convenient for one-line script-tag drops
but heavy. For production, each element has its own entry:

```
zulip-embed/chat            registers <zulip-chat>
zulip-embed/channel-list    registers <zulip-channel-list>
zulip-embed/topic-list      registers <zulip-topic-list>
zulip-embed/announcement    registers <zulip-announcement>
zulip-embed/agent           startAgentReply + AgentReplyHandle types
zulip-embed/demo            DemoTransport + SnapshotTransport
zulip-embed/all             register-everything (same as default)
```

Each subpath compiles to its own ES module in
[`src/entries/`](../src/entries/) and exports only the types + classes
it actually uses. Tree-shaking takes care of the rest.

### Budget enforcement

[`scripts/bundle-check.mjs`](../scripts/bundle-check.mjs) walks each
entry's static transitive graph (resolving the Vite / Rollup chunk
graph from `dist/`), gzips the result, and fails CI on regressions.
Current budgets:

| Entry                 | Budget |
| --------------------- | ------ |
| `entries/chat.js`     | 60 KB  |
| `entries/channel-list.js`   | 8 KB  |
| `entries/topic-list.js`     | 8 KB  |
| `entries/announcement.js`   | 20 KB |
| `entries/agent.js`          | 5 KB  |
| `entries/demo.js`           | 28 KB |

### Dynamic imports for heavy leaves

Three dependencies are dynamically imported from inside the custom
elements so they don't get pulled into the critical path:

- **`emoji-picker`** — loaded when the viewer opens the picker.
- **`DemoTransport`** seed data — loaded only when `demo` is set.
- **`SnapshotTransport`** — loaded only when `snapshot-url` is set.
- **`ZulipTransport`** — loaded only when `server` + credentials are
  set (i.e. not for pure demo / snapshot pages).

Net effect: `/chat` gzips at ~55 KB (vs. ~66 KB pre-split),
`/channel-list` and `/topic-list` at ~4 KB (vs. ~32 KB).

## 6. Agent-native primitives

`ZulipClient.startAgentReply(scope, options)` returns an
`AgentReplyHandle`:

```ts
interface AgentReplyHandle {
    messageId: Promise<number>;
    appendToken(text: string): void;
    appendEvent(event: MessagePart): void;
    finish(final?: {parts?: MessagePart[]; content?: string}): Promise<void>;
    abort(reason?: string): Promise<void>;
}
```

The handle posts an initial placeholder message (`sendMessageWithId`
on the transport), local-echoes tokens to the `ZulipClient` state at
60fps, and broadcasts `editMessage` calls to the server on a
trailing-edge 250ms debounce so remote viewers see edits at ≤4 Hz.
`abort()` lands a terminal `editMessage` with a sentinel
`{type: "tool_result", isError: true}` part so downstream consumers
can tell cancellation from completion.

`MessagePart[]` — the structured message body — covers text, code,
tool calls, tool results, and inline `ConfirmationMessagePart`
widgets. Messages without `parts` fall through to the HTML
`content` pipeline unchanged, so agent and human messages coexist.

## 7. Security boundaries

See [`SECURITY.md`](../SECURITY.md) for the full threat model. The
most load-bearing invariants:

- HTML returned by Zulip's server-side markdown renderer goes through
  DOMPurify with a strict allow-list before touching the DOM.
- URL fields that show up in CSS contexts (brand logo, avatar) reject
  `javascript:` / `data:` / protocol-relative schemes, with explicit
  handling for the CSS `url(...)` smuggling vectors (`image-set`,
  `cross-fade`, `src`, `paint`, `element`).
- The `api-key` attribute is **still** accepted on `<zulip-chat>` for
  dev workflows but a deprecation warning fires on mount and it is
  scheduled for removal in 1.0. Production deployments should migrate
  to `auth-token` — see [`jwt.md`](./jwt.md).

## 8. Flutter parity

The Flutter package in `packages/flutter/lib/src/` mirrors every
piece of the TS domain model:

- `transport.dart` defines the same interface as `src/transport.ts`.
- `zulip_transport.dart` / `demo_transport.dart` / `snapshot_transport.dart`
  implement the three transports.
- `client.dart` mirrors `ZulipClient` with the same event pipeline
  and agent-reply primitive.
- `types.dart` declares sealed classes for `Message`,
  `SendMessageParams`, `EditMessageParams`, `MessagePart`, and
  `ScopeFilter`.
- `widgets/` holds the UI primitives: `ZulipChat`, `ZulipChannelList`,
  `ZulipTopicList`, `ZulipAnnouncement`.

The parity rule from [`CLAUDE.md`](../CLAUDE.md) is enforced by
convention, not tooling: every domain-model change in TS must mirror
in Dart in the same commit / sprint so the two SDKs don't drift.

## Further reading

- **[`docs/ONBOARDING.md`](./ONBOARDING.md)** — zero-to-live-embed
  walkthrough.
- **[`docs/jwt.md`](./jwt.md)** — minting auth tokens on your backend.
- **[`docs/migration-0.2.md`](./migration-0.2.md)** — 0.1 → 0.2
  discriminated-union migration notes.
- **[`docs/V1_PLAN.md`](./V1_PLAN.md)** — full v1 sprint plan with
  per-item file lists and risk notes.
