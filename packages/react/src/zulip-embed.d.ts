// Ambient types for @zulip/embed — a subset of what the root package
// exports, just enough for the React wrappers to typecheck without
// compiling the whole SDK. When consumers install both packages,
// TypeScript's module resolution picks up the real .d.ts from the
// root package's dist/ and these declarations are overridden.

declare module "@zulip/embed" {
    export class ZulipChatElement extends HTMLElement {
        open(): void;
        close(): void;
    }
    export class ZulipChannelListElement extends HTMLElement {}
    export class ZulipTopicListElement extends HTMLElement {}

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

    export type MessageType = "channel" | "direct";

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
        channelName?: string;
        topic?: string;
        reactions: Reaction[];
    }

    export interface ScopeFilter {
        channel: string;
        topic?: string;
    }

    export type ConnectionStatus =
        | "idle"
        | "connecting"
        | "connected"
        | "disconnected"
        | "error";

    export interface SendMessageParams {
        content: string;
        channel?: string;
        topic?: string;
    }

    export interface User {
        id: number;
        fullName: string;
        email: string;
        avatarUrl: string;
    }

    export type ZulipEvent =
        | {type: "connection"; status: ConnectionStatus}
        | {type: "error"; error: string}
        | {type: string; [key: string]: unknown};

    export type ZulipEventListener = (event: ZulipEvent) => void;

    export interface Transport {
        connect(onEvent: ZulipEventListener): Promise<void>;
        close(): Promise<void>;
    }
}
