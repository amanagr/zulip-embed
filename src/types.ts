export type MessageType = "stream" | "private";

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
    streamName: string | undefined;
    topic: string | undefined;
    reactions: Reaction[];
}

export interface Stream {
    streamId: number;
    name: string;
    description: string;
}

export interface SendMessageParams {
    type: "stream" | "direct";
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

export interface TypingEvent {
    type: "typing";
    userIds: number[];
}

export interface ErrorEvent {
    type: "error";
    error: string;
}

export type ZulipEvent = ConnectionEvent | MessageEvent | TypingEvent | ErrorEvent;

export type ZulipEventListener = (event: ZulipEvent) => void;

export interface ScopeFilter {
    channel: string;
    topic?: string | undefined;
}
