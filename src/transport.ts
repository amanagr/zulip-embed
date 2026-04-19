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

export interface Transport {
    connect(onEvent: ZulipEventListener): Promise<void>;
    close(): Promise<void>;
    getMessages(scope: ScopeFilter, options?: GetMessagesOptions): Promise<GetMessagesResult>;
    sendMessage(params: SendMessageParams): Promise<void>;
    addReaction(params: ReactionParams): Promise<void>;
    removeReaction(params: ReactionParams): Promise<void>;
    getCurrentUserId(): number | undefined;
}
