import {normalizeScope} from "./scope.ts";
import type {Transport} from "./transport.ts";
import type {
    MessagePart,
    NormalizedScope,
    ScopeFilter,
    SendMessageParams,
    TextMessagePart,
    User,
    ZulipEventListener,
} from "./types.ts";

export interface AgentAuthor {
    fullName: string;
    avatarUrl: string;
    // Free-form tag that surfaces through later agent-author rendering
    // (#8). Not used by the streaming primitive itself — carried here so
    // hosts can set it once at startAgentReply() time and have it survive
    // the round trip to any UI that cares.
    agentModel?: string | undefined;
}

export interface StartAgentReplyOptions {
    author: Pick<User, "fullName" | "avatarUrl"> & {agentModel?: string | undefined};
}

export interface AgentReplyHandle {
    // Resolves once the provisional message has landed on the server and
    // the handle knows the id to edit. Rejects if the initial send fails,
    // in which case every other method on the handle becomes a no-op.
    messageId: Promise<number>;
    // Append a streaming text token. Tokens coalesce into the trailing
    // TextMessagePart in the running parts buffer so the renderer can
    // update a single text node instead of thrashing whole subtrees.
    appendToken(text: string): void;
    // Append a structured event (tool call, tool result, code block, …).
    // A new TextMessagePart is started after this so subsequent
    // appendToken calls don't fold into the event's text.
    appendEvent(event: MessagePart): void;
    // Flush any pending edit, then send one terminal edit with the
    // final content. Callers can override the final text or parts by
    // passing them in — useful for agents that want to replace the
    // streamed transcript with a cleanly formatted version at the end.
    finish(final?: {parts?: MessagePart[]; content?: string}): Promise<void>;
    // Abort an in-flight stream. Resolves once the final edit carrying
    // the partial content + an aborted marker has landed. Never throws —
    // network failures during the abort are swallowed so callers can
    // `await handle.abort()` in `finally` blocks.
    abort(reason?: string): Promise<void>;
}

// Time-window between broadcast edits during streaming. 250 ms caps the
// edit-message RPS at 4 Hz; faster would flood Zulip's rate-limiter on
// busy streams and serves no visual purpose (4 Hz already reads as
// smooth to human eyes when the renderer does incremental text-node
// updates).
export const STREAMING_EDIT_WINDOW_MS = 250;

// Sentinel toolCallId on the synthetic tool_result part appended when
// the stream is aborted. The renderer treats this as a terminal marker
// and consumers can key off it to show an "agent stopped" badge. Kept
// namespaced so a real tool that happened to use the literal string
// "aborted" as its id wouldn't collide.
export const AGENT_REPLY_ABORT_TOOL_ID = "__zulip_agent_reply_abort__";

interface AgentReplyDeps {
    transport: Transport;
    scope: ScopeFilter;
    options: StartAgentReplyOptions;
    // Forwarded to the client so provisional sends + incremental edits
    // fold into the same event stream the rest of the SDK speaks. Lets
    // the client's state stay in sync without the handle having to poke
    // at it directly.
    emit: ZulipEventListener;
    // Resolves the connected viewer — only needed to fill in senderId /
    // senderEmail on the synthetic local message. When unavailable (the
    // transport hasn't finished /users/me yet) we fall back to a synthetic
    // id so the UI still has something to key on.
    getCurrentUser?: (() => Promise<User>) | undefined;
}

