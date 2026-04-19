export type MessageType = "channel" | "direct";

export interface User {
    userId: number;
    email: string;
    fullName: string;
    avatarUrl: string;
}

export interface Reaction {
    emoji: string;
    count: number;
    userIds: number[];
}

// MessagePart is the structured representation of a message body, used
// when a host wants to render agent output (tool calls, tool results,
// code blocks) as first-class UI rather than as a flat HTML string.
// `content` / `contentIsHtml` on the Message remain the source of truth
// for everything the transport emits today; `parts` is purely additive,
// so existing consumers keep working and only opt-in when they have
// structured content to display.
export type MessagePart =
    | TextMessagePart
    | CodeMessagePart
    | ToolCallMessagePart
    | ToolResultMessagePart
    | ConfirmationMessagePart;

// Attribution for a single MessagePart. In multi-agent chats (a planner
// agent + a research agent + a tool executor, all co-authoring one
// Message bubble), each part can carry its own author so the renderer
// can visually tag which agent produced which step. Optional everywhere
// so existing single-sender messages and snapshots keep working.
export interface MessagePartAuthor {
    // Stable identifier within a session. Host apps use this to drive
    // display (avatars, colors) and to correlate parts across messages
    // with the same agent.
    id: string;
    // Human-readable name, e.g. "Planner", "Research agent".
    name: string;
    // Optional display color hint — when present, the renderer uses it
    // as a thin left accent bar on the part card. Must be a CSS-safe
    // hex color (#rgb/#rgba/#rrggbb/#rrggbbaa); anything else is
    // ignored rather than applied, to keep untrusted host values from
    // smuggling arbitrary CSS into the shadow tree.
    color?: string | undefined;
    // Optional avatar URL. Subject to the same http(s)-only validation
    // as Message.avatarUrl — unsafe schemes fall back to initials.
    avatarUrl?: string | undefined;
}

export interface TextMessagePart {
    type: "text";
    text: string;
    author?: MessagePartAuthor | undefined;
}

export interface CodeMessagePart {
    type: "code";
    code: string;
    // Set when the host knows the language (e.g. "python", "typescript").
    // Left undefined when the source didn't declare one — renderers
    // should fall back to a plain <pre> in that case.
    language?: string | undefined;
    author?: MessagePartAuthor | undefined;
}

// A tool invocation issued by an agent. `status` tracks the lifecycle:
// - "pending": queued but not yet sent to the tool
// - "streaming": the agent is still filling in input (arguments) or the
//   tool is still running and producing output
// - "complete": finished successfully (a matching ToolResultMessagePart
//   should appear elsewhere in the parts array with the same id)
// - "error": the tool reported an error; the paired ToolResultMessagePart
//   will have isError=true
export interface ToolCallMessagePart {
    type: "tool_call";
    id: string;
    name: string;
    input: unknown;
    status?: "pending" | "streaming" | "complete" | "error" | undefined;
    author?: MessagePartAuthor | undefined;
}

export interface ToolResultMessagePart {
    type: "tool_result";
    toolCallId: string;
    output: unknown;
    isError?: boolean | undefined;
    author?: MessagePartAuthor | undefined;
}

// Inline "run tool X?" prompt the agent emits to block on a human
// decision. The widget renders a compact card with prompt text + two
// buttons; a click dispatches a `zulip-confirmation-response`
// CustomEvent the embedder wires back to its agent orchestrator.
// `payloadSig` is opaque to the widget — the host produced it over
// `(id, prompt, action)` so a malicious renderer can't forge an
// approval. The widget just echoes it back in the response event.
export interface ConfirmationMessagePart {
    type: "confirmation";
    id: string;
    prompt: string;
    approveLabel?: string | undefined;
    denyLabel?: string | undefined;
    payloadSig: string;
    author?: MessagePartAuthor | undefined;
}

interface MessageBase {
    id: number;
    senderId: number;
    senderFullName: string;
    senderEmail: string;
    avatarUrl: string;
    timestamp: number;
    content: string;
    contentIsHtml: boolean;
    // Structured representation. Only set when the sender emitted
    // parts-shaped content (agent messages); regular human messages
    // leave this undefined and the renderer falls back to `content`.
    parts?: MessagePart[] | undefined;
    reactions: Reaction[];
}

export interface ChannelMessage extends MessageBase {
    type: "channel";
    channelName: string;
    topic: string;
}

export interface DirectMessage extends MessageBase {
    type: "direct";
    recipients: User[];
}

export type Message = ChannelMessage | DirectMessage;

export interface Channel {
    channelId: number;
    name: string;
    description: string;
    color?: string | undefined;
    pinToTop?: boolean | undefined;
    isMuted?: boolean | undefined;
    unreadCount?: number | undefined;
}

export interface Topic {
    name: string;
    maxMessageId: number;
    unreadCount?: number | undefined;
    isResolved?: boolean | undefined;
}

