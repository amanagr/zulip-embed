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

export interface Message {
    id: number;
    senderId: number;
    senderFullName: string;
    senderEmail: string;
    avatarUrl: string;
    timestamp: number;
    content: string;
    contentIsHtml: boolean;
    type: MessageType;
    channelName: string | undefined;
    topic: string | undefined;
    reactions: Reaction[];
}

export interface Channel {
    channelId: number;
    name: string;
    description: string;
    // Present for subscribed channels surfaced by listChannels(). Omit
    // for channel objects that describe a scope the viewer isn't a
    // member of (e.g. discovery flows) so UIs can branch on the shape.
    color?: string | undefined;
    pinToTop?: boolean | undefined;
    isMuted?: boolean | undefined;
    unreadCount?: number | undefined;
}

export interface Topic {
    name: string;
    // Newest message id in the topic. Lets the UI sort without having to
    // re-derive chronology from the message list.
    maxMessageId: number;
    unreadCount?: number | undefined;
    isResolved?: boolean | undefined;
}

export interface SendMessageParams {
    type: "channel" | "direct";
    channel?: string | undefined;
    topic?: string | undefined;
    recipients?: string[] | undefined;
    content: string;
}

export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface ConnectionEvent {
    type: "connection";
    status: ConnectionStatus;
}

export interface MessageEvent {
    type: "message";
    message: Message;
}

export interface MessageUpdateEvent {
    type: "message-update";
    messageId: number;
    // Updated content. Absent when the edit only touches topic/channel.
    content?: string | undefined;
    // Whether `content` is server-rendered HTML (true for ZulipTransport,
    // which always sets apply_markdown=true) or plain text. Consumers
    // must honor this flag rather than inferring HTML from the presence
    // of `content` — otherwise an edit from a future non-HTML transport
    // would silently flow through the HTML sanitizer on the wrong path.
    contentIsHtml?: boolean | undefined;
    topic?: string | undefined;
    editedTimestamp?: number | undefined;
}

export interface MessageDeleteEvent {
    type: "message-delete";
    messageId: number;
}

// Zulip's reaction event stream is per-user: one event per (message, emoji,
// user) tuple, with op: "add" | "remove". The transport keeps bucket state
// in sync and re-emits the full updated reactions list for the message so
// UI subscribers don't need to know about the per-user event shape.
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
    // The full set of users currently typing in the active scope. Emit
    // the full set on every change (rather than op=add/remove) so UI
    // consumers don't have to track state themselves.
    users: TypingUser[];
}

export interface ErrorEvent {
    type: "error";
    error: string;
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

export interface ScopeFilter {
    channel: string;
    topic?: string | undefined;
}
