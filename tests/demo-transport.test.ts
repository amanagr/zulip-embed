import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import {DemoTransport} from "../src/demo-transport.ts";
import type {ZulipEvent} from "../src/types.ts";

describe("DemoTransport", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test("seeds initial messages and reports connected", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general", topic: "hello"},
            autoReply: false,
        });
        const events: ZulipEvent[] = [];
        await transport.connect((e) => events.push(e));
        const messages = await transport.getMessages({channel: "general", topic: "hello"});

        expect(messages.length).toBeGreaterThan(0);
        expect(events.at(0)).toEqual({type: "connection", status: "connected"});
        await transport.close();
    });

    test("sendMessage appends and emits a message event", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general", topic: "hello"},
            autoReply: false,
        });
        const received: ZulipEvent[] = [];
        await transport.connect((e) => received.push(e));

        await transport.sendMessage({
            type: "channel",
            channel: "general",
            topic: "hello",
            content: "Hi team",
        });

        const messageEvents = received.filter((e) => e.type === "message");
        expect(messageEvents).toHaveLength(1);
        expect(messageEvents[0]).toMatchObject({
            type: "message",
            message: {content: "Hi team"},
        });
        await transport.close();
    });

    test("autoReply emits a second message after the delay", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general", topic: "hello"},
            autoReply: true,
            autoReplyDelayMs: 500,
        });
        const received: ZulipEvent[] = [];
        await transport.connect((e) => received.push(e));

        await transport.sendMessage({
            type: "channel",
            channel: "general",
            topic: "hello",
            content: "Ping?",
        });
        vi.advanceTimersByTime(500);

        const messageEvents = received.filter((e) => e.type === "message");
        expect(messageEvents).toHaveLength(2);
        expect(messageEvents[1]?.message.senderEmail).toBe("zulip-bot@example.com");
        await transport.close();
    });

    test("close cancels pending auto-replies", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general"},
            autoReply: true,
            autoReplyDelayMs: 500,
        });
        const received: ZulipEvent[] = [];
        await transport.connect((e) => received.push(e));
        await transport.sendMessage({type: "channel", channel: "general", content: "Hello?"});

        await transport.close();
        vi.advanceTimersByTime(1_000);

        const messageEvents = received.filter((e) => e.type === "message");
        expect(messageEvents).toHaveLength(1);
    });
});
