import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import {DemoTransport} from "../src/demo-transport.ts";
import type {ZulipEvent} from "../src/types.ts";

// DemoTransport is in-memory and scoped to its instance. These tests
// pin the subset of persistence behavior that matters for
// reconnect-style UX: sent messages stay in the in-instance history
// across close + reconnect, reactions toggle cleanly, and
// cross-channel messages are filterable downstream.
describe("DemoTransport — persistence & scope", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test("messages survive close + reconnect on the same instance", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general", topic: "hello"},
            autoReply: false,
        });
        await transport.connect(() => {});
        await transport.sendMessage({
            type: "channel",
            channel: "general",
            topic: "hello",
            content: "persist me",
        });
        const firstPage = await transport.getMessages({channel: "general", topic: "hello"});
        const sentId = firstPage.messages.at(-1)?.id;
        expect(sentId).toBeDefined();

        await transport.close();
        // Reconnect on the same instance — the in-memory log stays
        // intact. (A fresh `new DemoTransport(...)` would re-seed.)
        await transport.connect(() => {});
        const page = await transport.getMessages({channel: "general", topic: "hello"});
        expect(page.messages.find((m) => m.id === sentId)?.content).toBe("persist me");
        await transport.close();
    });

    test("addReaction then removeReaction leaves no bucket behind", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general", topic: "hello"},
            autoReply: false,
        });
        const events: ZulipEvent[] = [];
        await transport.connect((e) => events.push(e));
        const {messages} = await transport.getMessages({channel: "general"});
        const msg = messages[0];
        if (!msg) throw new Error("expected seed");

        await transport.addReaction({messageId: msg.id, emoji: "tada"});
        await transport.removeReaction({messageId: msg.id, emoji: "tada"});

        const reactionEvents = events.filter((e) => e.type === "reaction");
        expect(reactionEvents).toHaveLength(2);
        const last = reactionEvents.at(-1);
        if (last?.type !== "reaction") throw new Error();
        // Bucket should be gone when the last user removes — count 0
        // buckets should not be emitted at all.
        expect(last.reactions.find((r) => r.emoji === "tada")).toBeUndefined();
        await transport.close();
    });

    test("addReaction twice for the same user is idempotent (Set semantics)", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general"},
            autoReply: false,
        });
        const events: ZulipEvent[] = [];
        await transport.connect((e) => events.push(e));
        const {messages} = await transport.getMessages({channel: "general"});
        const msg = messages[0];
        if (!msg) throw new Error("expected seed");

        await transport.addReaction({messageId: msg.id, emoji: "tada"});
        await transport.addReaction({messageId: msg.id, emoji: "tada"});

        const reactionEvents = events.filter((e) => e.type === "reaction");
        const last = reactionEvents.at(-1);
        if (last?.type !== "reaction") throw new Error();
        const tada = last.reactions.find((r) => r.emoji === "tada");
        // Same user adding twice is deduped — count stays at 1 even
        // though two events fired.
        expect(tada?.count).toBe(1);
        await transport.close();
    });

    test("getMessages respects the scope param and hides out-of-scope messages", async () => {
        // As of the 0.8 ScopeFilter widening, DemoTransport filters
        // getMessages by the query scope so a DM narrow doesn't leak
        // channel messages (and vice versa). This pins the new
        // filter-in-demo behavior — the inverse of the pre-0.8 canary
        // that deliberately returned the stray message so callers were
        // forced to filter themselves.
        const transport = new DemoTransport({
            scope: {channel: "general", topic: "hello"},
            autoReply: false,
        });
        await transport.connect(() => {});
        await transport.sendMessage({
            type: "channel",
            channel: "other-channel",
            topic: "",
            content: "stray",
        });
        const page = await transport.getMessages({channel: "general", topic: "hello"});
        // The stray message lives under a different channel, so asking
        // for the 'general/hello' narrow must not return it.
        expect(page.messages.some((m) => m.content === "stray")).toBe(false);
        // But the same message IS persisted — asking for its own narrow
        // surfaces it, which distinguishes "filtered" from "lost".
        const otherPage = await transport.getMessages({channel: "other-channel", topic: ""});
        expect(otherPage.messages.some((m) => m.content === "stray")).toBe(true);
        await transport.close();
    });

    test("read-only mode rejects editMessage and deleteMessage", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general"},
            readOnly: true,
            autoReply: false,
        });
        await transport.connect(() => {});
        await expect(
            transport.editMessage({messageId: 1, kind: "content", content: "nope"}),
        ).rejects.toThrow(/read-only/i);
        await expect(transport.deleteMessage(1)).rejects.toThrow(/read-only/i);
        await transport.close();
    });

    test("editMessage refuses to edit messages from other senders", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general"},
            autoReply: false,
        });
        await transport.connect(() => {});
        const {messages} = await transport.getMessages({channel: "general"});
        // Seeded messages come from bot/teammate senders, not the
        // guest viewer. Editing one should throw.
        const otherSender = messages.find((m) => m.senderEmail !== "you@demo.example");
        if (!otherSender) throw new Error("expected a non-guest seed");
        await expect(
            transport.editMessage({messageId: otherSender.id, kind: "content", content: "tamper"}),
        ).rejects.toThrow(/own messages/i);
        await transport.close();
    });

    test("deleteMessage refuses to delete messages from other senders", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general"},
            autoReply: false,
        });
        await transport.connect(() => {});
        const {messages} = await transport.getMessages({channel: "general"});
        const otherSender = messages.find((m) => m.senderEmail !== "you@demo.example");
        if (!otherSender) throw new Error("expected a non-guest seed");
        await expect(transport.deleteMessage(otherSender.id)).rejects.toThrow(/own messages/i);
        await transport.close();
    });

    test("pagination anchored on the earliest seed returns synthetic older messages", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general", topic: "hello"},
            autoReply: false,
        });
        await transport.connect(() => {});
        const first = await transport.getMessages({channel: "general"});
        const oldestSeed = first.messages.reduce((min, m) => (m.id < min ? m.id : min), Number.MAX_SAFE_INTEGER);

        const older = await transport.getMessages({channel: "general"}, {beforeId: oldestSeed, limit: 5});
        // Synthetic history is produced on demand and has ids strictly
        // less than the anchor.
        expect(older.messages.every((m) => m.id < oldestSeed)).toBe(true);
        await transport.close();
    });

    test("close prevents sendMessage from succeeding", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general"},
            autoReply: false,
        });
        await transport.connect(() => {});
        await transport.close();
        await expect(
            transport.sendMessage({type: "channel", channel: "general", topic: "", content: "x"}),
        ).rejects.toThrow(/closed/i);
    });
});
