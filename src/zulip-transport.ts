import {z} from "zod";

import type {
    GetMessagesOptions,
    GetMessagesResult,
    ReactionParams,
    Transport,
} from "./transport.ts";
import type {
    Message,
    Reaction,
    ScopeFilter,
    SendMessageParams,
    ZulipEventListener,
} from "./types.ts";

export interface ZulipTransportOptions {
    serverUrl: string;
    email: string;
    apiKey: string;
    scope: ScopeFilter;
    historyLimit?: number;
}

const messageSchema = z.object({
    id: z.number(),
    sender_id: z.number(),
    sender_full_name: z.string(),
    sender_email: z.string(),
    avatar_url: z.string().nullable(),
    timestamp: z.number(),
    content: z.string(),
    // Zulip < 9 reports the channel variant as "stream"; Zulip >= 9 may emit
    // "channel". Accept both; we normalize to "channel"/"direct" in
    // convertMessage so callers only see the current terminology.
    type: z.enum(["stream", "channel", "private", "direct"]),
    display_recipient: z.union([z.string(), z.array(z.any())]).optional(),
    subject: z.string().optional(),
    reactions: z
        .array(
            z.object({
                emoji_name: z.string(),
                user_id: z.number(),
            }),
        )
        .default([]),
});

type ApiMessage = z.infer<typeof messageSchema>;

const registerResponseSchema = z.object({
    queue_id: z.string(),
    last_event_id: z.number(),
    max_message_id: z.number().optional(),
});

// Zulip event shapes we consume. Every event has id + type; the rest of the
// fields are type-specific. We accept unknowns so a newer server adding
// fields doesn't blow up validation.
const eventSchema = z
    .object({
        id: z.number(),
        type: z.string(),
    })
    .passthrough();

const eventsResponseSchema = z.object({
    events: z.array(eventSchema).default([]),
});

// update_message carries partial edit info; rendered_content is the HTML
// we want to swap in. orig_* fields are present but unused here.
const updateMessageEventSchema = z.object({
    message_id: z.number(),
    rendered_content: z.string().optional(),
    subject: z.string().optional(),
    edit_timestamp: z.number().optional(),
});

// delete_message can carry either a single message_id or a list.
const deleteMessageEventSchema = z.object({
    message_id: z.number().optional(),
    message_ids: z.array(z.number()).optional(),
});

// Per-user reaction event: op=add/remove, identifies the emoji + user +
// message. We fold these into our bucket model below.
const reactionEventSchema = z.object({
    op: z.enum(["add", "remove"]),
    message_id: z.number(),
    emoji_name: z.string(),
    user_id: z.number(),
});

const messagesResponseSchema = z.object({
    messages: z.array(messageSchema),
    // found_oldest is true when the server has nothing older than the
    // anchor we requested — use it to stop paginating.
    found_oldest: z.boolean().optional(),
});

const sendMessageResponseSchema = z.object({
    id: z.number(),
});

export class ZulipTransport implements Transport {
    private readonly serverUrl: string;
    private readonly authHeader: string;
    private readonly scope: ScopeFilter;
    private readonly historyLimit: number;
    private queueId: string | undefined;
    private lastEventId: number;
    private onEvent: ZulipEventListener | undefined;
    private pollController: AbortController | undefined;
    private closed = false;
    private currentUserId: number | undefined;
    // Per-message reaction state. Zulip's reaction events are per-user
    // add/remove, but UI subscribers want the full bucketed list. We keep a
    // map here so we can emit that list on every op.
    private readonly reactionState = new Map<number, Map<string, Set<number>>>();

    constructor(options: ZulipTransportOptions) {
        this.serverUrl = validateServerUrl(options.serverUrl);
        // btoa can't encode non-ASCII (email/apiKey with extended chars
        // throw InvalidCharacterError). Encode to UTF-8 first so we match
        // RFC 7617 and surface a clean error instead of a cryptic one.
        this.authHeader = "Basic " + base64EncodeUtf8(`${options.email}:${options.apiKey}`);
        this.scope = options.scope;
        this.historyLimit = options.historyLimit ?? 50;
        this.lastEventId = -1;
    }

    async connect(onEvent: ZulipEventListener): Promise<void> {
        this.onEvent = onEvent;
        onEvent({type: "connection", status: "connecting"});

        try {
            const registration = await this.register();
            this.queueId = registration.queue_id;
            this.lastEventId = registration.last_event_id;
            await this.loadCurrentUser();
            onEvent({type: "connection", status: "connected"});
            void this.pollLoop();
        } catch (error) {
            onEvent({type: "connection", status: "error"});
            onEvent({type: "error", error: describeError(error)});
            throw error;
        }
    }

