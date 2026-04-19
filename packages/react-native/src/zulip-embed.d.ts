// Ambient types for @zulip/embed's headless surface — enough for
// the RN widgets to typecheck without compiling the core SDK. When
// consumers install @zulip/embed, the real .d.ts overrides these.
//
// RN doesn't need the DOM-backed pieces (Web Components, render
// pipeline, DOMPurify), so we only re-declare the transport + client
// API.

declare module "@zulip/embed" {
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

    export interface ScopeFilter {
        channel: string;
        topic?: string;
    }

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

    export type TypingOp = "start" | "stop";

    export type ErrorCode =
        | "unauthorized"
        | "channel-not-subscribed"
        | "network"
        | "rate-limited"
        | "jwt-not-configured"
        | "unknown";

    export type ZulipEvent =
        | {
              type: "connection";
              status: ConnectionStatus;
              attempt?: number;
              delayMs?: number;
              reason?: string;
          }
        | {type: "error"; code: ErrorCode; error: string; retryAfterMs?: number}
        | {type: "message"; message: Message}
        | {type: "typing"; op: TypingOp; user: TypingUser; scope: ScopeFilter}
        | {type: string; [key: string]: unknown};

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

    export interface Transport {
        connect(onEvent: ZulipEventListener): Promise<void>;
        close(): Promise<void>;
        getMessages(scope: ScopeFilter, options?: GetMessagesOptions): Promise<GetMessagesResult>;
        sendMessage(params: SendMessageParams): Promise<void>;
        editMessage?(params: EditMessageParams): Promise<void>;
        deleteMessage?(messageId: number): Promise<void>;
        addReaction?(params: ReactionParams): Promise<void>;
        removeReaction?(params: ReactionParams): Promise<void>;
        sendTyping?(op: TypingOp, scope: ScopeFilter): Promise<void>;
        listChannels?(): Promise<Channel[]>;
        listTopics?(channel: string): Promise<Topic[]>;
        getCurrentUserId?(): number | undefined;
        getCurrentUser?(): Promise<User>;
    }

    export class ZulipClient {
        constructor(options: {transport: Transport; scope: ScopeFilter});
        connect(): Promise<void>;
        close(): Promise<void>;
        getState(): {messages: Message[]; status: ConnectionStatus};
        subscribe(listener: () => void): () => void;
        sendMessage(content: string): Promise<void>;
        loadOlder(): Promise<void>;
        readonly whenReady: Promise<User>;
    }

    export class DemoTransport implements Transport {
        constructor(options?: unknown);
        connect(onEvent: ZulipEventListener): Promise<void>;
        close(): Promise<void>;
        getMessages(scope: ScopeFilter, options?: GetMessagesOptions): Promise<GetMessagesResult>;
        sendMessage(params: SendMessageParams): Promise<void>;
    }

    export class ZulipTransport implements Transport {
        constructor(options: {
            server: string;
            email: string;
            apiKey: string;
            scope: ScopeFilter;
        });
        connect(onEvent: ZulipEventListener): Promise<void>;
        close(): Promise<void>;
        getMessages(scope: ScopeFilter, options?: GetMessagesOptions): Promise<GetMessagesResult>;
        sendMessage(params: SendMessageParams): Promise<void>;
    }
}
