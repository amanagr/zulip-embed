import {z} from "zod";

import type {Transport} from "./transport.ts";
import type {
    Message,
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
    type: z.enum(["stream", "private"]),
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

const eventSchema = z.object({
    id: z.number(),
    type: z.string(),
    message: messageSchema.optional(),
});

const eventsResponseSchema = z.object({
    events: z.array(eventSchema).default([]),
});

const messagesResponseSchema = z.object({
    messages: z.array(messageSchema),
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

    constructor(options: ZulipTransportOptions) {
        this.serverUrl = options.serverUrl.replace(/\/+$/, "");
        this.authHeader = "Basic " + btoa(`${options.email}:${options.apiKey}`);
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

    async getMessages(scope: ScopeFilter): Promise<Message[]> {
        const narrow = buildNarrow(scope);
        const params = {
            anchor: "newest",
            num_before: String(this.historyLimit),
            num_after: "0",
            narrow: JSON.stringify(narrow),
        };
        const response = await this.request("GET", "/api/v1/messages", params);
        const parsed = messagesResponseSchema.parse(response);
        return parsed.messages.map(convertMessage);
    }

    async sendMessage(params: SendMessageParams): Promise<void> {
        const body: Record<string, string> = {content: params.content};
        if (params.type === "stream") {
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
            event_types: JSON.stringify(["message"]),
            narrow: JSON.stringify(buildNarrow(this.scope)),
            apply_markdown: "true",
        };
        const response = await this.request("POST", "/api/v1/register", body);
        return registerResponseSchema.parse(response);
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
                    if (event.type === "message" && event.message) {
                        this.onEvent?.({
                            type: "message",
                            message: convertMessage(event.message),
                        });
                    }
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
            throw new Error(`HTTP ${String(response.status)} from ${path}`);
        }
        return response.json();
    }
}

function buildNarrow(scope: ScopeFilter): Array<{operator: string; operand: string}> {
    const narrow: Array<{operator: string; operand: string}> = [
        {operator: "stream", operand: scope.channel},
    ];
    if (scope.topic !== undefined && scope.topic !== "") {
        narrow.push({operator: "topic", operand: scope.topic});
    }
    return narrow;
}

function convertMessage(api: ApiMessage): Message {
    const streamName =
        api.type === "stream" && typeof api.display_recipient === "string"
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
        type: api.type,
        streamName,
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
