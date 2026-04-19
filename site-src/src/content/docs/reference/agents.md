---
title: Agent-native primitives
description: Build streaming LLM transcripts inside Zulip with startAgentReply, MessagePart[], and the confirmation widget.
---

`zulip-embed` treats agent transcripts as a first-class message shape,
not a bolted-on viewer. The SDK ships a streaming primitive
(`startAgentReply`) and a structured body format (`MessagePart[]`) so
an LLM-driven support experience reads like any other Zulip thread on
the wire — one message id, edits landing in place — while the
embedded renderer draws tool calls, tool results, code blocks, and
human-in-the-loop confirmation widgets as first-class UI.

Pair this page with [`ARCHITECTURE.md`](https://github.com/amanagr/zulip-embed/blob/main/docs/ARCHITECTURE.md) for the
transport / scope / event-pipeline model; with
[`events.md`](/reference/events/) for the full `CustomEvent` surface the
widgets dispatch; and with [`jwt.md`](/guides/auth/) for the auth path the
agent speaks through.

## Mental model

1. Your orchestrator holds a `ZulipClient` (or a host-owned
   `Transport`) that's already connected.
2. For each new assistant turn, call `client.startAgentReply(scope,
   {author})`. The client POSTs a placeholder message to the server
   so you immediately have a real message id to edit.
3. Stream tokens via `handle.appendToken("…")` and structured events
   via `handle.appendEvent({type: "tool_call", …})`. Each token is
   local-echoed at 60 fps; `editMessage` calls to the server are
   debounced to ≤4 Hz (250 ms trailing-edge) so Zulip's rate limiter
   stays happy.
4. End the turn with `await handle.finish()` (or `handle.abort()` on
   cancellation). The terminal edit lands the final content + the
   structured `parts` array on the one message id you started with.

Because every side-effect flows through the same transport and event
pipeline the rest of the SDK uses, channel subscribers see a normal
"someone edited their message" stream of updates — no agent-specific
protocol, no out-of-band fan-out. Regular humans can reply inline,
add reactions, and edit alongside the agent.

## `startAgentReply(scope, options)`

```ts
startAgentReply(scope: ScopeFilter, options: StartAgentReplyOptions): AgentReplyHandle
```

Lives on `ZulipClient`. Re-exported from the `zulip-embed/agent`
subpath so hosts that only want the streaming primitive (and no
custom elements) can tree-shake the rest of the SDK.

**`scope`** — the narrow the reply lands in. A `ScopeFilter` is a
discriminated union:

```ts
// Channel / topic
{kind: "channel", channel: "support", topic: "acme-123"}

// One-on-one DM
{kind: "dm", userIds: [viewerId, agentViewerId]}

// Group DM
{kind: "dm", userIds: [viewerId, bob, alice]}
```

The legacy flat `{channel, topic?}` shape is still accepted for one
release; `normalizeScope()` widens it to `{kind: "channel", …}` with a
deprecation warning. New code should always use the discriminated
form.

**`options.author`** — the display persona the agent renders as.

```ts
interface StartAgentReplyOptions {
    author: {
        fullName: string;          // "Acme Support Bot"
        avatarUrl: string;         // http(s) only; unsafe schemes fall back to initials
        agentModel?: string;       // Free-form tag, e.g. "claude-sonnet-4.7"
    };
}
```

The underlying Zulip message is always authored by the connected
viewer (the JWT's `email` claim on the wire) — the `author` fields
override the display name, avatar, and optional model tag locally so
the UI reads as the agent. This keeps the server model simple: no
"agent accounts" to provision, no subscriptions to fan out.

## `AgentReplyHandle`

```ts
interface AgentReplyHandle {
    messageId: Promise<number>;
    appendToken(text: string): void;
    appendEvent(event: MessagePart): void;
    finish(final?: {parts?: MessagePart[]; content?: string}): Promise<void>;
    abort(reason?: string): Promise<void>;
}
```

**`messageId`** — resolves once the placeholder send lands and the
handle knows the id it's editing. Rejects if the initial POST fails,
in which case every other method becomes a no-op (safe to `await
handle.abort()` in a `finally` block; it won't throw).

**`appendToken(text)`** — O(1) append. Tokens coalesce into the
trailing `TextMessagePart` in the running buffer so the renderer can
update a single text node instead of rebuilding subtrees. Safe to
call thousands of times per second; the broadcast debounce handles
the rate-limiter side.

**`appendEvent(part)`** — push a structured part (tool call, tool
result, code block, confirmation). After the event lands, a new
`TextMessagePart` will be started on the next `appendToken` so
subsequent tokens don't fold into the event's text.

**`finish(final?)`** — flush any pending debounced edit, then send
one terminal `editMessage` with the final content. Pass `{parts}` or
`{content}` to replace the streamed transcript with a cleanly
formatted version at the end (useful when the model emits Markdown
in a different shape than the raw stream).

**`abort(reason?)`** — cancel an in-flight stream. Appends a sentinel
`tool_result` part with `toolCallId ===
"__zulip_agent_reply_abort__"` and `isError: true` to whatever's
already buffered, then calls `finish()` internally. The renderer
treats that id as a terminal marker ("agent stopped") badge.
Resolves even when the network is down — never throws so callers can
put it in a `finally` block.

## `MessagePart` — the structured body

Every agent message carries a `parts: MessagePart[]` array alongside
the flat `content` string. Renderers that know about parts
(`<zulip-chat>`, the React wrapper) draw them as first-class UI;
renderers that don't fall back to the flat `content` HTML pipeline
unchanged, so agent and human messages coexist.

The `MessagePart` union is declared in
[`src/types.ts`](../src/types.ts):

```ts
type MessagePart =
    | TextMessagePart
    | CodeMessagePart
    | ToolCallMessagePart
    | ToolResultMessagePart
    | ConfirmationMessagePart;
```

### `TextMessagePart`

```ts
{type: "text", text: string, author?: MessagePartAuthor}
```

The default shape. Plain Markdown; renders through the same pipeline
as a human-authored message (DOMPurify allow-list, `code`, `strong`,
links). Consecutive `appendToken` calls fold into the trailing text
part so incremental renders swap a single text node rather than
rebuilding the bubble.

### `CodeMessagePart`

```ts
{type: "code", code: string, language?: string, author?: MessagePartAuthor}
```

Fenced code. Set `language` when the model tags the fence (e.g.
`"python"`, `"typescript"`); omit it for an untyped `<pre>`. The
renderer tints tokens with the `--zc-syntax-*` palette — see
[`theming.md`](/reference/theming/) for how to retint the whole palette
with a few variable overrides.

### `ToolCallMessagePart`

```ts
{
    type: "tool_call",
    id: string,              // stable id; matches a later ToolResultMessagePart
    name: string,            // "search_docs", "fetch_weather", …
    input: unknown,          // JSON-serializable arguments
    status?: "pending" | "streaming" | "complete" | "error",
    author?: MessagePartAuthor,
}
```

Renders as a compact "tool card" with a header row (tool name + a
status chip) and a collapsed JSON body. `status` drives the chip
color: `pending` grey, `streaming` pulses, `complete` green, `error`
red. Leaving `status` undefined reads as "complete" in the UI.

### `ToolResultMessagePart`

```ts
{
    type: "tool_result",
    toolCallId: string,      // matches the ToolCallMessagePart.id you're answering
    output: unknown,
    isError?: boolean,
    author?: MessagePartAuthor,
}
```

The pair of a tool call. Renders as a small block below its tool
card; `isError: true` tints it with the error palette. A sentinel
`toolCallId === "__zulip_agent_reply_abort__"` lands when `abort()`
is called — consumers can key on it to show an "agent stopped" badge
in their own orchestration UI.

### `ConfirmationMessagePart`

```ts
{
    type: "confirmation",
    id: string,
    prompt: string,
    approveLabel?: string,    // defaults to "Approve"
    denyLabel?: string,       // defaults to "Deny"
    payloadSig: string,       // opaque to the widget; echoed back on click
    author?: MessagePartAuthor,
}
```

The human-in-the-loop primitive. Renders an inline card with the
prompt + two buttons. On click the widget dispatches a bubbling
`zulip-confirmation-response` `CustomEvent` on the `<zulip-chat>`
host (see [`events.md`](/reference/events/)). `payloadSig` is produced by
your server over `(id, prompt, action)` so a malicious renderer
can't forge an approval — the widget just echoes it back in the
response event for your orchestrator to verify.

The buttons are idempotent: once either is clicked, both disable and
the card records the resolved action in a `data-confirmation-resolved`
attribute so re-renders don't re-arm them.

### `MessagePartAuthor` (multi-agent attribution)

Every part type optionally carries an `author`:

```ts
interface MessagePartAuthor {
    id: string;              // stable per session, e.g. "planner"
    name: string;            // "Planner", "Research agent"
    color?: string;          // #rgb/#rgba/#rrggbb/#rrggbbaa
    avatarUrl?: string;      // http(s) only
}
```

Lets a planner agent + a research agent + a tool executor co-author
one Message bubble — each part gets a thin colored accent bar and a
small chip tagging which agent produced it. Unknown / unsafe color
values are ignored (rather than applied) to keep untrusted host
values from smuggling CSS into the shadow tree.

## Streaming pattern

The primitive is deliberately SDK-agnostic — point it at whichever
token source your stack ships. Two common shapes:

### OpenAI / Anthropic SDK

```ts
const handle = client.startAgentReply(scope, {author});

const stream = await anthropic.messages.stream({
    model: "claude-sonnet-4.7",
    max_tokens: 2048,
    messages: [...],
});

for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        handle.appendToken(event.delta.text);
    }
}

await handle.finish();
```

### Raw Server-Sent Events

```ts
const handle = client.startAgentReply(scope, {author});
const source = new EventSource("/api/agent/stream");

source.addEventListener("token", (e) => handle.appendToken(e.data));
source.addEventListener("tool_call", (e) => handle.appendEvent(JSON.parse(e.data)));
source.addEventListener("done", async () => {
    source.close();
    await handle.finish();
});
source.addEventListener("error", async () => {
    source.close();
    await handle.abort("stream dropped");
});
```

### AbortController integration

```ts
const controller = new AbortController();
controller.signal.addEventListener("abort", () => void handle.abort("user cancelled"));

cancelButton.addEventListener("click", () => controller.abort());
```

## Example — channel streaming (Anthropic SDK)

A complete, runnable snippet for a support channel. Assumes you've
already bundled the SDK + your orchestrator's server-side handler is
wired through `/api/agent/complete`.

```ts
import Anthropic from "@anthropic-ai/sdk";
import {ZulipClient, ZulipTransport} from "zulip-embed";

const anthropic = new Anthropic();
const transport = new ZulipTransport({
    serverUrl: "https://acme.zulipchat.com",
    authToken: await fetchZulipAuthToken(),      // your JWT minter
    scope: {kind: "channel", channel: "support", topic: "acme-123"},
});
const client = new ZulipClient({
    transport,
    scope: {kind: "channel", channel: "support", topic: "acme-123"},
});
await client.connect();

async function respondTo(question: string): Promise<void> {
    const handle = client.startAgentReply(
        {kind: "channel", channel: "support", topic: "acme-123"},
        {
            author: {
                fullName: "Acme Support Bot",
                avatarUrl: "https://acme.example/bot.png",
                agentModel: "claude-sonnet-4.7",
            },
        },
    );

    try {
        const stream = anthropic.messages.stream({
            model: "claude-sonnet-4.7",
            max_tokens: 1024,
            system: "You are Acme's support assistant. Be concise.",
            messages: [{role: "user", content: question}],
        });

        for await (const event of stream) {
            if (event.type === "content_block_delta" &&
                event.delta.type === "text_delta") {
                handle.appendToken(event.delta.text);
            }
        }
        await handle.finish();
    } catch (err) {
        await handle.abort(err instanceof Error ? err.message : "stream failed");
        throw err;
    }
}

await respondTo("How do I reset my password?");
```

## Example — DM with tool-call + confirmation

A self-contained example that lives inside a one-on-one DM, calls a
`deleteAccount` tool, and blocks on an inline confirmation card
before the tool actually runs. The `zulip-confirmation-response`
`CustomEvent` bridges the user's click back to the orchestrator.

```html
<zulip-chat id="chat"
    server="https://acme.zulipchat.com"
    auth-token="<JWT>"
    dm-user-ids="42,99"
    theme="light"
    brand-name="Acme Support"
></zulip-chat>

<script type="module">
import {ZulipClient, ZulipTransport} from "zulip-embed";

const VIEWER_ID = 42;
const AGENT_ID  = 99;

const transport = new ZulipTransport({
    serverUrl: "https://acme.zulipchat.com",
    authToken: await fetchZulipAuthToken(),
    scope: {kind: "dm", userIds: [VIEWER_ID, AGENT_ID]},
});
const client = new ZulipClient({
    transport,
    scope: {kind: "dm", userIds: [VIEWER_ID, AGENT_ID]},
});
await client.connect();

// Map confirmation id -> resolver for the approval round-trip.
const pendingConfirmations = new Map();

document.querySelector("#chat").addEventListener(
    "zulip-confirmation-response",
    (event) => {
        const {id, action, payloadSig} = event.detail;
        const resolve = pendingConfirmations.get(id);
        if (resolve === undefined) return;
        pendingConfirmations.delete(id);
        // Verify payloadSig on your server before honoring the action.
        resolve({action, payloadSig});
    },
);

async function askForApproval(handle, id, prompt) {
    const payloadSig = await fetch(
        "/api/agent/sign-confirmation",
        {method: "POST", body: JSON.stringify({id, prompt})},
    ).then((r) => r.text());

    handle.appendEvent({
        type: "confirmation",
        id,
        prompt,
        approveLabel: "Delete account",
        denyLabel: "Keep account",
        payloadSig,
    });
    return new Promise((resolve) => pendingConfirmations.set(id, resolve));
}

async function handleDeleteAccountRequest() {
    const handle = client.startAgentReply(
        {kind: "dm", userIds: [VIEWER_ID, AGENT_ID]},
        {
            author: {
                fullName: "Acme Support Bot",
                avatarUrl: "https://acme.example/bot.png",
            },
        },
    );

    handle.appendToken("Deleting your account is permanent. ");
    handle.appendToken("Want me to proceed?\n\n");

    const {action} = await askForApproval(
        handle,
        crypto.randomUUID(),
        "Permanently delete your Acme account?",
    );

    if (action === "deny") {
        handle.appendToken("Got it — nothing changed.");
        await handle.finish();
        return;
    }

    handle.appendEvent({
        type: "tool_call",
        id: "del-1",
        name: "deleteAccount",
        input: {viewerId: VIEWER_ID},
        status: "streaming",
    });

    const result = await fetch("/api/tools/delete-account", {method: "POST"}).then(
        (r) => r.json(),
    );

    handle.appendEvent({
        type: "tool_result",
        toolCallId: "del-1",
        output: result,
        isError: !result.ok,
    });
    handle.appendToken(
        result.ok
            ? "\n\nDone. Your account is deleted."
            : "\n\nThe delete failed — support has been notified.",
    );
    await handle.finish();
}
</script>
```

Notes on the shape above:

- `payloadSig` is signed on your server over `(id, prompt, action)`.
  The widget never mints it; it just echoes it back. When the
  `zulip-confirmation-response` event fires, re-verify the sig
  before acting.
- The DM `scope` repeats twice — once on the transport, once on the
  client — because the transport's narrow drives `/register` +
  `/events`, while the client's scope drives the `isInScope`
  predicate that filters incoming messages into its state.
- `listDirectMessageConversations()` and `<zulip-dm-list>` can back
  the conversation picker above the chat; see the
  [Plug-and-play components](../README.md#plug-and-play-components)
  section of the README.

## Read-only and snapshot transports

`startAgentReply` requires a transport that implements
`sendMessageWithId`. The live `ZulipTransport` and `DemoTransport`
both do; `SnapshotTransport` doesn't (snapshots are read-only). On a
snapshot transport:

```ts
const handle = client.startAgentReply(scope, {author});
handle.appendToken("hi");        // no-op (swallowed)
await handle.messageId;          // rejects with "requires sendMessageWithId"
```

Every other handle method degrades to a no-op so calling code doesn't
crash on read-only pages (e.g. a public embed that also happens to
hold a snapshot fixture). Check `messageId` with a `try / catch` or
guard at the transport level when you need to distinguish.

## React

The `useZulipChat` hook exposes the underlying `ZulipClient`; call
`startAgentReply` on it directly.

```tsx
import {useZulipChat} from "zulip-embed-react";
import {useMemo} from "react";

export function SupportPane({question}: {question: string}) {
    const transport = useMemo(() => new ZulipTransport(...), []);
    const {client, messages} = useZulipChat(transport, scope);

    const onSend = async () => {
        const handle = client.startAgentReply(scope, {
            author: {fullName: "Acme Bot", avatarUrl: "/bot.png"},
        });
        for await (const chunk of streamAgentTokens(question)) {
            handle.appendToken(chunk);
        }
        await handle.finish();
    };

    return <>…</>;
}
```

`<ZulipChat>` also surfaces `zulip-confirmation-response` as
`onConfirmationResponse` — see
[`packages/react/README.md`](/frameworks/react/) for the
full prop reference.

## Flutter parity

The Flutter package mirrors the primitive one-to-one. `ZulipClient`
in `packages/flutter/lib/src/client.dart` exposes a
`startAgentReply(scope, author)` method returning an
`AgentReplyHandle` with the same append / finish / abort surface.
`MessagePart` is a sealed class (`TextPart`, `CodePart`, `ToolCallPart`,
`ToolResultPart`, `ConfirmationPart`). The confirmation card
surfaces approvals through a `ValueChanged<ConfirmationResponse>`
callback on the widget instead of a `CustomEvent`; everything else
is shape-compatible.

Any change to the agent-reply surface in `src/` needs to mirror in
`packages/flutter/lib/src/` in the same sprint — the parity rule
from [`CLAUDE.md`](../CLAUDE.md) catches drift in code review.

## Edge cases worth knowing

- **Provisional message body.** The initial send uses a single
  zero-width space (`\u200b`) because most Zulip deployments enforce
  a minimum content length on `/api/v1/messages`. The first real
  `appendToken` / `finish` replaces it on the next edit.
- **Empty finishes.** If you call `finish()` with no tokens ever
  appended, the final edit still lands (carrying the ZWSP). Useful
  when the agent decides there's nothing to say but you still want
  the message row for a future edit pass.
- **`isInScope` and late tokens.** Tokens that arrive before the
  provisional send resolves are queued; the first broadcast fires
  after `messageId` is known. If `messageId` rejects, queued tokens
  drop silently rather than throwing.
- **Abort during flush.** If `abort()` fires while a debounced edit
  is in flight, the final edit waits for the in-flight one to land
  before sending — no overlapping `editMessage` calls, no out-of-order
  transcript.
- **Backpressure.** The primitive doesn't throttle `appendToken` —
  it only throttles the broadcast. If your token source produces
  faster than the renderer can lay out, the render path (not the
  primitive) is the bottleneck.

## Further reading

- [`docs/events.md`](/reference/events/) — the full `CustomEvent` surface,
  including `zulip-confirmation-response` detail shape.
- [`docs/ARCHITECTURE.md`](https://github.com/amanagr/zulip-embed/blob/main/docs/ARCHITECTURE.md) — transport / scope /
  event pipeline at the architectural level.
- [`docs/theming.md`](/reference/theming/) — tool-card and confirmation-card
  CSS token overrides.
- [`docs/TROUBLESHOOTING.md`](/guides/troubleshooting/) — error codes for
  when the provisional send fails (`rate-limited`, `unauthorized`).
- [`packages/react/README.md`](/frameworks/react/) — React
  wrapper prop reference.
