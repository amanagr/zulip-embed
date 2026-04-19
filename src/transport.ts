import type {Message, ScopeFilter, SendMessageParams, ZulipEventListener} from "./types.ts";

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

export interface Transport {
    connect(onEvent: ZulipEventListener): Promise<void>;
    close(): Promise<void>;
    getMessages(scope: ScopeFilter, options?: GetMessagesOptions): Promise<GetMessagesResult>;
    sendMessage(params: SendMessageParams): Promise<void>;
    addReaction(params: ReactionParams): Promise<void>;
    removeReaction(params: ReactionParams): Promise<void>;
    // Fire a typing notification for the current scope. Errors are the
    // caller's problem — transports that don't support typing (e.g.
    // snapshot) should still implement the method as a no-op so the
    // composer's debounced emitter doesn't need to feature-detect.
    sendTyping(op: TypingOp, scope: ScopeFilter): Promise<void>;
    getCurrentUserId(): number | undefined;
}
