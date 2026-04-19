import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import {AGENT_REPLY_ABORT_TOOL_ID, STREAMING_EDIT_WINDOW_MS} from "../src/agent-reply.ts";
import {ZulipClient} from "../src/client.ts";
import type {
    EditMessageParams,
    GetMessagesOptions,
    GetMessagesResult,
    ReactionParams,
    Transport,
    TypingOp,
} from "../src/transport.ts";
import type {
    Channel,
    ScopeFilter,
    SendMessageParams,
    Topic,
    User,
    ZulipEvent,
    ZulipEventListener,
} from "../src/types.ts";

// Fake transport tailored to the streaming-edit debounce: records every
// editMessage call (and its timestamp relative to vi's fake clock) so
// tests can assert on the 4 Hz cap without brittle sleep expectations.
class StreamingFakeTransport implements Transport {
    public emit: ZulipEventListener = () => {};
    public readonly edits: EditMessageParams[] = [];
    public readonly sends: SendMessageParams[] = [];
    public nextId = 1000;
    public withIdResult: {messageId: number} | undefined;

    async connect(onEvent: ZulipEventListener): Promise<void> {
        this.emit = onEvent;
        onEvent({type: "connection", status: "connected"});
    }

    async close(): Promise<void> {}

    async getMessages(
        _scope: ScopeFilter,
        _options?: GetMessagesOptions,
    ): Promise<GetMessagesResult> {
        return {messages: [], hasMore: false};
    }

    async sendMessage(params: SendMessageParams): Promise<void> {
        this.sends.push(params);
    }

    async sendMessageWithId(params: SendMessageParams): Promise<{messageId: number}> {
        this.sends.push(params);
        if (this.withIdResult !== undefined) return this.withIdResult;
        return {messageId: this.nextId++};
    }

    async editMessage(params: EditMessageParams): Promise<void> {
        this.edits.push(params);
    }

    async deleteMessage(_messageId: number): Promise<void> {}

    async addReaction(_params: ReactionParams): Promise<void> {}

    async removeReaction(_params: ReactionParams): Promise<void> {}

    async sendTyping(_op: TypingOp, _scope: ScopeFilter): Promise<void> {}

    async listChannels(): Promise<Channel[]> {
        return [];
    }

    async listTopics(_channel: string): Promise<Topic[]> {
        return [];
    }

    getCurrentUserId(): number | undefined {
        return 42;
    }

    getCurrentUser(): Promise<User> {
        return Promise.resolve({
            userId: 42,
            email: "me@example.com",
            fullName: "Me",
            avatarUrl: "",
        });
    }
}