export function createAgentReplyHandle(deps: AgentReplyDeps): AgentReplyHandle {
    const {transport, scope, options, emit} = deps;
    if (transport.sendMessageWithId === undefined) {
        const reason = "startAgentReply requires a transport that implements sendMessageWithId";
        const handle: AgentReplyHandle = {
            messageId: Promise.reject(new Error(reason)),
            appendToken: () => {},
            appendEvent: () => {},
            finish: () => Promise.reject(new Error(reason)),
            abort: () => Promise.resolve(),
        };
        // Mark the rejection as handled so the test runner doesn't yell
        // about an unhandled promise rejection — callers awaiting
        // .messageId will still observe the rejection when they do.
        handle.messageId.catch(() => {});
        return handle;
    }
    const sendMessageWithId = transport.sendMessageWithId.bind(transport);

    // Mutable buffers. `parts` is authoritative; `content` is the flat
    // projection sent over the wire (editMessage doesn't carry parts,
    // so we flatten on every broadcast). A single trailing TextMessagePart
    // accumulates streamed tokens so appendToken is O(1) rather than
    // reallocating parts on every call.
    const parts: MessagePart[] = [];
    let trailingText: TextMessagePart | undefined;
    let aborted = false;
    let finished = false;
    // Content as-of the last broadcast edit. Used to short-circuit
    // redundant editMessage calls when the viewer-only tokens don't
    // change the wire content (e.g. a tool_call part that renders
    // structurally but doesn't flatten into text).
    let lastBroadcastContent = "";
    // Debounce bookkeeping. `pendingEdit` is set while a timer is armed;
    // clearing it cancels a deferred broadcast. `inFlightEdit` tracks a
    // network call currently in progress so we don't stack them.
    let pendingEdit: ReturnType<typeof setTimeout> | undefined;
    let inFlightEdit: Promise<void> | undefined;
    // Provisional send state. Every public method awaits this before
    // touching the transport so we never leak a pre-id edit.
    let resolvedMessageId: number | undefined;
    const {provisionalContent} = initialPartsState(options);

    // Resolve the provisional send params off the scope. Channel scopes
    // route to `type: "channel"` on the wire; DM scopes route to
    // `type: "direct"` with the recipient id list (stringified, matching
    // the `SendMessageParams` discriminated union from 0.2). DM
    // streaming edits are identical to the channel path — the
    // server-assigned id is stable across narrow changes, so the same
    // debounced `editMessage` loop works without DM-specific branching.
    const normalized = normalizeScope(scope);
    const sendParams: SendMessageParams =
        normalized.kind === "channel"
            ? {
                  type: "channel",
                  channel: normalized.channel,
                  topic: normalized.topic ?? "",
                  content: provisionalContent,
              }
            : {
                  type: "direct",
                  recipients: dmRecipients(normalized.userIds, () =>
                      transport.getCurrentUserId?.(),
                  ).map(String),
                  content: provisionalContent,
              };

    const messageIdPromise = sendMessageWithId(sendParams).then((result) => {
        resolvedMessageId = result.messageId;
        lastBroadcastContent = provisionalContent;
        // Synthesize an initial "message" event so the client's local
        // state picks up the provisional agent row before the server
        // event queue catches up. Senders on the wire carry the viewer
        // identity; in agent-mode we override the display fields via
        // the `author` option so the row renders as the agent.
        void emitInitialMessage({
            emit,
            getCurrentUser: deps.getCurrentUser,
            normalizedScope: normalized,
            options,
            messageId: result.messageId,
            content: provisionalContent,
        });
        return result.messageId;
    });
    // Keep the rejection from propagating as an unhandled rejection. It
    // still reaches callers that await .messageId.
    messageIdPromise.catch(() => {});

    function scheduleBroadcast(): void {
        if (resolvedMessageId === undefined) return;
        if (pendingEdit !== undefined) return;
        // Always debounce — leading-edge broadcasts at 60fps would
        // flood the server on bursty agents. Trailing-edge at 250 ms
        // caps broadcast at 4 Hz which is the advertised streaming
        // rate on the wire.
        pendingEdit = setTimeout(() => {
            pendingEdit = undefined;
            void flushBroadcast();
        }, STREAMING_EDIT_WINDOW_MS);
    }

    async function flushBroadcast(): Promise<void> {
        if (resolvedMessageId === undefined) return;
        if (inFlightEdit !== undefined) await inFlightEdit;
        const content = flatten(parts);
        if (content === lastBroadcastContent) return;
        lastBroadcastContent = content;
        const editCall = transport
            .editMessage({
                messageId: resolvedMessageId,
                kind: "content",
                content,
            })
            .catch(() => {
                // Swallow network errors during streaming; the next edit
                // will overwrite the stale state anyway. Finish/abort
                // surface errors separately.
            });
        inFlightEdit = editCall.then(() => {
            inFlightEdit = undefined;
        });
        await editCall;
    }

    function emitLocalUpdate(): void {
        if (resolvedMessageId === undefined) return;
        emit({
            type: "message-update",
            messageId: resolvedMessageId,
            content: flatten(parts),
            contentIsHtml: false,
            parts: [...parts],
        });
    }

    function appendToken(text: string): void {
        if (finished || text.length === 0) return;
        if (trailingText === undefined) {
            trailingText = {type: "text", text: ""};
            parts.push(trailingText);
        }
        trailingText = {type: "text", text: trailingText.text + text};
        parts[parts.length - 1] = trailingText;
        if (resolvedMessageId !== undefined) {
            emitLocalUpdate();
            scheduleBroadcast();
            return;
        }
        // Provisional send hasn't resolved yet. Queue the broadcast for
        // when the id arrives so late-arriving tokens aren't lost.
        void messageIdPromise.then(() => {
            emitLocalUpdate();
            scheduleBroadcast();
        });
    }

    function appendEvent(event: MessagePart): void {
        if (finished) return;
        parts.push(event);
        trailingText = undefined;
        if (resolvedMessageId !== undefined) {
            emitLocalUpdate();
            scheduleBroadcast();
            return;
        }
        void messageIdPromise.then(() => {
            emitLocalUpdate();
            scheduleBroadcast();
        });
    }

    async function finish(final?: {parts?: MessagePart[]; content?: string}): Promise<void> {
        if (finished) return;
        finished = true;
        if (pendingEdit !== undefined) {
            clearTimeout(pendingEdit);
            pendingEdit = undefined;
        }
        await messageIdPromise;
        if (resolvedMessageId === undefined) return;

        const finalParts =
            final?.parts !== undefined
                ? [...final.parts]
                : final?.content !== undefined
                  ? [{type: "text" as const, text: final.content}]
                  : [...parts];
        parts.length = 0;
        for (const p of finalParts) parts.push(p);
        const finalContent = final?.content ?? flatten(parts);

        if (inFlightEdit !== undefined) await inFlightEdit;
        await transport.editMessage({
            messageId: resolvedMessageId,
            kind: "content",
            content: finalContent,
        });
        lastBroadcastContent = finalContent;
        emit({
            type: "message-update",
            messageId: resolvedMessageId,
            content: finalContent,
            contentIsHtml: false,
            parts: [...parts],
        });
    }

    async function abort(reason?: string): Promise<void> {
        if (finished) return;
        aborted = true;
        // Append the abort marker to whatever's already in the buffer so
        // finish() writes both the partial transcript and the stop signal
        // in a single terminal edit.
        parts.push({
            type: "tool_result",
            toolCallId: AGENT_REPLY_ABORT_TOOL_ID,
            output: reason ?? "aborted",
            isError: true,
        });
        trailingText = undefined;
        try {
            await finish();
        } catch {
            // Abort is best-effort — never throw out of it so callers
            // can put it in a finally block.
        }
        // aborted is read by consumers that observe the handle; reference
        // here so TS doesn't flag the assignment as dead code.
        void aborted;
    }

    return {
        messageId: messageIdPromise,
        appendToken,
        appendEvent,
        finish,
        abort,
    };
}

