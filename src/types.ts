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
    | ToolResultMessagePart;

export interface TextMessagePart {
    type: "text";
    text: string;
}

export interface CodeMessagePart {
    type: "code";
    code: string;
    // Set when the host knows the language (e.g. "python", "typescript").
    // Left undefined when the source didn't declare one — renderers
    // should fall back to a plain <pre> in that case.
    language?: string | undefined;
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
}

export interface ToolResultMessagePart {
    type: "tool_result";
    toolCallId: string;
    output: unknown;
    isError?: boolean | undefined;
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

export interface ScopeFilter {
    channel: string;
    topic?: string | undefined;
}
