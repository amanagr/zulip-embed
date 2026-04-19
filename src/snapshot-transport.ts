import {z} from "zod";

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
    Message,
    ScopeFilter,
    SendMessageParams,
    Topic,
    ZulipEventListener,
} from "./types.ts";

const reactionSchema = z.object({
    emoji: z.string(),
    count: z.number(),
    userIds: z.array(z.number()),
});

const messageSchema = z.object({
    id: z.number(),
    senderId: z.number(),
    senderFullName: z.string(),
    senderEmail: z.string(),
    avatarUrl: z.string(),
    timestamp: z.number(),
    content: z.string(),
    contentIsHtml: z.boolean(),
    type: z.enum(["channel", "direct"]),
    channelName: z.string().optional(),
    topic: z.string().optional(),
    reactions: z.array(reactionSchema),
});

const channelSchema = z.object({
    channelId: z.number(),
    name: z.string(),
    description: z.string(),
    color: z.string().optional(),
    pinToTop: z.boolean(),
    isMuted: z.boolean(),
    unreadCount: z.number(),
});

const topicSchema = z.object({
    name: z.string(),
    maxMessageId: z.number(),
    unreadCount: z.number(),
    isResolved: z.boolean(),
});

const snapshotSchema = z.object({
    version: z.literal(1),
    generatedAt: z.number(),
    server: z.string(),
    channel: z.string(),
    topic: z.string().optional(),
    messages: z.array(messageSchema),
    // Optional directory of subscribed channels and per-channel topic
    // lists. Populated by scripts/fetch-channels-topics-snapshot.mjs so
    // standalone channel-list / topic-list components mounted with
    // snapshot-url can render real chat.zulip.org navigation data.
    channels: z.array(channelSchema).optional(),
    topics: z.record(z.string(), z.array(topicSchema)).optional(),
});

export interface SnapshotFile {
    // Schema version so consumers can bail out if the on-disk format changes.
    // Bumped whenever a field is removed or semantically reinterpreted.
    version: 1;
    generatedAt: number;
    server: string;
    channel: string;
    topic: string | undefined;
    messages: Message[];
    // Optional navigation data — present when the snapshot was produced
    // by fetch-channels-topics-snapshot.mjs. Lets a SnapshotTransport-backed
    // channel-list / topic-list render real subscription state without
    // shipping credentials to the browser.
    channels?: Channel[];
    topics?: Record<string, Topic[]>;
}

export interface SnapshotTransportOptions {
    url: string;
    scope: ScopeFilter;
    // Optional inline payload; when provided we skip the fetch entirely.
    // Useful for tests and for consumers that want to deliver the JSON
    // through their own plumbing.
    data?: SnapshotFile;
}

// Read-only transport that serves a pre-fetched JSON snapshot. Used by the
// demo site to show a close-to-live view of chat.zulip.org's #announce
// feed: a GitHub Action pulls the latest messages with a bot key at deploy
// time, bakes them into a JSON file, and the component fetches that file
// at runtime. No credentials ever reach the browser.
export class SnapshotTransport implements Transport {
    private readonly url: string;
    private readonly scope: ScopeFilter;
    private readonly inline: SnapshotFile | undefined;
    private messages: Message[] = [];
    private onEvent: ZulipEventListener | undefined;
    // Cached parsed snapshot so list* calls can resolve without a second
    // fetch. Populated by connect() or by an upfront fetchDirectory() when
    // the list components call list{Channels,Topics} before ever connecting.
    private directory: SnapshotFile | undefined;

    constructor(options: SnapshotTransportOptions) {
        this.url = options.data === undefined ? validateSnapshotUrl(options.url) : options.url;
        this.scope = options.scope;
        this.inline = options.data;
    }

    async connect(onEvent: ZulipEventListener): Promise<void> {
        this.onEvent = onEvent;
        try {
            const file = this.inline ?? (await this.fetchSnapshot());
            this.directory = file;
            this.messages = filterToScope(file.messages, this.scope);
            onEvent({type: "connection", status: "connected"});
        } catch (error) {
            onEvent({type: "connection", status: "error"});
            onEvent({type: "error", error: describeError(error)});
            throw error;
        }
    }

    async close(): Promise<void> {
        this.onEvent?.({type: "connection", status: "disconnected"});
        this.onEvent = undefined;
        return Promise.resolve();
    }

    async getMessages(
        _scope: ScopeFilter,
        options: GetMessagesOptions = {},
    ): Promise<GetMessagesResult> {
        // Snapshots are a fixed window — there is no backlog to paginate
        // into. Return everything on the first call and stop the scroll-up
        // loader by reporting hasMore=false.
        if (options.beforeId !== undefined) {
            return Promise.resolve({messages: [], hasMore: false});
        }
        return Promise.resolve({messages: [...this.messages], hasMore: false});
    }

    sendMessage(_params: SendMessageParams): Promise<void> {
        return Promise.reject(new Error("Snapshot transport is read-only"));
    }

    editMessage(_params: EditMessageParams): Promise<void> {
        return Promise.reject(new Error("Snapshot transport is read-only"));
    }

    deleteMessage(_messageId: number): Promise<void> {
        return Promise.reject(new Error("Snapshot transport is read-only"));
    }

    addReaction(_params: ReactionParams): Promise<void> {
        return Promise.reject(new Error("Snapshot transport is read-only"));
    }

