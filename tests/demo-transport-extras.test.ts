import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import {DemoTransport} from "../src/demo-transport.ts";
import type {ZulipEvent} from "../src/types.ts";

// Covers the demo transport surfaces not exercised by the primary or
// persistence suites: listChannels/listTopics (now part of Transport),
// auto-reply content variations, and the sendTyping no-op contract.

describe("DemoTransport.listChannels", () => {
    test("returns a single channel matching the configured scope", async () => {
        const t = new DemoTransport({scope: {channel: "product"}});
        const channels = await t.listChannels();
        expect(channels).toHaveLength(1);
        expect(channels[0]?.name).toBe("product");
        // Demo channel is pinned so the badge + pin indicator render on
        // first paint in channel-list stories without extra wiring.
        expect(channels[0]?.pinToTop).toBe(true);
    });

    test("listChannels reflects the scope passed to the constructor", async () => {
        const a = new DemoTransport({scope: {channel: "alpha"}});
        const b = new DemoTransport({scope: {channel: "beta"}});
        const [ca] = await a.listChannels();
        const [cb] = await b.listChannels();
        expect(ca?.name).toBe("alpha");
        expect(cb?.name).toBe("beta");
    });
});

describe("DemoTransport.listTopics", () => {
    test("returns distinct topics in the configured channel, newest-first", async () => {
        const t = new DemoTransport({scope: {channel: "general"}});
        const topics = await t.listTopics("general");
        expect(topics.length).toBeGreaterThan(0);
        // Newest-first means maxMessageId descends.
        for (let i = 1; i < topics.length; i++) {
            expect(topics[i - 1]!.maxMessageId).toBeGreaterThan(topics[i]!.maxMessageId);
        }
        // No duplicates.
        const names = topics.map((t) => t.name);
        expect(new Set(names).size).toBe(names.length);
    });

    test("returns an empty list for an unknown channel", async () => {
        const t = new DemoTransport({scope: {channel: "general"}});
        const topics = await t.listTopics("does-not-exist");
        expect(topics).toEqual([]);
    });

    test("picks up new topics once a message is sent to one", async () => {
        const t = new DemoTransport({scope: {channel: "general"}});
        await t.connect(() => {});
        const before = await t.listTopics("general");
        const hadBrandNew = before.some((x) => x.name === "brand-new-topic");
        expect(hadBrandNew).toBe(false);

        await t.sendMessage({
            type: "channel",
            channel: "general",
            topic: "brand-new-topic",
            content: "first",
        });
        const after = await t.listTopics("general");
        expect(after.some((x) => x.name === "brand-new-topic")).toBe(true);
        // Newest-first: because the new send gets the highest id, the new
        // topic should be at the top of the list.
        expect(after[0]?.name).toBe("brand-new-topic");
    });
});

describe("DemoTransport auto-reply variations", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test("question-mark prompts produce the 'good question' reply", async () => {
        const events: ZulipEvent[] = [];
        const t = new DemoTransport({
            scope: {channel: "general"},
            autoReply: true,
            autoReplyDelayMs: 50,
        });
        await t.connect((e) => events.push(e));
        await t.sendMessage({type: "channel", channel: "general", content: "is this working?"});
        vi.advanceTimersByTime(60);

        const reply = events
            .filter((e): e is Extract<ZulipEvent, {type: "message"}> => e.type === "message")
            .at(-1);
        expect(reply?.message.content).toContain("Good question");
    });

    test("empty/whitespace prompts produce 'Got it.'", async () => {
        const events: ZulipEvent[] = [];
        const t = new DemoTransport({
            scope: {channel: "general"},
            autoReply: true,
            autoReplyDelayMs: 50,
        });
        await t.connect((e) => events.push(e));
        await t.sendMessage({type: "channel", channel: "general", content: "   "});
        vi.advanceTimersByTime(60);

        const reply = events
            .filter((e): e is Extract<ZulipEvent, {type: "message"}> => e.type === "message")
            .at(-1);
        expect(reply?.message.content).toBe("Got it.");
    });

    test("declarative prompts produce an 'Echo: ...' reply", async () => {
        const events: ZulipEvent[] = [];
        const t = new DemoTransport({
            scope: {channel: "general"},
            autoReply: true,
            autoReplyDelayMs: 50,
        });
        await t.connect((e) => events.push(e));
        await t.sendMessage({type: "channel", channel: "general", content: "hello there"});
        vi.advanceTimersByTime(60);

        const reply = events
            .filter((e): e is Extract<ZulipEvent, {type: "message"}> => e.type === "message")
            .at(-1);
        expect(reply?.message.content).toBe("Echo: hello there");
    });

    test("auto-reply keeps the trigger's channel/topic so it lands in the same thread", async () => {
        const events: ZulipEvent[] = [];
        const t = new DemoTransport({
            scope: {channel: "general"},
            autoReply: true,
            autoReplyDelayMs: 10,
        });
        await t.connect((e) => events.push(e));
        await t.sendMessage({
            type: "channel",
            channel: "general",
            topic: "my-topic",
            content: "hi",
        });
        vi.advanceTimersByTime(15);

        const reply = events
            .filter((e): e is Extract<ZulipEvent, {type: "message"}> => e.type === "message")
            .at(-1);
        expect(reply?.message.channelName).toBe("general");
        expect(reply?.message.topic).toBe("my-topic");
    });
});

