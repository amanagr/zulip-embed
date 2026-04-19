import {DEMO_GUEST_USER, seedMessages} from "./demo-data.ts";
import type {Transport} from "./transport.ts";
import type {
    Message,
    ScopeFilter,
    SendMessageParams,
    ZulipEventListener,
} from "./types.ts";

export interface DemoTransportOptions {
    scope: ScopeFilter;
    autoReply?: boolean;
    autoReplyDelayMs?: number;
}

export class DemoTransport implements Transport {
    private readonly scope: ScopeFilter;
    private readonly autoReply: boolean;
    private readonly autoReplyDelayMs: number;
    private messages: Message[];
    private nextId: number;
    private onEvent: ZulipEventListener | undefined;
    private pendingReplies = new Set<ReturnType<typeof setTimeout>>();
    private closed = false;

    constructor(options: DemoTransportOptions) {
        this.scope = options.scope;
        this.autoReply = options.autoReply ?? true;
        this.autoReplyDelayMs = options.autoReplyDelayMs ?? 1500;
        this.messages = seedMessages(options.scope.channel, options.scope.topic);
        this.nextId = this.messages.length + 1;
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

    async getMessages(_scope: ScopeFilter): Promise<Message[]> {
        return Promise.resolve([...this.messages]);
    }

    async sendMessage(params: SendMessageParams): Promise<void> {
        if (this.closed) {
            throw new Error("Transport is closed");
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

    getCurrentUserId(): number {
        return DEMO_GUEST_USER.userId;
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

function buildReply(incoming: string): string {
    const trimmed = incoming.trim();
    if (trimmed.length === 0) return "Got it.";
    if (trimmed.endsWith("?")) {
        return "Good question — in a real deployment this would come from a teammate on your Zulip server.";
    }
    return `Echo: ${trimmed}`;
}