async function flushMicrotasks(): Promise<void> {
    // Exhaust the microtask queue. vi's fake timers don't advance
    // microtasks automatically; we need one real tick so the
    // sendMessageWithId promise resolves and the handle's subsequent
    // broadcast logic runs.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe("startAgentReply — streaming primitive", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test("append 200 tokens then advance 250ms → one editMessage call", async () => {
        const transport = new StreamingFakeTransport();
        const client = new ZulipClient({
            transport,
            scope: {channel: "general", topic: "welcome"},
        });
        await client.connect();

        const handle = client.startAgentReply(
            {channel: "general", topic: "welcome"},
            {author: {fullName: "Agent", avatarUrl: ""}},
        );

        await flushMicrotasks();
        const messageId = await handle.messageId;
        expect(messageId).toBe(1000);
        expect(transport.sends).toHaveLength(1);
        expect(transport.sends[0]).toMatchObject({
            type: "channel",
            channel: "general",
            topic: "welcome",
        });

        for (let i = 0; i < 200; i++) {
            handle.appendToken(`t${String(i)} `);
        }

        // Immediately before the debounce window closes: no broadcast.
        expect(transport.edits).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(STREAMING_EDIT_WINDOW_MS);
        await flushMicrotasks();

        expect(transport.edits).toHaveLength(1);
        const firstEdit = transport.edits[0];
        expect(firstEdit).toBeDefined();
        if (firstEdit === undefined) return;
        expect(firstEdit.kind).toBe("content");
        if (firstEdit.kind === "content") {
            expect(firstEdit.content).toContain("t0 ");
            expect(firstEdit.content).toContain("t199 ");
        }
    });

    test("local message-update events fire on each token so subscribers see 60fps echo", async () => {
        const transport = new StreamingFakeTransport();
        const client = new ZulipClient({
            transport,
            scope: {channel: "general"},
        });
        await client.connect();

        const events: ZulipEvent[] = [];
        client.subscribe((e) => {
            events.push(e);
        });

        const handle = client.startAgentReply(
            {channel: "general"},
            {author: {fullName: "Agent", avatarUrl: ""}},
        );
        await flushMicrotasks();
        await handle.messageId;

        handle.appendToken("hello ");
        handle.appendToken("world");
        await flushMicrotasks();

        const updates = events.filter((e) => e.type === "message-update");
        expect(updates.length).toBeGreaterThanOrEqual(2);
        // No broadcast yet — local echo only.
        expect(transport.edits).toHaveLength(0);
    });

    test("abort after 100 tokens → final edit with partial content + aborted marker in parts", async () => {
        const transport = new StreamingFakeTransport();
        const client = new ZulipClient({
            transport,
            scope: {channel: "general"},
        });
        await client.connect();

        const events: ZulipEvent[] = [];
        client.subscribe((e) => events.push(e));

        const handle = client.startAgentReply(
            {channel: "general"},
            {author: {fullName: "Agent", avatarUrl: ""}},
        );
        await flushMicrotasks();
        await handle.messageId;

        for (let i = 0; i < 100; i++) handle.appendToken("x");

        // Abort never throws even on the rejection path — caller puts it
        // in a `finally` block.
        await expect(handle.abort("user cancelled")).resolves.toBeUndefined();
        await flushMicrotasks();

        const lastEdit = transport.edits[transport.edits.length - 1];
        expect(lastEdit).toBeDefined();
        if (lastEdit === undefined) return;
        expect(lastEdit.kind).toBe("content");
        if (lastEdit.kind === "content") {
            expect(lastEdit.content).toContain("xxx");
        }

        // The aborted marker lives on the locally emitted message-update
        // event's parts (editMessage params don't carry structured parts
        // on the wire — that's #6's job). The final terminal update
        // includes a tool_result with the sentinel toolCallId.
        const updates = events.filter(
            (e): e is Extract<ZulipEvent, {type: "message-update"}> => e.type === "message-update",
        );
        const finalUpdate = updates[updates.length - 1];
        expect(finalUpdate).toBeDefined();
        expect(finalUpdate?.parts).toBeDefined();
        const abortPart = finalUpdate?.parts?.find(
            (p) => p.type === "tool_result" && p.toolCallId === AGENT_REPLY_ABORT_TOOL_ID,
        );
        expect(abortPart).toBeDefined();
        if (abortPart !== undefined && abortPart.type === "tool_result") {
            expect(abortPart.isError).toBe(true);
            expect(abortPart.output).toBe("user cancelled");
        }
    });

    test("finish without final args broadcasts the accumulated text in a terminal edit", async () => {
        const transport = new StreamingFakeTransport();
        const client = new ZulipClient({
            transport,
            scope: {channel: "general"},
        });
        await client.connect();

        const handle = client.startAgentReply(
            {channel: "general"},
            {author: {fullName: "Agent", avatarUrl: ""}},
        );
        await flushMicrotasks();
        await handle.messageId;

        handle.appendToken("final ");
        handle.appendToken("answer");
        await handle.finish();
        await flushMicrotasks();

        const lastEdit = transport.edits[transport.edits.length - 1];
        expect(lastEdit).toBeDefined();
        if (lastEdit === undefined) return;
        if (lastEdit.kind === "content") {
            expect(lastEdit.content).toBe("final answer");
        }
    });

    test("finish({content}) override replaces the streamed transcript", async () => {
        const transport = new StreamingFakeTransport();
        const client = new ZulipClient({
            transport,
            scope: {channel: "general"},
        });
        await client.connect();

        const handle = client.startAgentReply(
            {channel: "general"},
            {author: {fullName: "Agent", avatarUrl: ""}},
        );
        await flushMicrotasks();
        await handle.messageId;

        handle.appendToken("draft ");
        handle.appendToken("contents");
        await handle.finish({content: "polished output"});
        await flushMicrotasks();

        const lastEdit = transport.edits[transport.edits.length - 1];
        expect(lastEdit).toBeDefined();
        if (lastEdit?.kind === "content") {
            expect(lastEdit.content).toBe("polished output");
        }
    });

    test("appendEvent queues a structured part alongside streamed text", async () => {
        const transport = new StreamingFakeTransport();
        const client = new ZulipClient({
            transport,
            scope: {channel: "general"},
        });
        await client.connect();

        const events: ZulipEvent[] = [];
        client.subscribe((e) => events.push(e));

        const handle = client.startAgentReply(
            {channel: "general"},
            {author: {fullName: "Agent", avatarUrl: ""}},
        );
        await flushMicrotasks();
        await handle.messageId;

        handle.appendToken("looking up… ");
        handle.appendEvent({
            type: "tool_call",
            id: "t1",
            name: "search",
            input: {query: "hello"},
            status: "complete",
        });
        handle.appendToken("done");
        await handle.finish();
        await flushMicrotasks();

        const updates = events.filter(
            (e): e is Extract<ZulipEvent, {type: "message-update"}> => e.type === "message-update",
        );
        const finalUpdate = updates[updates.length - 1];
        const kinds = finalUpdate?.parts?.map((p) => p.type) ?? [];
        expect(kinds).toContain("tool_call");
        // Two text segments (before + after the tool_call), each preserved.
        expect(kinds.filter((k) => k === "text")).toHaveLength(2);
    });

    test("missing sendMessageWithId → messageId rejects; other methods are no-ops", async () => {
        const transport: Transport = {
            async connect(onEvent) {
                onEvent({type: "connection", status: "connected"});
            },
            async close() {},
            async getMessages() {
                return {messages: [], hasMore: false};
            },
            async sendMessage() {},
            async editMessage() {},
            async deleteMessage() {},
            async addReaction() {},
            async removeReaction() {},
            async sendTyping() {},
            async listChannels() {
                return [];
            },
            async listTopics() {
                return [];
            },
            getCurrentUserId() {
                return undefined;
            },
            getCurrentUser() {
                return Promise.reject(new Error("no user"));
            },
        };
        const client = new ZulipClient({transport, scope: {channel: "general"}});
        await client.connect();

        const handle = client.startAgentReply(
            {channel: "general"},
            {author: {fullName: "Agent", avatarUrl: ""}},
        );
        await expect(handle.messageId).rejects.toThrow(/sendMessageWithId/);
        handle.appendToken("ignored");
        // Abort is always safe — even without a valid provisional send.
        await expect(handle.abort()).resolves.toBeUndefined();
    });

    test("debounce coalesces rapid appends into at most one edit per 250ms window", async () => {
        const transport = new StreamingFakeTransport();
        const client = new ZulipClient({transport, scope: {channel: "general"}});
        await client.connect();

        const handle = client.startAgentReply(
            {channel: "general"},
            {author: {fullName: "Agent", avatarUrl: ""}},
        );
        await flushMicrotasks();
        await handle.messageId;

        // Two 150 ms bursts with one 250 ms window between them. Only
        // the second burst triggers a second edit; the first window
        // still ends with a flushed broadcast from the first burst.
        handle.appendToken("a");
        await vi.advanceTimersByTimeAsync(150);
        handle.appendToken("b");
        await vi.advanceTimersByTimeAsync(150);
        // ~300 ms elapsed, one broadcast has fired.
        await flushMicrotasks();
        expect(transport.edits.length).toBeGreaterThanOrEqual(1);
        const firstCount = transport.edits.length;

        handle.appendToken("c");
        await vi.advanceTimersByTimeAsync(STREAMING_EDIT_WINDOW_MS + 10);
        await flushMicrotasks();

        // Second burst produced exactly one more edit.
        expect(transport.edits.length).toBe(firstCount + 1);
    });

    test("DM 1:1 scope → provisional send routes type=direct with the peer's id", async () => {
        const transport = new StreamingFakeTransport();
        const client = new ZulipClient({
            transport,
            scope: {kind: "dm", userIds: [42, 99]},
        });
        await client.connect();

        const handle = client.startAgentReply(
            {kind: "dm", userIds: [42, 99]},
            {author: {fullName: "Agent", avatarUrl: ""}},
        );
        await flushMicrotasks();
        const messageId = await handle.messageId;
        expect(messageId).toBe(1000);

        // Viewer id (42) gets filtered off the recipients list so Zulip
        // doesn't reject the send as a self-addressed DM. Only the peer
        // remains, stringified per SendMessageParams.
        expect(transport.sends).toHaveLength(1);
        expect(transport.sends[0]).toMatchObject({
            type: "direct",
            recipients: ["99"],
        });
    });

    test("DM group scope → provisional send routes type=direct with all non-viewer ids", async () => {
        const transport = new StreamingFakeTransport();
        const client = new ZulipClient({
            transport,
            scope: {kind: "dm", userIds: [42, 77, 99]},
        });
        await client.connect();

        const handle = client.startAgentReply(
            {kind: "dm", userIds: [42, 77, 99]},
            {author: {fullName: "Agent", avatarUrl: ""}},
        );
        await flushMicrotasks();
        await handle.messageId;

        expect(transport.sends).toHaveLength(1);
        expect(transport.sends[0]).toMatchObject({
            type: "direct",
            recipients: ["77", "99"],
        });
    });

    test("DM scope → streamed tokens broadcast through the same 4 Hz editMessage loop", async () => {
        const transport = new StreamingFakeTransport();
        const client = new ZulipClient({
            transport,
            scope: {kind: "dm", userIds: [42, 99]},
        });
        await client.connect();

        const handle = client.startAgentReply(
            {kind: "dm", userIds: [42, 99]},
            {author: {fullName: "Agent", avatarUrl: ""}},
        );
        await flushMicrotasks();
        await handle.messageId;

        for (let i = 0; i < 50; i++) {
            handle.appendToken(`dm${String(i)} `);
        }
        // Still inside the debounce window — no broadcast.
        expect(transport.edits).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(STREAMING_EDIT_WINDOW_MS);
        await flushMicrotasks();

        expect(transport.edits).toHaveLength(1);
        const first = transport.edits[0];
        expect(first).toBeDefined();
        if (first?.kind === "content") {
            expect(first.content).toContain("dm0 ");
            expect(first.content).toContain("dm49 ");
        }
    });

    test("DM scope → abort lands a terminal edit + sentinel tool_result on the local update", async () => {
        const transport = new StreamingFakeTransport();
        const client = new ZulipClient({
            transport,
            scope: {kind: "dm", userIds: [42, 99]},
        });
        await client.connect();

        const events: ZulipEvent[] = [];
        client.subscribe((e) => events.push(e));

        const handle = client.startAgentReply(
            {kind: "dm", userIds: [42, 99]},
            {author: {fullName: "Agent", avatarUrl: ""}},
        );
        await flushMicrotasks();
        await handle.messageId;

        handle.appendToken("partial");
        await expect(handle.abort("user cancelled")).resolves.toBeUndefined();
        await flushMicrotasks();

        const lastEdit = transport.edits[transport.edits.length - 1];
        expect(lastEdit).toBeDefined();
        if (lastEdit?.kind === "content") {
            expect(lastEdit.content).toContain("partial");
        }

        const updates = events.filter(
            (e): e is Extract<ZulipEvent, {type: "message-update"}> => e.type === "message-update",
        );
        const finalUpdate = updates[updates.length - 1];
        const abortPart = finalUpdate?.parts?.find(
            (p) => p.type === "tool_result" && p.toolCallId === AGENT_REPLY_ABORT_TOOL_ID,
        );
        expect(abortPart).toBeDefined();
        if (abortPart !== undefined && abortPart.type === "tool_result") {
            expect(abortPart.isError).toBe(true);
            expect(abortPart.output).toBe("user cancelled");
        }
    });

    test("DM scope → provisional `message` event carries type=direct so the client's DM narrow accepts it", async () => {
        const transport = new StreamingFakeTransport();
        const client = new ZulipClient({
            transport,
            scope: {kind: "dm", userIds: [42, 99]},
        });
        await client.connect();

        const events: ZulipEvent[] = [];
        client.subscribe((e) => events.push(e));

        const handle = client.startAgentReply(
            {kind: "dm", userIds: [42, 99]},
            {author: {fullName: "Agent", avatarUrl: ""}},
        );
        await flushMicrotasks();
        await handle.messageId;
        // Extra microtask flush: emitInitialMessage awaits getCurrentUser
        // before dispatching, so the provisional row needs one more tick
        // to settle after messageId resolves.
        await flushMicrotasks();

        const messageEvent = events.find(
            (e): e is Extract<ZulipEvent, {type: "message"}> => e.type === "message",
        );
        expect(messageEvent).toBeDefined();
        expect(messageEvent?.message.type).toBe("direct");
        if (messageEvent?.message.type === "direct") {
            // Viewer (42) is the sender; only the peer shows up as a
            // recipient so the scope-filter predicate in ZulipClient
            // accepts the provisional row.
            expect(messageEvent.message.senderId).toBe(42);
            const ids = messageEvent.message.recipients.map((r) => r.userId).sort();
            expect(ids).toEqual([99]);
        }
        // The client's isInScope predicate for DM scopes folds in the
        // sender id, so the provisional agent row should land in state
        // even though it didn't include the viewer as a recipient.
        const state = client.getState();
        expect(state.messages.map((m) => m.id)).toContain(1000);
    });
});