describe("DemoTransport.sendTyping", () => {
    test("start schedules a faux peer-typing event after a debounce", async () => {
        // Demo parity: the demo transport fakes a teammate typing back so
        // consumers can see the indicator animate. The event is debounced
        // so rapid start/stop doesn't flicker. Pin the timing contract
        // (~400ms) so a refactor that removes the debounce shows up.
        vi.useFakeTimers();
        try {
            const events: ZulipEvent[] = [];
            const t = new DemoTransport({scope: {channel: "general"}});
            await t.connect((e) => events.push(e));
            await t.sendTyping("start", {channel: "general"});

            // Before debounce: no typing event yet.
            expect(events.filter((e) => e.type === "typing")).toHaveLength(0);
            vi.advanceTimersByTime(500);
            // After debounce: one typing event with the faux bot.
            const typing = events.filter((e): e is Extract<ZulipEvent, {type: "typing"}> =>
                e.type === "typing",
            );
            expect(typing).toHaveLength(1);
            expect(typing[0]?.users.map((u) => u.fullName)).toEqual(["Zulip Bot"]);
        } finally {
            vi.useRealTimers();
        }
    });

    test("stop cancels a pending start and emits an empty typing event", async () => {
        vi.useFakeTimers();
        try {
            const events: ZulipEvent[] = [];
            const t = new DemoTransport({scope: {channel: "general"}});
            await t.connect((e) => events.push(e));
            await t.sendTyping("start", {channel: "general"});
            await t.sendTyping("stop", {channel: "general"});
            // Stop clears the faux bot synchronously by emitting users: [].
            const typing = events.filter((e): e is Extract<ZulipEvent, {type: "typing"}> =>
                e.type === "typing",
            );
            expect(typing).toHaveLength(1);
            expect(typing[0]?.users).toEqual([]);

            // And the pending start must not fire after the stop.
            vi.advanceTimersByTime(1000);
            const finalTyping = events.filter((e) => e.type === "typing");
            expect(finalTyping).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    test("sendTyping on a closed transport is a silent no-op", async () => {
        const events: ZulipEvent[] = [];
        const t = new DemoTransport({scope: {channel: "general"}});
        await t.connect((e) => events.push(e));
        await t.close();
        const before = events.length;
        await expect(t.sendTyping("start", {channel: "general"})).resolves.toBeUndefined();
        await expect(t.sendTyping("stop", {channel: "general"})).resolves.toBeUndefined();
        expect(events.length).toBe(before);
    });
});

describe("DemoTransport constructor options", () => {
    test("autoReply=false omits replies entirely", async () => {
        vi.useFakeTimers();
        try {
            const events: ZulipEvent[] = [];
            const t = new DemoTransport({
                scope: {channel: "general"},
                autoReply: false,
                autoReplyDelayMs: 1,
            });
            await t.connect((e) => events.push(e));
            const before = events.filter((e) => e.type === "message").length;
            await t.sendMessage({type: "channel", channel: "general", content: "ping"});
            vi.advanceTimersByTime(1000);
            const after = events.filter((e) => e.type === "message").length;
            // Exactly one new message event — the guest's send, no bot reply.
            expect(after - before).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    test("getCurrentUserId returns the demo guest viewer id", () => {
        const t = new DemoTransport({scope: {channel: "general"}});
        expect(typeof t.getCurrentUserId()).toBe("number");
    });
});
