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

interface MessageBase {
    id: number;
    senderId: number;
    senderFullName: string;
    senderEmail: string;
    avatarUrl: string;
    timestamp: number;
    content: string;
    contentIsHtml: boolean;
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