    async close(): Promise<void> {
        this.closed = true;
        this.pollController?.abort();
        if (this.queueId !== undefined) {
            try {
                await this.request("DELETE", "/api/v1/events", {queue_id: this.queueId});
            } catch {
                // Best-effort: Zulip will GC abandoned queues anyway.
            }
        }
        this.onEvent?.({type: "connection", status: "disconnected"});
        this.onEvent = undefined;
    }

    async getMessages(
        scope: ScopeFilter,
        options: GetMessagesOptions = {},
    ): Promise<GetMessagesResult> {
        const narrow = buildNarrow(scope);
        // Anchor semantics: for pagination we anchor on the oldest id we
        // already have and ask for num_before messages strictly older.
        // Zulip includes the anchor in its response, so we strip it below
        // to avoid a duplicate.
        const limit = options.limit ?? this.historyLimit;
        const anchor =
            options.beforeId === undefined ? "newest" : String(options.beforeId);
        const params = {
            anchor,
            num_before: String(limit),
            num_after: "0",
            narrow: JSON.stringify(narrow),
        };
        const response = await this.request("GET", "/api/v1/messages", params);
        const parsed = messagesResponseSchema.parse(response);
        let messages = parsed.messages.map(convertMessage);
        if (options.beforeId !== undefined) {
            messages = messages.filter((m) => m.id !== options.beforeId);
        }
        // Prime the reaction cache so per-user reaction events dispatched
        // afterwards compose with the initial server-reported state.
        for (const message of messages) {
            this.rememberReactions(message);
        }
        // found_oldest true means the server has nothing older than the
        // anchor. If the field is missing (older servers), infer from the
        // returned batch size.
        const hasMore =
            parsed.found_oldest === undefined
                ? messages.length >= limit
                : !parsed.found_oldest;
        return {messages, hasMore};
    }

    async addReaction(params: ReactionParams): Promise<void> {
        await this.request("POST", `/api/v1/messages/${String(params.messageId)}/reactions`, {
            emoji_name: params.emoji,
        });
    }

    async removeReaction(params: ReactionParams): Promise<void> {
        await this.request("DELETE", `/api/v1/messages/${String(params.messageId)}/reactions`, {
            emoji_name: params.emoji,
        });
    }

    async sendMessage(params: SendMessageParams): Promise<void> {
        const body: Record<string, string> = {content: params.content};
        if (params.type === "channel") {
            // Wire value is "stream" for back-compat with Zulip < 9. Zulip
            // renamed streams to channels but still accepts the legacy value
            // on /messages for every supported server version, so sending
            // "stream" here means the embed works against old and new Zulip
            // without version sniffing.
            body["type"] = "stream";
            body["to"] = params.channel ?? this.scope.channel;
            body["topic"] = params.topic ?? this.scope.topic ?? "";
        } else {
            body["type"] = "direct";
            body["to"] = JSON.stringify(params.recipients ?? []);
        }
        const response = await this.request("POST", "/api/v1/messages", body);
        sendMessageResponseSchema.parse(response);
    }

    getCurrentUserId(): number | undefined {
        return this.currentUserId;
    }

    private async register(): Promise<z.infer<typeof registerResponseSchema>> {
        const body = {
            event_types: JSON.stringify([
                "message",
                "update_message",
                "delete_message",
                "reaction",
            ]),
            narrow: JSON.stringify(buildNarrow(this.scope)),
            apply_markdown: "true",
            client_gravatar: "true",
            include_subscribers: "false",
        };
        const response = await this.request("POST", "/api/v1/register", body);
        return registerResponseSchema.parse(response);
    }

