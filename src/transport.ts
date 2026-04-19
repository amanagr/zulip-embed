import type {Message, ScopeFilter, SendMessageParams, ZulipEventListener} from "./types.ts";

export interface ReactionParams {
    messageId: number;
    emoji: string;
}

export interface Transport {
    connect(onEvent: ZulipEventListener): Promise<void>;
    close(): Promise<void>;
    getMessages(scope: ScopeFilter): Promise<Message[]>;
    sendMessage(params: SendMessageParams): Promise<void>;
    addReaction(params: ReactionParams): Promise<void>;
    removeReaction(params: ReactionParams): Promise<void>;
    getCurrentUserId(): number | undefined;
}