export type SendMessageParams =
    | {
          type: "channel";
          channel: string;
          topic: string;
          content: string;
      }
    | {
          type: "direct";
          recipients: string[];
          content: string;
      };

export type ConnectionStatus =
    | "idle"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected"
    | "error";

export interface ConnectionEvent {
    type: "connection";
    status: ConnectionStatus;
    // Populated when status === "reconnecting": the current backoff attempt
    // (1-indexed) and the delay in ms before the next retry.
    attempt?: number | undefined;
    delayMs?: number | undefined;
    reason?: string | undefined;
}

export interface MessageEvent {
    type: "message";
    message: Message;
}

export interface MessageUpdateEvent {
    type: "message-update";
    messageId: number;
    content?: string | undefined;
    contentIsHtml?: boolean | undefined;
    topic?: string | undefined;
    editedTimestamp?: number | undefined;
    // Structured representation of the updated message. Emitted by the
    // agent-reply streaming primitive so the local renderer can swap in
    // a new parts array (token-by-token during streaming, then the final
    // parts on finish/abort) without touching `content`. Undefined means
    // the parts of the message didn't change — consumers should leave
    // any existing Message.parts in place.
    parts?: MessagePart[] | undefined;
}

export interface MessageDeleteEvent {
    type: "message-delete";
    messageId: number;
}

export interface ReactionEvent {
    type: "reaction";
    messageId: number;
    reactions: Reaction[];
}

export interface TypingUser {
    userId: number;
    fullName: string;
}

export interface TypingEvent {
    type: "typing";
    users: TypingUser[];
}

// Error classification surfaced to consumers. Code is the stable machine
// handle; `error` is the human-readable message. `retryAfterMs` is set on
// rate-limit responses so UI can throttle.
export type ErrorCode =
    | "unauthorized"
    | "channel-not-subscribed"
    | "network"
    | "rate-limited"
    | "jwt-not-configured"
    | "unknown";

export interface ErrorEvent {
    type: "error";
    code: ErrorCode;
    error: string;
    retryAfterMs?: number | undefined;
}

export type ZulipEvent =
    | ConnectionEvent
    | MessageEvent
    | MessageUpdateEvent
    | MessageDeleteEvent
    | ReactionEvent
    | TypingEvent
    | ErrorEvent;

export type ZulipEventListener = (event: ZulipEvent) => void;

// Detail shapes for the CustomEvents the `<zulip-chat>` element dispatches
// on its host. Consumers that listen with `addEventListener` (or React's
// `on*` props) get these as `CustomEvent<T>["detail"]`.
export interface ZulipMessageEventDetail {
    message: Message;
}

export interface ZulipConnectionChangeEventDetail {
    status: ConnectionStatus;
    attempt?: number | undefined;
    delayMs?: number | undefined;
    reason?: string | undefined;
}

export interface ZulipErrorEventDetail {
    code: ErrorCode;
    error: string;
    retryAfterMs?: number | undefined;
}

// Fired on the `<zulip-chat>` host when the viewer clicks Approve or
// Deny inside a ConfirmationMessagePart card. Embedders route this to
// their agent orchestrator to unblock (or cancel) the proposed tool
// call. `payloadSig` is echoed through verbatim so the host can
// verify it — the widget itself does not.
export interface ZulipConfirmationResponseEventDetail {
    id: string;
    action: "approve" | "deny";
    payloadSig: string;
}

// Discriminated union identifying either a channel/topic narrow or a
// direct-message conversation. Historically this was a flat object with
// `{channel, topic?}`; the legacy shape is still accepted by `normalizeScope`
// below for one release, with a deprecation warning logged once per caller.
//
// Callers migrating to DMs pick [DmScope] instead: `userIds` is the sorted
// list of user ids identifying the conversation (one-on-one: two ids;
// group DM: three or more). The transport layer normalizes the order
// before building the Zulip narrow so snapshot equality is stable
// regardless of how the caller spelled the list.
export type ScopeFilter = ChannelScope | DmScope | LegacyChannelScope;

export interface ChannelScope {
    kind: "channel";
    channel: string;
    topic?: string | undefined;
}

export interface DmScope {
    kind: "dm";
    // Sorted list of user ids identifying the DM conversation. Always
    // includes the viewer's own id so the narrow resolves the same way
    // on every peer's feed. Transports canonicalize (dedupe + sort) on
    // construction, but consumers should pass a pre-sorted list so
    // downstream equality checks work without a helper call.
    userIds: number[];
}

// Legacy flat shape retained for back-compat. Treated equivalent to a
// `{kind: "channel", ...}` ChannelScope by `normalizeScope`. Removed in
// a future major release.
export interface LegacyChannelScope {
    channel: string;
    topic?: string | undefined;
}

// Canonical form handed to transport internals. Never has `LegacyChannelScope`
// — `normalizeScope` has already widened it to `ChannelScope` by the time
// a transport sees it.
export type NormalizedScope = ChannelScope | DmScope;
