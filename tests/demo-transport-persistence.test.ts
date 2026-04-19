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

    test("sendMessage to a non-active channel still appears in history (no filter)", async () => {
        // DemoTransport has no scope filter on getMessages today — the
        // params scope is ignored. Pin this so a future "respect scope
        // in getMessages" change shows up as a regression and forces a
        // conscious decision about the demo behavior.
        const transport = new DemoTransport({
            scope: {channel: "general", topic: "hello"},
            autoReply: false,
        });
        await transport.connect(() => {});
        await transport.sendMessage({
            type: "channel",
            channel: "other-channel",
            content: "stray",
        });
        const page = await transport.getMessages({channel: "general", topic: "hello"});
        // Current behavior: stray message is in the returned list even
        // though the query scope is 'general'. Callers (component) are
        // expected to filter.
        expect(page.messages.some((m) => m.content === "stray")).toBe(true);
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
            transport.editMessage({messageId: 1, content: "nope"}),
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
            transport.editMessage({messageId: otherSender.id, content: "tamper"}),
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
            transport.sendMessage({type: "channel", channel: "general", content: "x"}),
        ).rejects.toThrow(/closed/i);
    });
});