function initialPartsState(_options: StartAgentReplyOptions): {provisionalContent: string} {
    // Zero-width space so Zulip's server doesn't reject an empty message
    // body. Most Zulip deployments enforce a minimum content length on
    // /api/v1/messages — a single ZWSP passes validation and renders
    // invisibly while we stream tokens into the edit endpoint.
    return {provisionalContent: "\u200b"};
}

// Drops the viewer from a DM participant list so the Zulip /messages
// endpoint doesn't reject the send with "you can't DM yourself". If the
// viewer isn't resolved yet (transport still completing /users/me) or
// the viewer is genuinely the only participant (self-DM), we hand the
// raw list through untouched and let the server arbitrate. Mirrors
// `ZulipClient.sendMessage`'s DM routing so the two code paths stay in
// lock-step when either gains smarter recipient handling later.
function dmRecipients(
    userIds: readonly number[],
    getCurrentUserId: (() => number | undefined) | undefined,
): number[] {
    const viewerId = getCurrentUserId?.();
    if (viewerId === undefined) return [...userIds];
    const filtered = userIds.filter((id) => id !== viewerId);
    return filtered.length === 0 ? [...userIds] : filtered;
}

function flatten(parts: readonly MessagePart[]): string {
    // Only text parts contribute to the wire content; structured parts
    // are a local-render concern (#6 will introduce wire serialization).
    // If no text has accumulated we still emit a ZWSP so editMessage
    // doesn't reject the body.
    const pieces: string[] = [];
    for (const part of parts) {
        if (part.type === "text") {
            pieces.push(part.text);
        }
    }
    const joined = pieces.join("");
    return joined.length === 0 ? "\u200b" : joined;
}

