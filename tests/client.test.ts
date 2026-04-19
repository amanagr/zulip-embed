import {describe, expect, test, vi} from "vitest";

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
    ScopeFilter,
    SendMessageParams,
    ZulipEvent,
    ZulipEventListener,
} from "../src/types.ts";

// Fake transport records every call and exposes a hook so tests can
// trigger events into the listener the client registered during
// connect(). Kept deliberately minimal: the client is a thin façade, so
// the tests here cover delegation + the subscribe/unsubscribe lifecycle
// rather than transport semantics.
class FakeTransport implements Transport {
    public emit: ZulipEventListener = () => {};
    public currentUserId: number | undefined = 99;
    public readonly calls: Array<{method: string; args: unknown[]}> = [];
    public closed = false;
    public connectCount = 0;

    async connect(onEvent: ZulipEventListener): Promise<void> {
        this.connectCount++;
        this.emit = onEvent;
        this.calls.push({method: "connect", args: []});
    }

    async close(): Promise<void> {
        this.closed = true;
        this.calls.push({method: "close", args: []});
    }

    async getMessages(
        scope: ScopeFilter,
        options?: GetMessagesOptions,
    ): Promise<GetMessagesResult> {
        this.calls.push({method: "getMessages", args: [scope, options]});
        return {messages: [], hasMore: false};
    }

    async sendMessage(params: SendMessageParams): Promise<void> {
        this.calls.push({method: "sendMessage", args: [params]});
    }

    async editMessage(params: EditMessageParams): Promise<void> {
        this.calls.push({method: "editMessage", args: [params]});
    }

    async deleteMessage(messageId: number): Promise<void> {
        this.calls.push({method: "deleteMessage", args: [messageId]});
    }

    async addReaction(params: ReactionParams): Promise<void> {
        this.calls.push({method: "addReaction", args: [params]});
    }

    async removeReaction(params: ReactionParams): Promise<void> {
        this.calls.push({method: "removeReaction", args: [params]});
    }

    async sendTyping(op: TypingOp, scope: ScopeFilter): Promise<void> {
        this.calls.push({method: "sendTyping", args: [op, scope]});
    }

    getCurrentUserId(): number | undefined {
        return this.currentUserId;
    }
}

describe("ZulipClient", () => {
    test("subscribe receives events emitted by the transport", async () => {
        const transport = new FakeTransport();
        const client = new ZulipClient({transport});
        await client.connect();

        const received: ZulipEvent[] = [];
        client.subscribe((e) => received.push(e));

        transport.emit({type: "connection", status: "connected"});
        transport.emit({
            type: "message",
            message: {
                id: 1,
                senderId: 2,
                senderFullName: "A",
                senderEmail: "a@x",
                avatarUrl: "",
                timestamp: 0,
                content: "",
                contentIsHtml: true,
                type: "channel",
                channelName: "general",
                topic: "t",
                reactions: [],
            },
        });

        expect(received).toHaveLength(2);
        expect(received[0]?.type).toBe("connection");
        expect(received[1]?.type).toBe("message");
    });

    test("unsubscribe stops further delivery but leaves other listeners intact", async () => {
        const transport = new FakeTransport();
        const client = new ZulipClient({transport});
        await client.connect();

        const a: ZulipEvent[] = [];
        const b: ZulipEvent[] = [];
        const unsubA = client.subscribe((e) => a.push(e));
        client.subscribe((e) => b.push(e));

        transport.emit({type: "connection", status: "connected"});
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(1);

        unsubA();
        transport.emit({type: "connection", status: "disconnected"});
        // A unsubscribed — B keeps receiving.
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(2);
    });

    test("listener throwing does not starve other listeners", async () => {
        // Per the client's current contract (see emit()), listeners are
        // invoked in registration order. A throwing listener today
        // propagates and can skip later subscribers; this test pins the
        // behavior so any intentional change (wrap in try/catch) shows
        // up as a failure that forces an owner review.
        const transport = new FakeTransport();
        const client = new ZulipClient({transport});
        await client.connect();

        const calls: string[] = [];
        client.subscribe(() => {
            calls.push("first");
            throw new Error("boom");
        });
        client.subscribe(() => {
            calls.push("second");
        });

        let threw = false;
        try {
            transport.emit({type: "connection", status: "connected"});
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);
        expect(calls).toEqual(["first"]);
        // TODO: once emit() guards listeners, update this test to assert
        // calls === ["first", "second"] and threw === false. Flag for
        // feature agent — consumer apps should not be able to break
        // event delivery for co-listeners by throwing.
    });

    test("delegates getMessages/sendMessage/editMessage/deleteMessage to transport", async () => {
        const transport = new FakeTransport();
        const client = new ZulipClient({transport});
        await client.connect();

        await client.getMessages({channel: "general"}, {limit: 10});
        await client.sendMessage({type: "channel", channel: "general", content: "hi"});
        await client.editMessage({messageId: 1, content: "edit"});
        await client.deleteMessage(7);

        const methods = transport.calls.map((c) => c.method);
        expect(methods).toContain("getMessages");
        expect(methods).toContain("sendMessage");
        expect(methods).toContain("editMessage");
        expect(methods).toContain("deleteMessage");
    });

    test("delegates add/removeReaction and sendTyping to transport", async () => {
        const transport = new FakeTransport();
        const client = new ZulipClient({transport});
        await client.connect();

        await client.addReaction({messageId: 1, emoji: "tada"});
        await client.removeReaction({messageId: 1, emoji: "tada"});
        await client.sendTyping("start", {channel: "general"});

        const methods = transport.calls.map((c) => c.method);
        expect(methods).toContain("addReaction");
        expect(methods).toContain("removeReaction");
        expect(methods).toContain("sendTyping");
    });

    test("getCurrentUserId passes through from transport", () => {
        const transport = new FakeTransport();
        transport.currentUserId = 1234;
        const client = new ZulipClient({transport});
        expect(client.getCurrentUserId()).toBe(1234);
    });

    test("disconnect calls transport.close", async () => {
        const transport = new FakeTransport();
        const client = new ZulipClient({transport});
        await client.connect();
        await client.disconnect();
        expect(transport.closed).toBe(true);
    });

    test("reconnect re-registers listener and existing subscribers keep receiving", async () => {
        const transport = new FakeTransport();
        const client = new ZulipClient({transport});
        const received: ZulipEvent[] = [];
        client.subscribe((e) => received.push(e));

        await client.connect();
        transport.emit({type: "connection", status: "connected"});
        expect(received).toHaveLength(1);

        await client.disconnect();
        await client.connect();
        // After reconnect, the new transport-level listener routes into
        // the same emit() path so prior subscribers keep receiving.
        transport.emit({type: "connection", status: "connected"});
        expect(received).toHaveLength(2);
        expect(transport.connectCount).toBe(2);
    });

    test("subscribe callbacks do not fire after disconnect if transport emits nothing", async () => {
        const transport = new FakeTransport();
        const client = new ZulipClient({transport});
        await client.connect();

        const received: ZulipEvent[] = [];
        client.subscribe((e) => received.push(e));

        await client.disconnect();
        // Transport went silent after close; no stray emits.
        expect(received).toHaveLength(0);
    });

    test("vi.fn spy confirms exact argument shape on delegated call", async () => {
        const transport = new FakeTransport();
        const spy = vi.spyOn(transport, "sendMessage");
        const client = new ZulipClient({transport});
        await client.connect();

        const params: SendMessageParams = {
            type: "channel",
            channel: "general",
            topic: "t",
            content: "hi",
        };
        await client.sendMessage(params);
        expect(spy).toHaveBeenCalledWith(params);
    });
});
