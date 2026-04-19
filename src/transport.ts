import type {Message, ScopeFilter, SendMessageParams, ZulipEventListener} from "./types.ts";

export interface Transport {
    connect(onEvent: ZulipEventListener): Promise<void>;
    close(): Promise<void>;
    getMessages(scope: ScopeFilter): Promise<Message[]>;
    sendMessage(params: SendMessageParams): Promise<void>;
    getCurrentUserId(): number | undefined;
}
