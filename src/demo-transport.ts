import {DEMO_GUEST_USER, seedMessages} from "./demo-data.ts";
import type {
    GetMessagesOptions,
    GetMessagesResult,
    ReactionParams,
    Transport,
    TypingOp,
} from "./transport.ts";
import type {
    Message,
    Reaction,
    ScopeFilter,
    SendMessageParams,
    ZulipEventListener,
} from "./types.ts";

export interface DemoTransportOptions {
    scope: ScopeFilter;
    autoReply?: boolean;
    autoReplyDelayMs?: number;
    readOnly?: boolean;
}

export class DemoTransport implements Transport {
    private readonly scope: ScopeFilter;
    private readonly autoReply: boolean;
    private readonly autoReplyDelayMs: number;
    private readonly readOnly: boolean;
    private messages: Message[];
    private nextId: number;
    private onEvent: ZulipEventListener | undefined;
    private pendingReplies = new Set<ReturnType<typeof setTimeout>>();
    private closed = false;
    private fakeTypingHandle: ReturnType<typeof setTimeout> | undefined;

    constructor(options: DemoTransportOptions) {
        this.scope = options.scope;
        this.autoReply = options.autoReply ?? true;
        this.autoReplyDelayMs = options.autoReplyDelayMs ?? 1500;
        this.readOnly = options.readOnly ?? false;
        this.messages = seedMessages(options.scope.channel, options.scope.topic);
        this.nextId =
            this.messages.reduce((max, m) => (m.id > max ? m.id : max), 0) + 1;
    }

    async connect(onEvent: ZulipEventListener): Promise<void> {
        this.onEvent = onEvent;
        onEvent({type: "connection", status: "connected"});
        return Promise.resolve();
    }

    async close(): Promise<void> {
        this.closed = true;
        for (const handle of this.pendingReplies) {
            clearTimeout(handle);
        }
        this.pendingReplies.clear();
        this.onEvent?.({type: "connection", status: "disconnected"});
        this.onEvent = undefined;
        return Promise.resolve();
    }

    async getMessages(
        _scope: ScopeFilter,
        options: GetMessagesOptions = {},
    ): Promise<GetMessagesResult> {
        const limit = options.limit ?? 20;
        // Sorted oldest-first. For paginated demo requests we synthesize
        // filler history on the fly so the scroll-up gesture has something
        // to load; seeded messages are returned on the first page only.
        if (options.beforeId === undefined) {
            return Promise.resolve({messages: [...this.messages], hasMore: true});
        }
        const anchor = options.beforeId;
        const historyBatch = this.buildDemoHistory(anchor, limit);
        return Promise.resolve({
            messages: historyBatch.messages,
            hasMore: historyBatch.hasMore,
        });
    }

    // Produce a small synthetic page of older messages ending just before
    // `anchorId`. Demo history floors at id=1 so infinite scrolling
    // terminates cleanly; hasMore=false on the final page.
    private buildDemoHistory(
        anchorId: number,
        limit: number,
    ): {messages: Message[]; hasMore: boolean} {
        const FLOOR_ID = 1;
        if (anchorId <= FLOOR_ID) {
            return {messages: [], hasMore: false};
        }
        const channel = this.scope.channel;
        const topic = this.scope.topic ?? "history";
        const startId = Math.max(FLOOR_ID, anchorId - limit);
        const out: Message[] = [];
        for (let id = startId; id < anchorId; id++) {
            // JS modulo is signed; we only feed positive ids now (floor at
            // FLOOR_ID=1) but defend against future changes.
            const authorIdx = ((id % SAMPLE_AUTHORS.length) + SAMPLE_AUTHORS.length) %
                SAMPLE_AUTHORS.length;
            const user = SAMPLE_AUTHORS[authorIdx]!;
            out.push({
                id,
                senderId: user.id,
                senderFullName: user.name,
                senderEmail: user.email,
                avatarUrl: "",
                timestamp: Date.now() - (anchorId - id) * 60 * 60 * 1000,
                content: `Older message #${String(id)} — synthesized on demand to demo pagination.`,
                contentIsHtml: false,
                type: "channel",
                channelName: channel,
                topic,
                reactions: [],
            });
        }
        return {messages: out, hasMore: startId > FLOOR_ID};
    }

