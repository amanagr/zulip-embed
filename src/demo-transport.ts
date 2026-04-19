import {DEMO_GUEST_USER, DEMO_USERS, seedMessages} from "./demo-data.ts";
import {normalizeScope} from "./scope.ts";
import type {
    DirectMessageConversation,
    EditMessageParams,
    GetMessagesOptions,
    GetMessagesResult,
    ReactionParams,
    Transport,
    TypingOp,
} from "./transport.ts";
import type {
    Channel,
    DirectMessage,
    Message,
    NormalizedScope,
    Reaction,
    ScopeFilter,
    SendMessageParams,
    Topic,
    User,
    ZulipEventListener,
} from "./types.ts";

export interface DemoTransportOptions {
    scope: ScopeFilter;
    autoReply?: boolean;
    autoReplyDelayMs?: number;
    readOnly?: boolean;
}

export class DemoTransport implements Transport {
    private readonly scope: NormalizedScope;
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
        this.scope = normalizeScope(options.scope);
        this.autoReply = options.autoReply ?? true;
        this.autoReplyDelayMs = options.autoReplyDelayMs ?? 1500;
        this.readOnly = options.readOnly ?? false;
        // Channel scopes seed a fake feed; DM scopes share a synthetic
        // DM fixture so the demo renders out-of-the-box when adopters
        // mount a DM conversation.
        if (this.scope.kind === "channel") {
            this.messages = seedMessages(this.scope.channel, this.scope.topic);
        } else {
            this.messages = seedDirectMessages(this.scope.userIds);
        }
        // Include the global DM fixtures so listDirectMessageConversations
        // has multiple threads to surface even when the scope is a
        // channel. `_nextId` still advances past the highest seen id.
        for (const extra of GLOBAL_DM_FIXTURES) {
            if (!this.messages.some((m) => m.id === extra.id)) {
                this.messages.push(extra);
            }
        }
        this.nextId = this.messages.reduce((max, m) => (m.id > max ? m.id : max), 0) + 1;
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
        scope: ScopeFilter,
        options: GetMessagesOptions = {},
    ): Promise<GetMessagesResult> {
        const limit = options.limit ?? 20;
        const normalized = normalizeScope(scope);
        // Sorted oldest-first. For paginated demo requests we synthesize
        // filler history on the fly so the scroll-up gesture has something
        // to load; seeded messages are returned on the first page only.
        if (options.beforeId === undefined) {
            const filtered = this.messages.filter((m) => inScope(m, normalized));
            return Promise.resolve({messages: filtered, hasMore: true});
        }
        // Synthesized history only makes sense for channel scopes; DM
        // history has no filler generator, so DM pagination just stops
        // at the seeded set.
        if (normalized.kind === "dm") {
            return Promise.resolve({messages: [], hasMore: false});
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
        // Only channel scopes reach here; `getMessages` short-circuits
        // DM scopes above so we know `this.scope` is a ChannelScope.
        if (this.scope.kind !== "channel") {
            return {messages: [], hasMore: false};
        }
        const channel = this.scope.channel;
        const topic = this.scope.topic ?? "history";
        const startId = Math.max(FLOOR_ID, anchorId - limit);
        const out: Message[] = [];
        for (let id = startId; id < anchorId; id++) {
            // JS modulo is signed; we only feed positive ids now (floor at
            // FLOOR_ID=1) but defend against future changes.
            const authorIdx =
                ((id % SAMPLE_AUTHORS.length) + SAMPLE_AUTHORS.length) % SAMPLE_AUTHORS.length;
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
        await this.sendMessageWithId(params);
    }

    async sendMessageWithId(params: SendMessageParams): Promise<{messageId: number}> {
        if (this.closed) {
            throw new Error("Transport is closed");
        }
        if (this.readOnly) {
            throw new Error("This demo channel is read-only");
        }
        let message: Message;
        if (params.type === "channel") {
            message = {
                id: this.nextId++,
                senderId: DEMO_GUEST_USER.userId,
                senderFullName: DEMO_GUEST_USER.fullName,
                senderEmail: DEMO_GUEST_USER.email,
                avatarUrl: DEMO_GUEST_USER.avatarUrl,
                timestamp: Date.now(),
                content: params.content,
                contentIsHtml: false,
                type: "channel",
                channelName: params.channel,
                topic: params.topic,
                reactions: [],
            };
        } else {
            message = {
                id: this.nextId++,
                senderId: DEMO_GUEST_USER.userId,
                senderFullName: DEMO_GUEST_USER.fullName,
                senderEmail: DEMO_GUEST_USER.email,
                avatarUrl: DEMO_GUEST_USER.avatarUrl,
                timestamp: Date.now(),
                content: params.content,
                contentIsHtml: false,
                type: "direct",
                recipients: [],
                reactions: [],
            };
        }
        this.messages.push(message);
        this.onEvent?.({type: "message", message});

        if (this.autoReply && message.type === "channel") {
            this.scheduleAutoReply(message);
        }
        return Promise.resolve({messageId: message.id});
    }

    async editMessage(params: EditMessageParams): Promise<void> {
        if (this.closed) throw new Error("Transport is closed");
        if (this.readOnly) throw new Error("This demo channel is read-only");
        const target = this.messages.find((m) => m.id === params.messageId);
        if (!target) throw new Error(`No such message: ${String(params.messageId)}`);
        if (target.senderId !== DEMO_GUEST_USER.userId) {
            throw new Error("You can only edit your own messages");
        }
        let nextContent: string | undefined;
        let nextTopic: string | undefined;
        if (params.kind === "content" || params.kind === "both") {
            target.content = params.content;
            target.contentIsHtml = false;
            nextContent = params.content;
        }
        if (params.kind === "topic" || params.kind === "both") {
            if (target.type !== "channel") {
                throw new Error("Only channel messages have topics");
            }
            target.topic = params.topic;
            nextTopic = params.topic;
        }
        this.onEvent?.({
            type: "message-update",
            messageId: params.messageId,
            content: nextContent,
            contentIsHtml: nextContent === undefined ? undefined : false,
            topic: nextTopic,
        });
        return Promise.resolve();
    }

    async deleteMessage(messageId: number): Promise<void> {
        if (this.closed) throw new Error("Transport is closed");
        if (this.readOnly) throw new Error("This demo channel is read-only");
        const idx = this.messages.findIndex((m) => m.id === messageId);
        if (idx < 0) throw new Error(`No such message: ${String(messageId)}`);
        const target = this.messages[idx]!;
        if (target.senderId !== DEMO_GUEST_USER.userId) {
            throw new Error("You can only delete your own messages");
        }
        this.messages.splice(idx, 1);
        this.onEvent?.({type: "message-delete", messageId});
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

    async listChannels(): Promise<Channel[]> {
        // Single seeded channel matching the demo feed. Advertised with a
        // small unread count so the channel-list badge renders out-of-box
        // in demo mode. For DM scopes, fall back to "general" — a plain
        // `<zulip-channel-list>` dropped next to a DM-scoped `<zulip-chat>`
        // still has something to render.
        const name = this.scope.kind === "channel" ? this.scope.channel : "general";
        return Promise.resolve([
            {
                channelId: 1,
                name,
                description: "In-memory demo channel",
                color: "#7f56d9",
                pinToTop: true,
                isMuted: false,
                unreadCount: 0,
            },
        ]);
    }

    async listDirectMessageConversations(): Promise<DirectMessageConversation[]> {
        const viewer = DEMO_GUEST_USER.userId;
        const buckets = new Map<
            string,
            {users: Map<number, User>; lastMessage: DirectMessage}
        >();
        for (const message of this.messages) {
            if (message.type !== "direct") continue;
            const participants = new Map<number, User>();
            if (message.senderId !== viewer) {
                participants.set(message.senderId, {
                    userId: message.senderId,
                    email: message.senderEmail,
                    fullName: message.senderFullName,
                    avatarUrl: message.avatarUrl,
                });
            }
            for (const recipient of message.recipients) {
                if (recipient.userId === viewer) continue;
                participants.set(recipient.userId, recipient);
            }
            if (participants.size === 0) {
                participants.set(message.senderId, {
                    userId: message.senderId,
                    email: message.senderEmail,
                    fullName: message.senderFullName,
                    avatarUrl: message.avatarUrl,
                });
            }
            const key = [...participants.keys()].sort((a, b) => a - b).join(",");
            const existing = buckets.get(key);
            if (existing === undefined || message.id > existing.lastMessage.id) {
                buckets.set(key, {users: participants, lastMessage: message});
            }
        }
        const rows: DirectMessageConversation[] = [];
        for (const bucket of buckets.values()) {
            rows.push({
                users: [...bucket.users.values()].sort((a, b) => a.userId - b.userId),
                lastMessageId: bucket.lastMessage.id,
                lastMessageTime: bucket.lastMessage.timestamp,
            });
        }
        rows.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
        return Promise.resolve(rows);
    }

    async listTopics(channel: string): Promise<Topic[]> {
        const byTopic = new Map<string, number>();
        for (const m of this.messages) {
            if (m.type !== "channel") continue;
            if (m.channelName !== channel) continue;
            const prev = byTopic.get(m.topic) ?? -1;
            if (m.id > prev) byTopic.set(m.topic, m.id);
        }
        const topics: Topic[] = [...byTopic.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, maxId]) => ({name, maxMessageId: maxId}));
        return Promise.resolve(topics);
    }

    async fetchMessage(messageId: number): Promise<Message | undefined> {
        return Promise.resolve(this.messages.find((m) => m.id === messageId));
    }

    getCurrentUserId(): number {
        return DEMO_GUEST_USER.userId;
    }

    getCurrentUser(): Promise<User> {
        return Promise.resolve({
            userId: DEMO_GUEST_USER.userId,
            email: DEMO_GUEST_USER.email,
            fullName: DEMO_GUEST_USER.fullName,
            avatarUrl: DEMO_GUEST_USER.avatarUrl,
        });
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

    private scheduleAutoReply(trigger: Message & {type: "channel"}): void {
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

// Three demo DM threads: one-on-one with Iago, one-on-one with Cordelia,
// and a three-way with Hamlet + Prospero. Ids start at 9000 to sit
// comfortably above the channel seed range so `nextId` starts clean.
const GLOBAL_DM_FIXTURES: DirectMessage[] = buildGlobalDmFixtures();

function buildGlobalDmFixtures(): DirectMessage[] {
    const viewer = DEMO_GUEST_USER.userId;
    const lookup = (id: number): User => {
        const found = DEMO_USERS.find((u) => u.userId === id);
        return (
            found ?? {
                userId: id,
                email: `user${String(id)}@example.com`,
                fullName: `User ${String(id)}`,
                avatarUrl: "",
            }
        );
    };
    const iago = lookup(11);
    const hamlet = lookup(12);
    const cordelia = lookup(13);
    const prospero = lookup(15);
    const now = Date.now();
    return [
        {
            id: 9001,
            senderId: iago.userId,
            senderFullName: iago.fullName,
            senderEmail: iago.email,
            avatarUrl: iago.avatarUrl,
            timestamp: now - 1000 * 60 * 60 * 2,
            content: "Hey — quick question about the deploy tonight?",
            contentIsHtml: false,
            type: "direct",
            recipients: [iago, {...DEMO_GUEST_USER}],
            reactions: [],
        },
        {
            id: 9002,
            senderId: viewer,
            senderFullName: DEMO_GUEST_USER.fullName,
            senderEmail: DEMO_GUEST_USER.email,
            avatarUrl: DEMO_GUEST_USER.avatarUrl,
            timestamp: now - 1000 * 60 * 60,
            content: "Sounds good, let's sync on that tomorrow.",
            contentIsHtml: false,
            type: "direct",
            recipients: [cordelia],
            reactions: [],
        },
        {
            id: 9003,
            senderId: hamlet.userId,
            senderFullName: hamlet.fullName,
            senderEmail: hamlet.email,
            avatarUrl: hamlet.avatarUrl,
            timestamp: now - 1000 * 60 * 15,
            content: "Prospero shipped the redesign — thoughts?",
            contentIsHtml: false,
            type: "direct",
            recipients: [hamlet, prospero, {...DEMO_GUEST_USER}],
            reactions: [],
        },
    ];
}

// Seed a synthetic DM thread when the scope was explicitly a DM. A
// couple of messages so the feed isn't empty on first mount.
function seedDirectMessages(userIds: number[]): Message[] {
    const viewer = DEMO_GUEST_USER.userId;
    const others = userIds.filter((id) => id !== viewer);
    const peers: User[] = others.map((id) => {
        const found = DEMO_USERS.find((u) => u.userId === id);
        return (
            found ?? {
                userId: id,
                email: `user${String(id)}@example.com`,
                fullName: `User ${String(id)}`,
                avatarUrl: "",
            }
        );
    });
    if (peers.length === 0) return [];
    const now = Date.now();
    const primary = peers[0]!;
    return [
        {
            id: 9100,
            senderId: primary.userId,
            senderFullName: primary.fullName,
            senderEmail: primary.email,
            avatarUrl: primary.avatarUrl,
            timestamp: now - 1000 * 60 * 10,
            content: "Welcome to the DM demo — any messages you send will echo.",
            contentIsHtml: false,
            type: "direct",
            recipients: [...peers, {...DEMO_GUEST_USER}],
            reactions: [],
        },
    ];
}

// Predicate used by `getMessages` to constrain the flat message log to
// the active narrow. Channel scopes match on channelName + optional
// topic; DM scopes match on the canonical participant set.
function inScope(message: Message, scope: NormalizedScope): boolean {
    if (scope.kind === "channel") {
        if (message.type !== "channel") return false;
        if (message.channelName !== scope.channel) return false;
        if (scope.topic !== undefined && message.topic !== scope.topic) {
            return false;
        }
        return true;
    }
    if (message.type !== "direct") return false;
    const participants = new Set<number>([message.senderId]);
    for (const r of message.recipients) participants.add(r.userId);
    const expected = new Set<number>(scope.userIds);
    expected.add(DEMO_GUEST_USER.userId);
    if (participants.size !== expected.size) return false;
    for (const id of expected) {
        if (!participants.has(id)) return false;
    }
    return true;
}

function buildReply(incoming: string): string {
    const trimmed = incoming.trim();
    if (trimmed.length === 0) return "Got it.";
    if (trimmed.endsWith("?")) {
        return "Good question — in a real deployment this would come from a teammate on your Zulip server.";
    }
    return `Echo: ${trimmed}`;
}
