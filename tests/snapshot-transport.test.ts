import {describe, expect, test} from "vitest";

import {SnapshotTransport, type SnapshotFile} from "../src/snapshot-transport.ts";
import type {Message, ZulipEvent} from "../src/types.ts";

function fakeMessage(id: number, channel: string, topic: string): Message {
    return {
        id,
        senderId: 1,
        senderFullName: "Test User",
        senderEmail: "test@example.com",
        avatarUrl: "",
        timestamp: 1_700_000_000_000 + id,
        content: `<p>msg ${String(id)}</p>`,
        contentIsHtml: true,
        type: "channel",
        channelName: channel,
        topic,
        reactions: [],
    };
}

function snapshot(messages: Message[]): SnapshotFile {
    return {
        version: 1,
        generatedAt: 1_700_000_000_000,
        server: "https://chat.zulip.org",
        channel: "announce",
        topic: "Zulip updates",
        messages,
    };
}

describe("SnapshotTransport", () => {
    test("serves inline data filtered to scope", async () => {
        const data = snapshot([
            fakeMessage(1, "announce", "Zulip updates"),
            fakeMessage(2, "announce", "other topic"),
            fakeMessage(3, "general", "Zulip updates"),
            fakeMessage(4, "announce", "Zulip updates"),
        ]);
        const transport = new SnapshotTransport({
            url: "unused://",
            scope: {channel: "announce", topic: "Zulip updates"},
            data,
        });
        const events: ZulipEvent[] = [];
        await transport.connect((e) => events.push(e));

        const page = await transport.getMessages({
            channel: "announce",
            topic: "Zulip updates",
        });
        expect(page.messages.map((m) => m.id)).toEqual([1, 4]);
        expect(page.hasMore).toBe(false);
        expect(events[0]).toEqual({type: "connection", status: "connected"});
    });

    test("rejects writes", async () => {
        const transport = new SnapshotTransport({
            url: "unused://",
            scope: {channel: "announce"},
            data: snapshot([]),
        });
        await transport.connect(() => {});
        await expect(
            transport.sendMessage({type: "channel", channel: "announce", content: "hi"}),
        ).rejects.toThrow(/read-only/);
        await expect(transport.addReaction({messageId: 1, emoji: "tada"})).rejects.toThrow(
            /read-only/,
        );
    });

    test("rejects dangerous URL schemes at construction", () => {
        const scope = {channel: "announce", topic: "Zulip updates"};
        expect(() => new SnapshotTransport({url: "javascript:alert(1)", scope})).toThrow();
        expect(() => new SnapshotTransport({url: "data:application/json,{}", scope})).toThrow();
        expect(() => new SnapshotTransport({url: "//evil.tld/x.json", scope})).toThrow(
            /protocol-relative/,
        );
        expect(() => new SnapshotTransport({url: "file:///etc/passwd", scope})).toThrow();
    });

    test("accepts relative and http(s) URLs", () => {
        const scope = {channel: "announce"};
        expect(
            () => new SnapshotTransport({url: "./snapshots/a.json", scope}),
        ).not.toThrow();
        expect(
            () => new SnapshotTransport({url: "https://example.com/a.json", scope}),
        ).not.toThrow();
    });

    test("pagination returns empty on beforeId — snapshots have no backlog", async () => {
        const transport = new SnapshotTransport({
            url: "unused://",
            scope: {channel: "announce", topic: "Zulip updates"},
            data: snapshot([fakeMessage(1, "announce", "Zulip updates")]),
        });
        await transport.connect(() => {});
        const older = await transport.getMessages(
            {channel: "announce"},
            {beforeId: 1},
        );
        expect(older.messages).toEqual([]);
        expect(older.hasMore).toBe(false);
    });
});
