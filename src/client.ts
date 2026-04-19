import type {
    EditMessageParams,
    GetMessagesOptions,
    GetMessagesResult,
    ReactionParams,
    Transport,
    TypingOp,
} from "./transport.ts";
import type {
    ScopeFilter,
    SendMessageParams,
    ZulipEvent,
    ZulipEventListener,
} from "./types.ts";

export interface ZulipClientOptions {
    transport: Transport;
}

export class ZulipClient {
    private readonly transport: Transport;
    private readonly listeners = new Set<ZulipEventListener>();

    constructor(options: ZulipClientOptions) {
        this.transport = options.transport;
    }

    async connect(): Promise<void> {
        await this.transport.connect((event) => {
            this.emit(event);
        });
    }

    async disconnect(): Promise<void> {
        await this.transport.close();
    }

    async getMessages(
        scope: ScopeFilter,
        options?: GetMessagesOptions,
    ): Promise<GetMessagesResult> {
        return this.transport.getMessages(scope, options);
    }

    async sendMessage(params: SendMessageParams): Promise<void> {
        await this.transport.sendMessage(params);
    }

    async editMessage(params: EditMessageParams): Promise<void> {
        await this.transport.editMessage(params);
    }

    async deleteMessage(messageId: number): Promise<void> {
        await this.transport.deleteMessage(messageId);
    }

    async addReaction(params: ReactionParams): Promise<void> {
        await this.transport.addReaction(params);
    }

    async removeReaction(params: ReactionParams): Promise<void> {
        await this.transport.removeReaction(params);
    }

    async sendTyping(op: TypingOp, scope: ScopeFilter): Promise<void> {
        await this.transport.sendTyping(op, scope);
    }

    getCurrentUserId(): number | undefined {
        return this.transport.getCurrentUserId();
    }

    subscribe(listener: ZulipEventListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(event: ZulipEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}