async function emitInitialMessage(args: {
    emit: ZulipEventListener;
    getCurrentUser: (() => Promise<User>) | undefined;
    normalizedScope: NormalizedScope;
    options: StartAgentReplyOptions;
    messageId: number;
    content: string;
}): Promise<void> {
    const {emit, getCurrentUser, normalizedScope, options, messageId, content} = args;
    // Best-effort viewer lookup. Agents speak through the connected
    // viewer's credentials on Zulip, so the backing message is "from
    // the viewer" on the wire; we override the display name + avatar
    // locally via the author option so the UI reflects the agent.
    let viewer: User | undefined;
    if (getCurrentUser !== undefined) {
        try {
            viewer = await getCurrentUser();
        } catch {
            // Fall through to the synthetic defaults.
        }
    }
    const senderId = viewer?.userId ?? -1;
    const senderEmail = viewer?.email ?? "";
    const base = {
        id: messageId,
        senderId,
        senderFullName: options.author.fullName,
        senderEmail,
        avatarUrl: options.author.avatarUrl,
        timestamp: Date.now(),
        content,
        contentIsHtml: false,
        parts: [] as MessagePart[],
        reactions: [],
    };
    if (normalizedScope.kind === "channel") {
        emit({
            type: "message",
            message: {
                ...base,
                type: "channel",
                channelName: normalizedScope.channel,
                topic: normalizedScope.topic ?? "",
            },
        });
        return;
    }
    // DM scope: synthesize a DirectMessage whose recipients (plus the
    // sender) canonicalize to exactly normalizedScope.userIds, so the
    // client's `isInScope` predicate accepts this provisional row. When
    // the viewer can't be resolved yet we fall back to a placeholder
    // that keeps the set-size invariant — the row still renders against
    // the current scope even if the senderId echoes one of the
    // recipients.
    const recipients: User[] = [];
    for (const id of normalizedScope.userIds) {
        if (id === senderId) continue;
        recipients.push(
            id === viewer?.userId
                ? {
                      userId: id,
                      email: viewer.email,
                      fullName: viewer.fullName,
                      avatarUrl: viewer.avatarUrl,
                  }
                : {userId: id, email: "", fullName: "", avatarUrl: ""},
        );
    }
    emit({
        type: "message",
        message: {
            ...base,
            type: "direct",
            recipients,
        },
    });
}
