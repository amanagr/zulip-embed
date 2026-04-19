import type {
    Channel,
    Message,
    ScopeFilter,
    SendMessageParams,
    Topic,
    User,
    ZulipEventListener,
} from "./types.ts";

// A single bucketed DM conversation. `users` is the set of participants
// other than the viewer (or the viewer alone for a DM-to-self). Sorted
// by userId for stable keys. Consumers drive the DM picker off this
// shape directly — `lastMessageId` is stable across sessions, so UI
// code can use it for `selected` comparisons without reaching into the
// message feed.
export interface DirectMessageConversation {
    users: User[];
    lastMessageId: number;
    lastMessageTime: number;
}

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
    // List the viewer's recent DM conversations, sorted most-recent
    // first. Optional because read-only transports that don't model
    // DMs (the GitHub-Action-baked SnapshotTransport when the source
    // feed was a channel) can skip implementing it; the DM element
    // gracefully degrades to an empty state. `ZulipTransport` and
    // `DemoTransport` implement it; `SnapshotTransport` implements it
    // but returns [] when the snapshot carries no DirectMessages.
    listDirectMessageConversations?(): Promise<DirectMessageConversation[]>;
    // Fetches a single message by id, or resolves undefined if the viewer
    // can't see it (unsubscribed channel, deleted message, etc.). Used by
    // <zulip-announcement>; optional so read-only transports that can't
    // address messages individually (pure demo snapshots) can omit it.
    fetchMessage?(messageId: number): Promise<Message | undefined>;
    // Synchronous id lookup for the connected viewer. Returns undefined
    // before the first `/users/me` response lands. Prefer `ZulipClient.whenReady`
    // when you need to await the full User record.
    getCurrentUserId(): number | undefined;
    // Resolves with the connected viewer's full User record. Rejects if
    // the transport fails before the viewer identity is known.
    getCurrentUser(): Promise<User>;
}
