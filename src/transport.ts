import type {
    Channel,
    Message,
    ScopeFilter,
    SendMessageParams,
    Topic,
    User,
    ZulipEventListener,
} from "./types.ts";

export interface ReactionParams {
    messageId: number;
    emoji: string;
}

export interface GetMessagesOptions {
    beforeId?: number | undefined;
    limit?: number | undefined;
}

export interface GetMessagesResult {
    messages: Message[];
    hasMore: boolean;
}

export type TypingOp = "start" | "stop";

// Discriminated on `kind` so the type of each edit is unambiguous at call
// sites. The transport needs to know whether the caller wants to change
// content, topic, or both; conflating them with optional fields made it
// too easy to send an empty PATCH or forget a field server-side.
export type EditMessageParams =
    | {messageId: number; kind: "content"; content: string}
    | {messageId: number; kind: "topic"; topic: string}
    | {messageId: number; kind: "both"; content: string; topic: string};

export interface Transport {
    connect(onEvent: ZulipEventListener): Promise<void>;
    close(): Promise<void>;
    getMessages(scope: ScopeFilter, options?: GetMessagesOptions): Promise<GetMessagesResult>;
    sendMessage(params: SendMessageParams): Promise<void>;
    // Variant of sendMessage that resolves with the server-assigned
    // message id. Optional because read-only transports (snapshots)
    // can't honor it; the agent-reply streaming primitive fails fast
    // when it's not implemented. Kept separate from `sendMessage` so
    // existing callers that treat the send as fire-and-forget don't
    // have to thread the id through their code paths.
    sendMessageWithId?(params: SendMessageParams): Promise<{messageId: number}>;
    editMessage(params: EditMessageParams): Promise<void>;
    deleteMessage(messageId: number): Promise<void>;
    addReaction(params: ReactionParams): Promise<void>;
    removeReaction(params: ReactionParams): Promise<void>;
    sendTyping(op: TypingOp, scope: ScopeFilter): Promise<void>;
    listChannels(): Promise<Channel[]>;
    listTopics(channel: string): Promise<Topic[]>;
    // Synchronous id lookup for the connected viewer. Returns undefined
    // before the first `/users/me` response lands. Prefer `ZulipClient.whenReady`
    // when you need to await the full User record.
    getCurrentUserId(): number | undefined;
    // Resolves with the connected viewer's full User record. Rejects if
    // the transport fails before the viewer identity is known.
    getCurrentUser(): Promise<User>;
}
