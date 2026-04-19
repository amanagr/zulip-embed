import type {
    EditMessageParams,
    GetMessagesOptions,
    GetMessagesResult,
    ReactionParams,
    Transport,
    TypingOp,
} from "./transport.ts";
import type {
    Channel,
    ConnectionStatus,
    Message,
    ScopeFilter,
    SendMessageParams,
    Topic,
    User,
    ZulipEvent,
    ZulipEventListener,
} from "./types.ts";

export interface ZulipClientOptions {
    transport: Transport;
    // Active scope the client should send/load against. Required so
    // `sendMessage(content: string)` and `loadOlder()` know what to
    // target. Consumers that want to swap scopes should dispose the
    // client and build a new one — same lifecycle the Web Component
    // uses today.
    scope: ScopeFilter;
}

export interface ClientState {
    messages: Message[];
    status: ConnectionStatus;
}

// Headless client used by the React / React Native / Flutter packages.
// Subscribes to its transport's events, folds them into a tiny state
// snapshot, and re-emits them to listeners so host UI can render from
// `getState()` without owning its own reducer. The built-in
// `<zulip-chat>` Web Component uses this client but keeps its own
// state — that duplication is intentional for v0.2 and goes away in
// Sprint 4 when the component moves to a pure view over ClientState.
export class ZulipClient {
    private readonly transport: Transport;
    private readonly scope: ScopeFilter;
    private readonly listeners = new Set<ZulipEventListener>();
    private readonly stateListeners = new Set<() => void>();
    private state: ClientState = {messages: [], status: "idle"};
    private hasMore = true;

    constructor(options: ZulipClientOptions) {
        this.transport = options.transport;
        this.scope = options.scope;
    }

    async connect(): Promise<void> {
        this.setState({status: "connecting"});
        await this.transport.connect((event) => {
            this.applyEvent(event);
            this.emit(event);
        });
        const initial = await this.transport.getMessages(this.scope);
        this.setState({messages: initial.messages});
        this.hasMore = initial.hasMore;
    }

    async disconnect(): Promise<void> {
        await this.transport.close();
    }

    // Alias so RN / React consumers can call `client.close()` without
    // thinking about whether disconnect is the right word.
    close(): Promise<void> {
        return this.disconnect();
    }

    async getMessages(
        scope: ScopeFilter,
        options?: GetMessagesOptions,
    ): Promise<GetMessagesResult> {
        return this.transport.getMessages(scope, options);
    }

    // Load older messages into the client's state, anchored on the
    // current oldest id. No-op when the transport has nothing older.
    async loadOlder(): Promise<void> {
        if (!this.hasMore) return;
        const oldest = this.state.messages[0];
        const result = await this.transport.getMessages(this.scope, {
            beforeId: oldest?.id,
        });
        if (result.messages.length === 0) {
            this.hasMore = result.hasMore;
            return;
        }
        this.setState({
            messages: [...result.messages, ...this.state.messages],
        });
        this.hasMore = result.hasMore;
    }

    // Overloaded sendMessage. String form targets the active scope —
    // convenient default for RN / React hosts that already fixed their
    // channel/topic at mount time. Params form still works for
    // DM sends or cross-scope posts.
    sendMessage(content: string): Promise<void>;
    sendMessage(params: SendMessageParams): Promise<void>;
    async sendMessage(input: string | SendMessageParams): Promise<void> {
        if (typeof input === "string") {
            await this.transport.sendMessage({
                type: "channel",
                channel: this.scope.channel,
                topic: this.scope.topic ?? "",
                content: input,
            });
            return;
        }
        await this.transport.sendMessage(input);
    }

    async editMessage(params: EditMessageParams): Promise<void> {
        if (this.transport.editMessage === undefined) {
            throw new Error("transport does not support editMessage");
        }
        await this.transport.editMessage(params);
    }

    async deleteMessage(messageId: number): Promise<void> {
        if (this.transport.deleteMessage === undefined) {
            throw new Error("transport does not support deleteMessage");
        }
        await this.transport.deleteMessage(messageId);
    }

    async addReaction(params: ReactionParams): Promise<void> {
        if (this.transport.addReaction === undefined) {
            throw new Error("transport does not support addReaction");
        }
        await this.transport.addReaction(params);
    }

    async removeReaction(params: ReactionParams): Promise<void> {
        if (this.transport.removeReaction === undefined) {
            throw new Error("transport does not support removeReaction");
        }
        await this.transport.removeReaction(params);
    }

    async sendTyping(op: TypingOp, scope: ScopeFilter): Promise<void> {
        if (this.transport.sendTyping === undefined) return;
        await this.transport.sendTyping(op, scope);
    }

    async listChannels(): Promise<Channel[]> {
        if (this.transport.listChannels === undefined) return [];
        return this.transport.listChannels();
    }

    async listTopics(channel: string): Promise<Topic[]> {
        if (this.transport.listTopics === undefined) return [];
        return this.transport.listTopics(channel);
    }

    getCurrentUserId(): number | undefined {
        return this.transport.getCurrentUserId?.();
    }

    // Resolves with the connected viewer's full User record once the
    // transport has fetched /users/me (or the equivalent for synthetic
    // transports). Prefer this over getCurrentUserId() when you need the
    // email / full name / avatar, or when you want to await readiness.
    get whenReady(): Promise<User> {
        if (this.transport.getCurrentUser === undefined) {
            return Promise.reject(
                new Error("transport does not support getCurrentUser"),
            );
        }
        return this.transport.getCurrentUser();
    }

    // Immutable snapshot of the current state. Return the same object
    // reference until the state actually changes so React consumers can
    // memoize off it without extra comparison cost.
    getState(): ClientState {
        return this.state;
    }

    // Event-level subscription. Listeners fire on every transport event.
    // Use this when you need raw event fidelity (typing, reactions,
    // connection transitions). Use `subscribeState` for "something
    // rendered changed, re-read `getState`".
    subscribe(listener: ZulipEventListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    subscribeState(listener: () => void): () => void {
        this.stateListeners.add(listener);
        return () => {
            this.stateListeners.delete(listener);
        };
    }

    private applyEvent(event: ZulipEvent): void {
        if (event.type === "connection") {
            this.setState({status: event.status});
            return;
        }
        if (event.type === "message") {
            const message = event.message;
            if (!this.isInScope(message)) return;
            this.setState({messages: [...this.state.messages, message]});
            return;
        }
    }

    private isInScope(message: Message): boolean {
        if (message.type !== "channel") return false;
        if (message.channelName !== this.scope.channel) return false;
        if (this.scope.topic !== undefined && message.topic !== this.scope.topic) {
            return false;
        }
        return true;
    }

    private setState(patch: Partial<ClientState>): void {
        this.state = {...this.state, ...patch};
        for (const listener of this.stateListeners) {
            listener();
        }
    }

    private emit(event: ZulipEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}