    async sendMessage(params: SendMessageParams): Promise<void> {
        if (this.closed) {
            throw new Error("Transport is closed");
        }
        if (this.readOnly) {
            throw new Error("This demo channel is read-only");
        }
        const message: Message = {
            id: this.nextId++,
            senderId: DEMO_GUEST_USER.userId,
            senderFullName: DEMO_GUEST_USER.fullName,
            senderEmail: DEMO_GUEST_USER.email,
            avatarUrl: DEMO_GUEST_USER.avatarUrl,
            timestamp: Date.now(),
            content: params.content,
            contentIsHtml: false,
            type: "channel",
            channelName: params.channel ?? this.scope.channel,
            topic: params.topic ?? this.scope.topic,
            reactions: [],
        };
        this.messages.push(message);
        this.onEvent?.({type: "message", message});

        if (this.autoReply) {
            this.scheduleAutoReply(message);
        }
        return Promise.resolve();
    }

    async addReaction(params: ReactionParams): Promise<void> {
        this.toggleReaction(params, "add");
        return Promise.resolve();
    }

    async removeReaction(params: ReactionParams): Promise<void> {
        this.toggleReaction(params, "remove");
        return Promise.resolve();
    }

    async sendTyping(op: TypingOp, _scope: ScopeFilter): Promise<void> {
        // Demo parity: when the local viewer starts typing, simulate a
        // teammate typing back after a short delay so consumers can see
        // the indicator in action. Stop signals clear the faux user.
        if (this.closed) return Promise.resolve();
        if (this.readOnly) return Promise.resolve();
        if (op === "start") {
            // Schedule a fake "Zulip Bot is typing…" event with a small
            // debounce so rapid start/stop doesn't flicker.
            if (this.fakeTypingHandle === undefined) {
                const handle = setTimeout(() => {
                    this.fakeTypingHandle = undefined;
                    if (this.closed) return;
                    this.onEvent?.({
                        type: "typing",
                        users: [{userId: 14, fullName: "Zulip Bot"}],
                    });
                }, 400);
                this.fakeTypingHandle = handle;
                this.pendingReplies.add(handle);
            }
        } else {
            if (this.fakeTypingHandle !== undefined) {
                clearTimeout(this.fakeTypingHandle);
                this.pendingReplies.delete(this.fakeTypingHandle);
                this.fakeTypingHandle = undefined;
            }
            this.onEvent?.({type: "typing", users: []});
        }
        return Promise.resolve();
    }

    getCurrentUserId(): number {
        return DEMO_GUEST_USER.userId;
    }

    private toggleReaction(params: ReactionParams, op: "add" | "remove"): void {
        const message = this.messages.find((m) => m.id === params.messageId);
        if (!message) return;
        const userId = DEMO_GUEST_USER.userId;
        const buckets = new Map<string, Set<number>>();
        for (const r of message.reactions) buckets.set(r.emoji, new Set(r.userIds));
        let users = buckets.get(params.emoji);
        if (!users) {
            users = new Set();
            buckets.set(params.emoji, users);
        }
        if (op === "add") {
            users.add(userId);
        } else {
            users.delete(userId);
            if (users.size === 0) buckets.delete(params.emoji);
        }
        const reactions: Reaction[] = [...buckets.entries()].map(([emoji, userIds]) => ({
            emoji,
            count: userIds.size,
            userIds: [...userIds],
        }));
        message.reactions = reactions;
        this.onEvent?.({type: "reaction", messageId: params.messageId, reactions});
    }

    private scheduleAutoReply(trigger: Message): void {
        const handle = setTimeout(() => {
            this.pendingReplies.delete(handle);
            if (this.closed) return;
            const reply: Message = {
                id: this.nextId++,
                senderId: 14,
                senderFullName: "Zulip Bot",
                senderEmail: "zulip-bot@example.com",
                avatarUrl: "",
                timestamp: Date.now(),
                content: buildReply(trigger.content),
                contentIsHtml: false,
                type: "channel",
                channelName: trigger.channelName,
                topic: trigger.topic,
                reactions: [],
            };
            this.messages.push(reply);
            this.onEvent?.({type: "message", message: reply});
        }, this.autoReplyDelayMs);
        this.pendingReplies.add(handle);
    }
}

const SAMPLE_AUTHORS: Array<{id: number; name: string; email: string}> = [
    {id: 11, name: "Iago", email: "iago@zulip.com"},
    {id: 12, name: "King Hamlet", email: "hamlet@zulip.com"},
    {id: 13, name: "Cordelia, Lear's daughter", email: "cordelia@zulip.com"},
    {id: 15, name: "Prospero from The Tempest", email: "prospero@zulip.com"},
];

function buildReply(incoming: string): string {
    const trimmed = incoming.trim();
    if (trimmed.length === 0) return "Got it.";
    if (trimmed.endsWith("?")) {
        return "Good question — in a real deployment this would come from a teammate on your Zulip server.";
    }
    return `Echo: ${trimmed}`;
}
