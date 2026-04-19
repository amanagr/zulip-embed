import {z} from "zod";

import {bucketDirectMessages} from "./dm-bucket.ts";
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
    ErrorCode,
    Message,
    NormalizedScope,
    Reaction,
    ScopeFilter,
    SendMessageParams,
    Topic,
    TypingUser,
    User,
    ZulipEventListener,
} from "./types.ts";

export {bucketDirectMessages};

export interface ZulipTransportOptions {
    serverUrl: string;
    scope: ScopeFilter;
    historyLimit?: number;
    // Two credential paths are supported. Exactly one must be provided:
    //  - {email, apiKey}: legacy direct-auth. Requires a Zulip API key in
    //    the host page — fine for local development but a disclosure risk
    //    in production because any script on the page can read the DOM.
    //  - {authToken}: short-lived JWT minted by the embedder's own
    //    backend (HS256 signed with the shared secret provisioned in the
    //    Zulip org). We exchange it via POST /api/internal/jwt/fetch_api_key
    //    for an api_key + email that we then use transparently. No
    //    long-lived credentials touch the page.
    email?: string;
    apiKey?: string;
    authToken?: string;
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

// Typing events on /register include the sender's user_id + full name
// (plus recipients for DMs, which we ignore — we only report typing to
// the active scope). We're lenient about op since servers may emit
// op="start" or op="stop"; scope filtering happens upstream via narrow.
const typingEventSchema = z.object({
    op: z.enum(["start", "stop"]),
    sender: z.object({
        user_id: z.number(),
        email: z.string().optional(),
        full_name: z.string().optional(),
    }),
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

// Subscription records from /api/v1/users/me/subscriptions. We pluck
// display fields (color/pin/mute) and the per-user unread aggregate
// that /register reports separately.
const subscriptionSchema = z.object({
    stream_id: z.number(),
    name: z.string(),
    description: z.string().optional(),
    color: z.string().optional(),
    pin_to_top: z.boolean().optional(),
    is_muted: z.boolean().optional(),
});
const subscriptionsResponseSchema = z.object({
    subscriptions: z.array(subscriptionSchema),
});

// /api/v1/users/me/{stream_id}/topics — newest first. The server does
// not expose resolved-topic / unread state here; those come from the
// event queue on /register. We merge them in listTopics() below.
const topicSchema = z.object({
    name: z.string(),
    max_id: z.number(),
});
const topicsResponseSchema = z.object({
    topics: z.array(topicSchema),
});

export class ZulipTransport implements Transport {
    private readonly serverUrl: string;
    // Filled lazily: if the caller supplied an authToken, we don't know
    // the email/api-key until the JWT exchange returns. Every request()
    // awaits ensureAuthHeader(), which resolves as soon as auth is ready.
    private authHeader: string | undefined;
    private readonly authTokenExchange: Promise<void>;
    private readonly scope: NormalizedScope;
    private readonly historyLimit: number;
    private queueId: string | undefined;
    private lastEventId: number;
    private onEvent: ZulipEventListener | undefined;
    private pollController: AbortController | undefined;
    private closed = false;
    private currentUserId: number | undefined;
    private currentUser: User | undefined;
    // Deferred so ZulipClient.whenReady can `await` the full user record
    // even when the caller beats the /users/me round-trip. Settled by
    // loadCurrentUser() on success or by connect()/close() on failure.
    private readonly currentUserPromise: Promise<User>;
    private resolveCurrentUser!: (user: User) => void;
    private rejectCurrentUser!: (reason: unknown) => void;
    // Per-message reaction state. Zulip's reaction events are per-user
    // add/remove, but UI subscribers want the full bucketed list. We keep a
    // map here so we can emit that list on every op.
    private readonly reactionState = new Map<number, Map<string, Set<number>>>();
    // Users currently typing in the active scope. Keyed by user_id so a
    // second start from the same user replaces the first (and their
    // timeout also refreshes).
    private readonly typingUsers = new Map<number, TypingUser>();
    // stream_id cache for the active channel. Populated lazily on the
    // first sendTyping() call and invalidated on scope change. Typing in
    // channels requires stream_id; older servers that only support DM
    // typing will 400 on channel typing and we swallow the error.
    private channelIdCache: number | undefined;
    private channelIdCacheFor: string | undefined;

    constructor(options: ZulipTransportOptions) {
        this.serverUrl = validateServerUrl(options.serverUrl);
        this.scope = normalizeScope(options.scope);
        this.historyLimit = options.historyLimit ?? 50;
        this.lastEventId = -1;
        this.currentUserPromise = new Promise<User>((resolve, reject) => {
            this.resolveCurrentUser = resolve;
            this.rejectCurrentUser = reject;
        });
        this.currentUserPromise.catch(() => {
            /* prevent unhandled-rejection warnings; real rejection still
               propagates to callers that await whenReady */
        });

        const hasDirect = options.email !== undefined && options.apiKey !== undefined;
        const hasToken = options.authToken !== undefined && options.authToken !== "";
        if (!hasDirect && !hasToken) {
            throw new Error("ZulipTransport requires either {email, apiKey} or {authToken}");
        }
        if (hasDirect && hasToken) {
            throw new Error("ZulipTransport: pass either {email, apiKey} or {authToken}, not both");
        }

        if (hasDirect) {
            // btoa can't encode non-ASCII (email/apiKey with extended chars
            // throw InvalidCharacterError). Encode to UTF-8 first so we match
            // RFC 7617 and surface a clean error instead of a cryptic one.
            this.authHeader =
                "Basic " + base64EncodeUtf8(`${options.email ?? ""}:${options.apiKey ?? ""}`);
            this.authTokenExchange = Promise.resolve();
        } else {
            this.authTokenExchange = this.exchangeAuthToken(options.authToken!);
            // Prevent an unhandled-rejection warning when the exchange
            // fails before the first request() awaits it. The rejection
            // still propagates through every subsequent `await
            // this.authTokenExchange`.
            this.authTokenExchange.catch(() => {
                /* suppressed — see comment above */
            });
        }
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
            const classified =
                error instanceof ClassifiedError ? error : classifyThrownError(error);
            onEvent({type: "connection", status: "error"});
            onEvent({
                type: "error",
                code: classified.code,
                error: classified.message,
                retryAfterMs: classified.retryAfterMs,
            });
            if (this.currentUser === undefined) this.rejectCurrentUser(error);
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
        if (this.currentUser === undefined) {
            this.rejectCurrentUser(new Error("Transport closed before user identity was resolved"));
        }
        this.onEvent?.({type: "connection", status: "disconnected"});
        this.onEvent = undefined;
    }

    async getMessages(
        scope: ScopeFilter,
        options: GetMessagesOptions = {},
    ): Promise<GetMessagesResult> {
        const normalized = normalizeScope(scope);
        const narrow = buildNarrow(normalized);
        // Anchor semantics: for pagination we anchor on the oldest id we
        // already have and ask for num_before messages strictly older.
        // Zulip includes the anchor in its response, so we strip it below
        // to avoid a duplicate.
        const limit = options.limit ?? this.historyLimit;
        const anchor = options.beforeId === undefined ? "newest" : String(options.beforeId);
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
            parsed.found_oldest === undefined ? messages.length >= limit : !parsed.found_oldest;
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

    async editMessage(params: EditMessageParams): Promise<void> {
        const body: Record<string, string> = {};
        const newContent =
            params.kind === "content" || params.kind === "both" ? params.content : undefined;
        const newTopic =
            params.kind === "topic" || params.kind === "both" ? params.topic : undefined;
        if (newContent !== undefined) body["content"] = newContent;
        if (newTopic !== undefined) body["topic"] = newTopic;
        await this.request("PATCH", `/api/v1/messages/${String(params.messageId)}`, body);
        // Optimistic local update: the server will also emit an
        // update_message event through the event queue, but dispatching
        // one here keeps the UI responsive even before the poll catches
        // up. The component's updateMessage handler is idempotent so
        // double-delivery is harmless.
        if (!this.reactionState.has(params.messageId)) return;
        this.onEvent?.({
            type: "message-update",
            messageId: params.messageId,
            // `content` here is the raw markdown the viewer typed — the
            // server will re-render and broadcast the HTML via the event
            // queue. Flag as non-HTML so the sanitizer isn't invoked on
            // user-typed markdown in the interim.
            content: newContent,
            contentIsHtml: newContent === undefined ? undefined : false,
            topic: newTopic,
        });
    }

    async deleteMessage(messageId: number): Promise<void> {
        await this.request("DELETE", `/api/v1/messages/${String(messageId)}`);
        // Optimistic local removal, same rationale as editMessage above.
        if (!this.reactionState.has(messageId)) return;
        this.reactionState.delete(messageId);
        this.onEvent?.({type: "message-delete", messageId});
    }

    async sendMessage(params: SendMessageParams): Promise<void> {
        await this.postMessage(params);
    }

    async sendMessageWithId(params: SendMessageParams): Promise<{messageId: number}> {
        const parsed = await this.postMessage(params);
        return {messageId: parsed.id};
    }

    private async postMessage(
        params: SendMessageParams,
    ): Promise<z.infer<typeof sendMessageResponseSchema>> {
        const body: Record<string, string> = {content: params.content};
        if (params.type === "channel") {
            // Wire value is "stream" for back-compat with Zulip < 9. Zulip
            // renamed streams to channels but still accepts the legacy value
            // on /messages for every supported server version, so sending
            // "stream" here means the embed works against old and new Zulip
            // without version sniffing.
            body["type"] = "stream";
            body["to"] = params.channel;
            body["topic"] = params.topic;
        } else {
            // Wire value is "private" for the same back-compat reason —
            // Zulip < 9 rejects the newer "direct" alias on /messages.
            // See CLAUDE.md "wire format is the one exception."
            body["type"] = "private";
            body["to"] = JSON.stringify(params.recipients);
        }
        const response = await this.request("POST", "/api/v1/messages", body);
        return sendMessageResponseSchema.parse(response);
    }

    async sendTyping(op: TypingOp, scope: ScopeFilter): Promise<void> {
        const normalized = normalizeScope(scope);
        if (normalized.kind === "dm") {
            // DM typing pings to /api/v1/typing use `to` with a JSON
            // array of user ids. The SDK layer canonicalizes the list
            // (sorted, deduped) so a DM-with-self and
            // DM-with-same-group-in-different-order don't fight.
            const body: Record<string, string> = {
                op,
                // Legacy wire value — Zulip < 9 rejects "direct" on /typing.
                // See CLAUDE.md "wire format is the one exception."
                type: "private",
                to: JSON.stringify(normalized.userIds),
            };
            try {
                await this.request("POST", "/api/v1/typing", body);
            } catch {
                // Best-effort — old servers return 400 on unfamiliar
                // parameters; typing is a hint, not a hard requirement.
            }
            return;
        }
        // Channel typing requires the numeric stream_id, not the name.
        // Cache per channel: the caller's scope is stable across a
        // session, so we only resolve the id on the first typing ping.
        const streamId = await this.resolveChannelId(normalized.channel);
        if (streamId === undefined) return;
        const body: Record<string, string> = {
            op,
            // Wire value is the legacy "stream"; Zulip's typing endpoint
            // accepts both "stream" and "channel" on current servers but
            // "stream" works everywhere — matches the same rationale as
            // sendMessage() above.
            type: "stream",
            stream_id: String(streamId),
            topic: normalized.topic ?? "",
        };
        try {
            await this.request("POST", "/api/v1/typing", body);
        } catch {
            // Older servers without channel typing return 400 here. The
            // composer fires these rapidly, so swallow the error rather
            // than spam the error banner — typing is a best-effort hint.
        }
    }

    async listChannels(): Promise<Channel[]> {
        const response = await this.request("GET", "/api/v1/users/me/subscriptions");
        const parsed = subscriptionsResponseSchema.parse(response);
        // pinned-first, then alphabetical within each group. Matches the
        // ordering Zulip's own web app uses.
        const rows = [...parsed.subscriptions].sort((a, b) => {
            const ap = a.pin_to_top ? 0 : 1;
            const bp = b.pin_to_top ? 0 : 1;
            if (ap !== bp) return ap - bp;
            return a.name.localeCompare(b.name);
        });
        return rows.map((s) => ({
            channelId: s.stream_id,
            name: s.name,
            description: s.description ?? "",
            color: s.color,
            pinToTop: s.pin_to_top,
            isMuted: s.is_muted,
        }));
    }

    async listTopics(channel: string): Promise<Topic[]> {
        const streamId = await this.resolveChannelId(channel);
        if (streamId === undefined) return [];
        const response = await this.request("GET", `/api/v1/users/me/${String(streamId)}/topics`);
        const parsed = topicsResponseSchema.parse(response);
        // Resolved topics carry a magic prefix in their name; peel it off
        // and expose the resolved state as a boolean so UI code doesn't
        // need to know the server's sentinel.
        const resolvedPrefix = "\u2714 ";
        return parsed.topics.map((t) => {
            const isResolved = t.name.startsWith(resolvedPrefix);
            return {
                name: isResolved ? t.name.slice(resolvedPrefix.length) : t.name,
                maxMessageId: t.max_id,
                isResolved,
            };
        });
    }

    async listDirectMessageConversations(): Promise<DirectMessageConversation[]> {
        // Derive from recent /messages rather than a dedicated endpoint:
        // Zulip's REST API doesn't ship a "list my DM threads" call on
        // every supported version, but narrowing /messages on an empty
        // pm-with filter returns every DM the viewer can see. We cap at
        // 200 messages — enough to surface ~dozens of distinct threads
        // without paginating.
        const params = {
            anchor: "newest",
            num_before: "200",
            num_after: "0",
            // Wire operator is "is" with value "dm" — Zulip accepts both
            // "dm" and "private" on modern servers; "private" is the
            // legacy spelling that still works on Zulip < 9.
            narrow: JSON.stringify([["is", "private"]]),
        };
        const response = await this.request("GET", "/api/v1/messages", params);
        const parsed = messagesResponseSchema.safeParse(response);
        if (!parsed.success) return [];
        const messages = parsed.data.messages.map(convertMessage);
        return bucketDirectMessages(messages, this.currentUserId);
    }

    async fetchMessage(messageId: number): Promise<Message | undefined> {
        try {
            const response = await this.request(
                "GET",
                `/api/v1/messages/${String(messageId)}`,
                {apply_markdown: "true"},
            );
            const parsed = z
                .object({message: messageSchema})
                .safeParse(response);
            if (!parsed.success) return undefined;
            const message = convertMessage(parsed.data.message);
            this.rememberReactions(message);
            return message;
        } catch {
            return undefined;
        }
    }

    getCurrentUserId(): number | undefined {
        return this.currentUserId;
    }

    getCurrentUser(): Promise<User> {
        return this.currentUserPromise;
    }

    private async resolveChannelId(channel: string): Promise<number | undefined> {
        if (this.channelIdCacheFor === channel && this.channelIdCache !== undefined) {
            return this.channelIdCache;
        }
        try {
            const response = await this.request("GET", "/api/v1/get_stream_id", {
                stream: channel,
            });
            const parsed = z.object({stream_id: z.number()}).safeParse(response);
            if (!parsed.success) return undefined;
            this.channelIdCache = parsed.data.stream_id;
            this.channelIdCacheFor = channel;
            return parsed.data.stream_id;
        } catch {
            return undefined;
        }
    }

    private async register(): Promise<z.infer<typeof registerResponseSchema>> {
        const body = {
            event_types: JSON.stringify([
                "message",
                "update_message",
                "delete_message",
                "reaction",
                "typing",
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
        } else if (event.type === "typing") {
            const parsed = typingEventSchema.safeParse(event);
            if (!parsed.success) return;
            // Skip notifications about ourselves — the server still
            // broadcasts them to the originating client.
            if (parsed.data.sender.user_id === this.currentUserId) return;
            if (parsed.data.op === "start") {
                this.typingUsers.set(parsed.data.sender.user_id, {
                    userId: parsed.data.sender.user_id,
                    fullName: parsed.data.sender.full_name ?? "Someone",
                });
            } else {
                this.typingUsers.delete(parsed.data.sender.user_id);
            }
            this.onEvent?.({type: "typing", users: [...this.typingUsers.values()]});
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

    private async exchangeAuthToken(token: string): Promise<void> {
        // POST {token} to /api/internal/jwt/fetch_api_key. Returns
        // {api_key, email, user_id} on success; we only need api_key + email
        // here since /users/me will fetch the rest during connect(). No
        // auth header on this request — the JWT is the credential.
        const url = new URL(this.serverUrl + "/api/internal/jwt/fetch_api_key");
        const body = new URLSearchParams({token}).toString();
        let response: Response;
        try {
            response = await fetch(url.toString(), {
                method: "POST",
                headers: {"Content-Type": "application/x-www-form-urlencoded"},
                body,
            });
        } catch (error) {
            throw classifyThrownError(error);
        }
        if (!response.ok) {
            if (response.status === 404) {
                throw new ClassifiedError(
                    "JWT login is not configured on this Zulip server. Ask the admin to enable JWT_AUTH_KEYS.",
                    "jwt-not-configured",
                );
            }
            throw await classifyHttpError(response, "/api/internal/jwt/fetch_api_key");
        }
        const payload = (await response.json()) as {
            api_key?: unknown;
            email?: unknown;
        };
        if (typeof payload.api_key !== "string" || typeof payload.email !== "string") {
            throw new ClassifiedError(
                "JWT exchange response missing api_key or email",
                "unauthorized",
            );
        }
        this.authHeader = "Basic " + base64EncodeUtf8(`${payload.email}:${payload.api_key}`);
    }

    private async loadCurrentUser(): Promise<void> {
        const response = await this.request("GET", "/api/v1/users/me");
        const me = z
            .object({
                user_id: z.number(),
                email: z.string().optional(),
                full_name: z.string().optional(),
                avatar_url: z.string().nullable().optional(),
            })
            .parse(response);
        this.currentUserId = me.user_id;
        const user: User = {
            userId: me.user_id,
            email: me.email ?? "",
            fullName: me.full_name ?? "",
            avatarUrl: me.avatar_url ?? "",
        };
        this.currentUser = user;
        this.resolveCurrentUser(user);
    }

    private async pollLoop(): Promise<void> {
        // Exponential backoff with decorrelated jitter, capped at 30s. After
        // any successful poll we reset the attempt counter so a healthy
        // queue stays in the "connected" state and the next failure starts
        // from a short delay.
        let attempt = 0;
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
                if (attempt > 0) {
                    // We were in the reconnecting state; tell subscribers
                    // the queue is healthy again so the UI banner clears.
                    this.onEvent?.({type: "connection", status: "connected"});
                    attempt = 0;
                }
                const parsed = eventsResponseSchema.parse(response);
                for (const event of parsed.events) {
                    this.lastEventId = Math.max(this.lastEventId, event.id);
                    this.dispatchEvent(event);
                }
            } catch (error) {
                if (this.closed) return;
                if ((error as {name?: string}).name === "AbortError") return;
                const classified =
                    error instanceof ClassifiedError ? error : classifyThrownError(error);
                attempt += 1;
                const delayMs = classified.retryAfterMs ?? computeBackoffMs(attempt);
                this.onEvent?.({
                    type: "error",
                    code: classified.code,
                    error: classified.message,
                    retryAfterMs: classified.retryAfterMs,
                });
                this.onEvent?.({
                    type: "connection",
                    status: "reconnecting",
                    attempt,
                    delayMs,
                    reason: classified.message,
                });
                await wait(delayMs);
            }
        }
    }

    private async request(
        method: "GET" | "POST" | "DELETE" | "PATCH",
        path: string,
        params: Record<string, string> | undefined = undefined,
        signal?: AbortSignal,
    ): Promise<unknown> {
        // Block on JWT exchange the first time (resolves immediately on the
        // direct-auth path). Subsequent awaits are no-ops against the
        // settled promise.
        await this.authTokenExchange;
        if (this.authHeader === undefined) {
            throw new ClassifiedError("Authorization header unavailable", "unauthorized");
        }
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

        let response: Response;
        try {
            response = await fetch(url.toString(), init);
        } catch (error) {
            // AbortError is a legitimate close, not a network failure —
            // preserve the AbortError shape so pollLoop's check still works.
            if ((error as {name?: string}).name === "AbortError") throw error;
            throw classifyThrownError(error);
        }
        if (!response.ok) {
            throw await classifyHttpError(response, path);
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
        throw new Error(`Zulip server URL must use http or https (got ${parsed.protocol}): ${raw}`);
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

// Thrown by `request()` after a failed fetch so call sites (including
// the poll loop) can surface a typed ErrorCode on the event bus without
// re-parsing the response. Plain `Error` would lose the classification.
class ClassifiedError extends Error {
    readonly code: ErrorCode;
    readonly retryAfterMs: number | undefined;
    constructor(message: string, code: ErrorCode, retryAfterMs: number | undefined = undefined) {
        super(message);
        this.code = code;
        this.retryAfterMs = retryAfterMs;
    }
}

async function classifyHttpError(response: Response, path: string): Promise<ClassifiedError> {
    // Zulip returns JSON like {"result": "error", "msg": "Invalid narrow operator: foo", "code": "BAD_REQUEST"}.
    // Surface that msg directly so the chat banner is actionable.
    const status = String(response.status);
    let serverMsg: string | undefined;
    let serverCode: string | undefined;
    try {
        const body = (await response.json()) as {msg?: unknown; code?: unknown};
        if (typeof body.msg === "string" && body.msg !== "") serverMsg = body.msg;
        if (typeof body.code === "string") serverCode = body.code;
    } catch {
        // Response wasn't JSON; fall through to the bare status line.
    }
    const message =
        serverMsg === undefined
            ? `HTTP ${status} from ${path}`
            : `HTTP ${status} from ${path}: ${serverMsg}`;

    let code: ErrorCode = "unknown";
    let retryAfterMs: number | undefined;
    if (response.status === 401) {
        code = "unauthorized";
    } else if (response.status === 403) {
        // Zulip surfaces "Not subscribed to channel …" as a 400/403 with a
        // matching `code`. Prefer the machine code when the server gives
        // us one, otherwise pattern-match the message.
        if (
            serverCode === "STREAM_DOES_NOT_EXIST" ||
            serverCode === "NOT_SUBSCRIBED" ||
            (serverMsg !== undefined && /not subscribed/i.test(serverMsg))
        ) {
            code = "channel-not-subscribed";
        } else {
            code = "unauthorized";
        }
    } else if (response.status === 429) {
        code = "rate-limited";
        const retryHeader = response.headers.get("Retry-After");
        if (retryHeader !== null) {
            const seconds = Number(retryHeader);
            if (Number.isFinite(seconds) && seconds >= 0) {
                retryAfterMs = Math.round(seconds * 1000);
            }
        }
    }
    return new ClassifiedError(message, code, retryAfterMs);
}

function classifyThrownError(error: unknown): ClassifiedError {
    if (error instanceof ClassifiedError) return error;
    // fetch() rejects with TypeError on DNS failure, CORS preflight
    // rejection, or a dropped TCP connection — classify as network so UI
    // can show a "check your connection" hint rather than a generic banner.
    if (error instanceof TypeError) {
        return new ClassifiedError(describeError(error), "network");
    }
    return new ClassifiedError(describeError(error), "unknown");
}

function buildNarrow(scope: NormalizedScope): Array<[string, string]> {
    if (scope.kind === "dm") {
        // Wire operator is "pm-with" (not "dm") for Zulip < 9 compat —
        // the legacy operator is still accepted on every supported
        // server, same rationale as "stream" vs. "channel" above.
        // The value is a comma-separated list of user ids; Zulip's
        // server parses these in any order but we pass sorted for
        // deterministic caching upstream.
        return [["pm-with", scope.userIds.join(",")]];
    }
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

const directRecipientSchema = z.object({
    id: z.number(),
    email: z.string().optional(),
    full_name: z.string().optional(),
});

function convertMessage(api: ApiMessage): Message {
    // Normalize Zulip's wire-level "stream"/"private" to the current
    // "channel"/"direct" terminology. Callers of this SDK should never have
    // to know that the server speaks the older dialect.
    const isChannelMessage = api.type === "stream" || api.type === "channel";
    const reactionsByEmoji = new Map<string, {emoji: string; userIds: Set<number>}>();
    for (const r of api.reactions) {
        let bucket = reactionsByEmoji.get(r.emoji_name);
        if (!bucket) {
            bucket = {emoji: r.emoji_name, userIds: new Set()};
            reactionsByEmoji.set(r.emoji_name, bucket);
        }
        bucket.userIds.add(r.user_id);
    }
    const reactions = [...reactionsByEmoji.values()].map((bucket) => ({
        emoji: bucket.emoji,
        count: bucket.userIds.size,
        userIds: [...bucket.userIds],
    }));
    const base = {
        id: api.id,
        senderId: api.sender_id,
        senderFullName: api.sender_full_name,
        senderEmail: api.sender_email,
        avatarUrl: api.avatar_url ?? "",
        timestamp: api.timestamp * 1000,
        content: api.content,
        contentIsHtml: true,
        reactions,
    };
    if (isChannelMessage) {
        // Zulip's channel messages always include a string display_recipient
        // and a subject; the fallback to "" is defensive — a malformed
        // server response shouldn't crash the renderer, it just produces
        // an orphan-looking message.
        const channelName = typeof api.display_recipient === "string" ? api.display_recipient : "";
        return {
            ...base,
            type: "channel",
            channelName,
            topic: api.subject ?? "",
        };
    }
    const recipients: User[] = [];
    if (Array.isArray(api.display_recipient)) {
        for (const entry of api.display_recipient) {
            const parsed = directRecipientSchema.safeParse(entry);
            if (!parsed.success) continue;
            recipients.push({
                userId: parsed.data.id,
                email: parsed.data.email ?? "",
                fullName: parsed.data.full_name ?? "",
                avatarUrl: "",
            });
        }
    }
    return {
        ...base,
        type: "direct",
        recipients,
    };
}

function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Decorrelated-jitter backoff. 1s base, exponential to 30s cap, with
// uniform jitter in [0, delay) so many simultaneously-reconnecting clients
// don't hammer the server in lockstep.
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;
function computeBackoffMs(attempt: number): number {
    const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
    return Math.floor(Math.random() * exp) + BACKOFF_BASE_MS;
}
