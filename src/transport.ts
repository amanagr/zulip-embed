import type {
    Channel,
    Message,
    ScopeFilter,
    SendMessageParams,
    Topic,
    ZulipEventListener,
} from "./types.ts";

export interface ReactionParams {
    messageId: number;
    emoji: string;
}

export interface GetMessagesOptions {
    // Load messages older than this id. When undefined, load the newest
    // page (the initial load).
    beforeId?: number | undefined;
    limit?: number | undefined;
}

export interface GetMessagesResult {
    messages: Message[];
    // False when the server reported no more messages older than the
    // oldest id in this page. Lets the UI stop firing pagination requests.
    hasMore: boolean;
}

export type TypingOp = "start" | "stop";

export interface EditMessageParams {
    messageId: number;
    // At least one of `content` or `topic` must be provided. The component
    // currently only edits content from the composer, but the transport
    // supports topic edits too for future UI.
    content?: string | undefined;
    topic?: string | undefined;
}

export interface Transport {
    connect(onEvent: ZulipEventListener): Promise<void>;
    close(): Promise<void>;
    getMessages(scope: ScopeFilter, options?: GetMessagesOptions): Promise<GetMessagesResult>;
    sendMessage(params: SendMessageParams): Promise<void>;
    // Edit the content (and/or topic) of a message the viewer authored.
    // Transports without mutation support (snapshot) should reject.
    editMessage(params: EditMessageParams): Promise<void>;
    // Delete a message the viewer authored. Server-side permissions
    // apply; a 403 surfaces as an error back to the caller.
    deleteMessage(messageId: number): Promise<void>;
    addReaction(params: ReactionParams): Promise<void>;
    removeReaction(params: ReactionParams): Promise<void>;
    // Fire a typing notification for the current scope. Errors are the
    // caller's problem — transports that don't support typing (e.g.
    // snapshot) should still implement the method as a no-op so the
    // composer's debounced emitter doesn't need to feature-detect.
    sendTyping(op: TypingOp, scope: ScopeFilter): Promise<void>;
    // Subscribed channels for the connected viewer. Transports that
    // don't model subscriptions (snapshot) should return an empty array.
    listChannels(): Promise<Channel[]>;
    // Topics inside a channel, newest first. Returns [] when the channel
    // has no topics or the transport can't enumerate them.
    listTopics(channel: string): Promise<Topic[]>;
    getCurrentUserId(): number | undefined;
}
