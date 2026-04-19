// Ambient types for zulip-embed's headless surface — enough for
// the RN widgets to typecheck without compiling the core SDK. Kept
// in sync with the authoritative types that ship in the core
// package's `dist/*.d.ts` so declarations merge cleanly instead of
// introducing phantom fields (e.g. an older shape of `TypingEvent`).
//
// RN doesn't need the DOM-backed pieces (Web Components, render
// pipeline, DOMPurify), so we only re-declare the transport + client
// API. When a consumer app installs zulip-embed and pulls in its
// real `.d.ts`, TypeScript merges this declaration with the one in
// node_modules — any drift here surfaces as a merge conflict at
// compile time, so keep this file in lockstep with the core
// package's exports.

declare module "zulip-embed" {
    export interface Channel {
        channelId: number;
        name: string;
        description: string;
        color?: string;
        pinToTop: boolean;
        isMuted: boolean;
        unreadCount: number;
    }

    export interface Topic {
        name: string;
        maxMessageId: number;
        unreadCount: number;
        isResolved: boolean;
    }

    export interface Reaction {
        emoji: string;
        count: number;
        userIds: number[];
    }

    export interface User {
        userId: number;
        email: string;
        fullName: string;
        avatarUrl: string;
    }

    export type MessageType = "channel" | "direct";

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

    // Scope discriminated union introduced in 0.8. The legacy flat
    // shape is still accepted (normalizeScope widens it at the SDK
    // boundary) so embeds from 0.7 don't need to migrate atomically.
    export interface ChannelScope {
        kind: "channel";
        channel: string;
        topic?: string;
    }

    export interface DmScope {
        kind: "dm";
        userIds: number[];
    }

    export interface LegacyChannelScope {
        channel: string;
        topic?: string;
    }

    export type ScopeFilter = ChannelScope | DmScope | LegacyChannelScope;
    export type NormalizedScope = ChannelScope | DmScope;

    export type ConnectionStatus =
        | "idle"
        | "connecting"
        | "connected"
        | "reconnecting"
        | "disconnected"
        | "error";

    export type SendMessageParams =
        | {type: "channel"; channel: string; topic: string; content: string}
        | {type: "direct"; recipients: string[]; content: string};

    export interface TypingUser {
        userId: number;
        fullName: string;
    }

    export interface TypingEvent {
        type: "typing";
        users: TypingUser[];
    }

    export type TypingOp = "start" | "stop";

    export type ErrorCode =
        | "unauthorized"
        | "channel-not-subscribed"
        | "network"
        | "rate-limited"
        | "jwt-not-configured"
        | "unknown";

    export interface ConnectionEvent {
        type: "connection";
        status: ConnectionStatus;
        attempt?: number;
        delayMs?: number;
        reason?: string;
    }

    export interface ErrorEvent {
        type: "error";
        code: ErrorCode;
        error: string;
        retryAfterMs?: number;
    }

    export interface MessageEvent {
        type: "message";
        message: Message;
    }

    export interface MessageUpdateEvent {
        type: "message-update";
        messageId: number;
        content?: string;
        contentIsHtml?: boolean;
        topic?: string;
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

    export type ZulipEvent =
        | ConnectionEvent
        | MessageEvent
        | MessageUpdateEvent
        | MessageDeleteEvent
        | ReactionEvent
        | TypingEvent
        | ErrorEvent;

    export type ZulipEventListener = (event: ZulipEvent) => void;

    export interface GetMessagesOptions {
        beforeId?: number;
        limit?: number;
    }

    export interface GetMessagesResult {
        messages: Message[];
        hasMore: boolean;
    }

    export type EditMessageParams =
        | {messageId: number; kind: "content"; content: string}
        | {messageId: number; kind: "topic"; topic: string}
        | {messageId: number; kind: "both"; content: string; topic: string};

    export interface ReactionParams {
        messageId: number;
        emoji: string;
    }

    export interface DirectMessageConversation {
        users: User[];
        lastMessageId: number;
        lastMessageTime: number;
    }