    removeReaction(_params: ReactionParams): Promise<void> {
        return Promise.reject(new Error("Snapshot transport is read-only"));
    }

    sendTyping(_op: TypingOp, _scope: ScopeFilter): Promise<void> {
        // No-op rather than reject: the composer is hidden in snapshot
        // mode, but a host that mounted the component without the
        // read-only attribute shouldn't see error noise for typing pings.
        return Promise.resolve();
    }

    async listChannels(): Promise<Channel[]> {
        // Snapshots produced by fetch-channels-topics-snapshot.mjs include
        // the viewer's subscribed channels; older (message-only) snapshots
        // don't, in which case we return [] and the component renders an
        // empty state rather than fake data.
        const file = await this.ensureDirectory();
        const channels = file?.channels;
        return channels ? [...channels] : [];
    }

    async listTopics(channel: string): Promise<Topic[]> {
        const file = await this.ensureDirectory();
        const topics = file?.topics?.[channel];
        return topics ? [...topics] : [];
    }

    private async ensureDirectory(): Promise<SnapshotFile | undefined> {
        if (this.directory) return this.directory;
        if (this.inline) {
            this.directory = this.inline;
            return this.directory;
        }
        try {
            this.directory = await this.fetchSnapshot();
            return this.directory;
        } catch {
            // Swallow — listChannels/listTopics callers render empty
            // state on failure; the error banner lives in connect().
            return undefined;
        }
    }

    getCurrentUserId(): number | undefined {
        // Snapshots are anonymous reads — there is no logged-in viewer, so
        // reaction highlighting treats every emoji as "not mine".
        return undefined;
    }

    private async fetchSnapshot(): Promise<SnapshotFile> {
        const response = await fetch(this.url);
        if (!response.ok) {
            throw new Error(
                `Failed to load snapshot from ${this.url}: HTTP ${String(response.status)}`,
            );
        }
        const body: unknown = await response.json();
        return parseSnapshot(body);
    }
}

// Validate the snapshot URL. We accept relative URLs (resolved against
// the page origin) and absolute http/https URLs. Everything else — data:,
// javascript:, blob:, file:, protocol-relative (//evil.tld) — is
// rejected: the JSON's `content` fields flow into DOMPurify, but a
// bypass there becomes stored XSS if an attacker controls the feed.
// Treat the snapshot URL the same way we treat the live server URL.
function validateSnapshotUrl(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed === "") {
        throw new Error("snapshot-url is empty");
    }
    // Protocol-relative URLs (//host/path) are disallowed because they
    // inherit the page's scheme and silently point off-origin.
    if (trimmed.startsWith("//")) {
        throw new Error(`snapshot-url may not be protocol-relative: ${raw}`);
    }
    // Relative paths without a scheme are fine — URL() will reject them
    // without a base, so short-circuit before that throws.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
        return trimmed;
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error(`Invalid snapshot-url: ${raw}`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error(
            `snapshot-url must use http or https (got ${parsed.protocol}): ${raw}`,
        );
    }
    return parsed.toString();
}

function filterToScope(messages: Message[], scope: ScopeFilter): Message[] {
    return messages.filter((m) => {
        if (m.channelName !== scope.channel) return false;
        if (scope.topic !== undefined && m.topic !== scope.topic) return false;
        return true;
    });
}

// Full schema validation on load. Every field that flows into the DOM
// (content, avatarUrl, topic, channelName, senderFullName) is asserted
// to be the expected primitive before reaching the renderer, so a
// malformed or attacker-controlled snapshot can't smuggle non-string
// payloads through to DOMPurify or the URL helpers.
function parseSnapshot(raw: unknown): SnapshotFile {
    const parsed = snapshotSchema.safeParse(raw);
    if (!parsed.success) {
        throw new Error(`Invalid snapshot payload: ${parsed.error.message}`);
    }
    const data = parsed.data;
    const channels = data.channels?.map((c) => ({
        channelId: c.channelId,
        name: c.name,
        description: c.description,
        color: c.color,
        pinToTop: c.pinToTop,
        isMuted: c.isMuted,
        unreadCount: c.unreadCount,
    }));
    const topics = data.topics
        ? Object.fromEntries(
              Object.entries(data.topics).map(([channel, rows]) => [
                  channel,
                  rows.map((t) => ({
                      name: t.name,
                      maxMessageId: t.maxMessageId,
                      unreadCount: t.unreadCount,
                      isResolved: t.isResolved,
                  })),
              ]),
          )
        : undefined;
    return {
        version: 1,
        generatedAt: data.generatedAt,
        server: data.server,
        channel: data.channel,
        topic: data.topic,
        ...(channels ? {channels} : {}),
        ...(topics ? {topics} : {}),
        messages: data.messages.map((m) => ({
            id: m.id,
            senderId: m.senderId,
            senderFullName: m.senderFullName,
            senderEmail: m.senderEmail,
            avatarUrl: m.avatarUrl,
            timestamp: m.timestamp,
            content: m.content,
            contentIsHtml: m.contentIsHtml,
            type: m.type,
            channelName: m.channelName,
            topic: m.topic,
            reactions: m.reactions.map((r) => ({
                emoji: r.emoji,
                count: r.count,
                userIds: r.userIds,
            })),
        })),
    };
}

function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}