    private dispatchEvent(event: {type: string} & Record<string, unknown>): void {
        if (event.type === "message") {
            const parsed = messageSchema.safeParse(event["message"]);
            if (!parsed.success) return;
            const message = convertMessage(parsed.data);
            this.rememberReactions(message);
            this.onEvent?.({type: "message", message});
        } else if (event.type === "update_message") {
            const parsed = updateMessageEventSchema.safeParse(event);
            if (!parsed.success) return;
            // Scope guard: only surface edits for messages that arrived
            // through our narrow'd queue or paginated fetch. Events for
            // messages outside scope are dropped even if the server emits
            // them, so a compromised server can't mutate UI state for
            // messages the user never loaded.
            if (!this.reactionState.has(parsed.data.message_id)) return;
            this.onEvent?.({
                type: "message-update",
                messageId: parsed.data.message_id,
                content: parsed.data.rendered_content,
                // rendered_content is server-markdown output (apply_markdown=true
                // is set on register), so it's always HTML. Emit the flag
                // explicitly so consumers route it through the sanitizer
                // rather than inferring from `content !== undefined`.
                contentIsHtml: parsed.data.rendered_content === undefined ? undefined : true,
                topic: parsed.data.subject,
                editedTimestamp:
                    parsed.data.edit_timestamp === undefined
                        ? undefined
                        : parsed.data.edit_timestamp * 1000,
            });
        } else if (event.type === "delete_message") {
            const parsed = deleteMessageEventSchema.safeParse(event);
            if (!parsed.success) return;
            const ids =
                parsed.data.message_ids ??
                (parsed.data.message_id === undefined ? [] : [parsed.data.message_id]);
            for (const messageId of ids) {
                // Same scope guard as update_message: only forward deletes
                // for ids we've actually observed.
                if (!this.reactionState.has(messageId)) continue;
                this.reactionState.delete(messageId);
                this.onEvent?.({type: "message-delete", messageId});
            }
        } else if (event.type === "reaction") {
            const parsed = reactionEventSchema.safeParse(event);
            if (!parsed.success) return;
            if (!this.reactionState.has(parsed.data.message_id)) return;
            const reactions = this.applyReactionOp(parsed.data);
            this.onEvent?.({
                type: "reaction",
                messageId: parsed.data.message_id,
                reactions,
            });
        }
    }

    private rememberReactions(message: Message): void {
        const buckets = new Map<string, Set<number>>();
        for (const r of message.reactions) {
            buckets.set(r.emoji, new Set(r.userIds));
        }
        this.reactionState.set(message.id, buckets);
    }

    private applyReactionOp(op: {
        op: "add" | "remove";
        message_id: number;
        emoji_name: string;
        user_id: number;
    }): Reaction[] {
        let buckets = this.reactionState.get(op.message_id);
        if (!buckets) {
            buckets = new Map();
            this.reactionState.set(op.message_id, buckets);
        }
        let users = buckets.get(op.emoji_name);
        if (!users) {
            users = new Set();
            buckets.set(op.emoji_name, users);
        }
        if (op.op === "add") {
            users.add(op.user_id);
        } else {
            users.delete(op.user_id);
            if (users.size === 0) buckets.delete(op.emoji_name);
        }
        return [...buckets.entries()].map(([emoji, userIds]) => ({
            emoji,
            count: userIds.size,
            userIds: [...userIds],
        }));
    }

    private async loadCurrentUser(): Promise<void> {
        const response = await this.request("GET", "/api/v1/users/me");
        const me = z.object({user_id: z.number()}).parse(response);
        this.currentUserId = me.user_id;
    }

    private async pollLoop(): Promise<void> {
        while (!this.closed && this.queueId !== undefined) {
            this.pollController = new AbortController();
            try {
                const response = await this.request(
                    "GET",
                    "/api/v1/events",
                    {
                        queue_id: this.queueId,
                        last_event_id: String(this.lastEventId),
                    },
                    this.pollController.signal,
                );
                const parsed = eventsResponseSchema.parse(response);
                for (const event of parsed.events) {
                    this.lastEventId = Math.max(this.lastEventId, event.id);
                    this.dispatchEvent(event);
                }
            } catch (error) {
                if (this.closed) return;
                if ((error as {name?: string}).name === "AbortError") return;
                this.onEvent?.({type: "error", error: describeError(error)});
                await wait(2000);
            }
        }
    }

    private async request(
        method: "GET" | "POST" | "DELETE",
        path: string,
        params: Record<string, string> | undefined = undefined,
        signal?: AbortSignal,
    ): Promise<unknown> {
        const url = new URL(this.serverUrl + path);
        const headers: Record<string, string> = {Authorization: this.authHeader};
        let body: string | undefined;

        if (method === "GET" || method === "DELETE") {
            if (params) {
                for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
            }
        } else {
            headers["Content-Type"] = "application/x-www-form-urlencoded";
            body = params ? new URLSearchParams(params).toString() : undefined;
        }

        const init: RequestInit = {method, headers};
        if (body !== undefined) init.body = body;
        if (signal) init.signal = signal;

        const response = await fetch(url.toString(), init);
        if (!response.ok) {
            throw new Error(await describeHttpError(response, path));
        }
        return response.json();
    }
}