    export interface Transport {
        connect(onEvent: ZulipEventListener): Promise<void>;
        close(): Promise<void>;
        getMessages(scope: ScopeFilter, options?: GetMessagesOptions): Promise<GetMessagesResult>;
        sendMessage(params: SendMessageParams): Promise<void>;
        sendMessageWithId?(params: SendMessageParams): Promise<{messageId: number}>;
        editMessage(params: EditMessageParams): Promise<void>;
        deleteMessage(messageId: number): Promise<void>;
        addReaction(params: ReactionParams): Promise<void>;
        removeReaction(params: ReactionParams): Promise<void>;
        sendTyping(op: TypingOp, scope: ScopeFilter): Promise<void>;
        listChannels(): Promise<Channel[]>;
        listTopics(channel: string): Promise<Topic[]>;
        listDirectMessageConversations?(): Promise<DirectMessageConversation[]>;
        fetchMessage?(messageId: number): Promise<Message | undefined>;
        getCurrentUserId(): number | undefined;
        getCurrentUser(): Promise<User>;
    }

    export class ZulipClient {
        constructor(options: {transport: Transport; scope: ScopeFilter});
        connect(): Promise<void>;
        disconnect(): Promise<void>;
        close(): Promise<void>;
        getMessages(scope: ScopeFilter, options?: GetMessagesOptions): Promise<GetMessagesResult>;
        loadOlder(): Promise<void>;
        sendMessage(content: string): Promise<void>;
        sendMessage(params: SendMessageParams): Promise<void>;
        editMessage(params: EditMessageParams): Promise<void>;
        deleteMessage(messageId: number): Promise<void>;
        addReaction(params: ReactionParams): Promise<void>;
        removeReaction(params: ReactionParams): Promise<void>;
        sendTyping(op: TypingOp, scope: ScopeFilter): Promise<void>;
        listChannels(): Promise<Channel[]>;
        listTopics(channel: string): Promise<Topic[]>;
        listDirectMessageConversations(): Promise<DirectMessageConversation[]>;
        fetchMessage(messageId: number): Promise<Message | undefined>;
        getCurrentUserId(): number | undefined;
        readonly whenReady: Promise<User>;
        getState(): {messages: Message[]; status: ConnectionStatus};
        subscribe(listener: ZulipEventListener): () => void;
        subscribeState(listener: () => void): () => void;
    }

    export class DemoTransport implements Transport {
        constructor(options?: unknown);
        connect(onEvent: ZulipEventListener): Promise<void>;
        close(): Promise<void>;
        getMessages(scope: ScopeFilter, options?: GetMessagesOptions): Promise<GetMessagesResult>;
        sendMessage(params: SendMessageParams): Promise<void>;
        editMessage(params: EditMessageParams): Promise<void>;
        deleteMessage(messageId: number): Promise<void>;
        addReaction(params: ReactionParams): Promise<void>;
        removeReaction(params: ReactionParams): Promise<void>;
        sendTyping(op: TypingOp, scope: ScopeFilter): Promise<void>;
        listChannels(): Promise<Channel[]>;
        listTopics(channel: string): Promise<Topic[]>;
        getCurrentUserId(): number | undefined;
        getCurrentUser(): Promise<User>;
    }

    export interface ZulipTransportOptions {
        serverUrl: string;
        scope: ScopeFilter;
        historyLimit?: number;
        email?: string;
        apiKey?: string;
        authToken?: string;
    }

    export class ZulipTransport implements Transport {
        constructor(options: ZulipTransportOptions);
        connect(onEvent: ZulipEventListener): Promise<void>;
        close(): Promise<void>;
        getMessages(scope: ScopeFilter, options?: GetMessagesOptions): Promise<GetMessagesResult>;
        sendMessage(params: SendMessageParams): Promise<void>;
        editMessage(params: EditMessageParams): Promise<void>;
        deleteMessage(messageId: number): Promise<void>;
        addReaction(params: ReactionParams): Promise<void>;
        removeReaction(params: ReactionParams): Promise<void>;
        sendTyping(op: TypingOp, scope: ScopeFilter): Promise<void>;
        listChannels(): Promise<Channel[]>;
        listTopics(channel: string): Promise<Topic[]>;
        getCurrentUserId(): number | undefined;
        getCurrentUser(): Promise<User>;
    }
}