// Validate the server URL embedders configure. Only http/https schemes are
// accepted, and we emit a console warning for http:// because it means
// Zulip API credentials (sent as HTTP Basic auth) will travel in the
// clear. Refusing http outright would break local-development workflows,
// so we warn instead of throw.
function validateServerUrl(raw: string): string {
    const trimmed = raw.trim();
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error(`Invalid Zulip server URL: ${raw}`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error(
            `Zulip server URL must use http or https (got ${parsed.protocol}): ${raw}`,
        );
    }
    if (
        parsed.protocol === "http:" &&
        parsed.hostname !== "localhost" &&
        parsed.hostname !== "127.0.0.1" &&
        !parsed.hostname.endsWith(".localhost")
    ) {
        // eslint-disable-next-line no-console
        console.warn(
            `[zulip-embed] server URL uses http://; API credentials will travel in the clear. Use https:// in production.`,
        );
    }
    // Normalize: strip trailing slashes from the pathname so our _endpoint
    // concatenation ("$base$path") produces a clean URL.
    const normalized = parsed.toString().replace(/\/+$/, "");
    return normalized;
}

// btoa doesn't handle non-ASCII. Encode the input as UTF-8 bytes first, as
// required by RFC 7617 for HTTP Basic credentials that contain non-ASCII
// characters (e.g. display names with accents).
function base64EncodeUtf8(input: string): string {
    const bytes = new TextEncoder().encode(input);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

async function describeHttpError(response: Response, path: string): Promise<string> {
    // Zulip returns JSON like {"result": "error", "msg": "Invalid narrow operator: foo", "code": "BAD_REQUEST"}.
    // Surface that msg directly so the chat banner is actionable.
    const status = String(response.status);
    try {
        const body = (await response.json()) as {msg?: unknown; code?: unknown};
        const msg = typeof body.msg === "string" ? body.msg : undefined;
        if (msg !== undefined && msg !== "") {
            return `HTTP ${status} from ${path}: ${msg}`;
        }
    } catch {
        // Response wasn't JSON; fall through to the bare status line.
    }
    return `HTTP ${status} from ${path}`;
}

function buildNarrow(scope: ScopeFilter): Array<[string, string]> {
    // Two-element-array form because /register rejects the object form on
    // several Zulip versions. Operator is "stream" (not "channel") because
    // Zulip < 9 doesn't know the "channel" alias; every supported server
    // accepts the legacy operator, so hardcoding it avoids version
    // sniffing. Callers see "channel" everywhere else in this SDK.
    const narrow: Array<[string, string]> = [["stream", scope.channel]];
    if (scope.topic !== undefined && scope.topic !== "") {
        narrow.push(["topic", scope.topic]);
    }
    return narrow;
}

function convertMessage(api: ApiMessage): Message {
    // Normalize Zulip's wire-level "stream"/"private" to the current
    // "channel"/"direct" terminology. Callers of this SDK should never have
    // to know that the server speaks the older dialect.
    const isChannelMessage = api.type === "stream" || api.type === "channel";
    const channelName =
        isChannelMessage && typeof api.display_recipient === "string"
            ? api.display_recipient
            : undefined;
    const reactionsByEmoji = new Map<string, {emoji: string; userIds: Set<number>}>();
    for (const r of api.reactions) {
        let bucket = reactionsByEmoji.get(r.emoji_name);
        if (!bucket) {
            bucket = {emoji: r.emoji_name, userIds: new Set()};
            reactionsByEmoji.set(r.emoji_name, bucket);
        }
        bucket.userIds.add(r.user_id);
    }

    return {
        id: api.id,
        senderId: api.sender_id,
        senderFullName: api.sender_full_name,
        senderEmail: api.sender_email,
        avatarUrl: api.avatar_url ?? "",
        timestamp: api.timestamp * 1000,
        content: api.content,
        contentIsHtml: true,
        type: isChannelMessage ? "channel" : "direct",
        channelName,
        topic: api.subject,
        reactions: [...reactionsByEmoji.values()].map((bucket) => ({
            emoji: bucket.emoji,
            count: bucket.userIds.size,
            userIds: [...bucket.userIds],
        })),
    };
}

function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
