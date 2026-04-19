import {afterEach, beforeEach, describe, expect, test} from "vitest";

import {SnapshotTransport} from "../src/snapshot-transport.ts";

// Guards for SnapshotTransport hostile-input paths. The happy path is
// covered in snapshot-transport.test.ts; this file hardens the two
// externally-influenced surfaces (URL validation + fetched-payload
// parsing) that the production embed relies on to avoid stored-XSS-
// style escalation.

describe("SnapshotTransport — URL validation", () => {
    test("rejects empty URL", () => {
        expect(
            () => new SnapshotTransport({url: "", scope: {channel: "c"}}),
        ).toThrow(/empty/);
    });

    test("rejects whitespace-only URL", () => {
        expect(
            () => new SnapshotTransport({url: "   \t\n  ", scope: {channel: "c"}}),
        ).toThrow(/empty/);
    });

    test("rejects vbscript: scheme", () => {
        expect(
            () =>
                new SnapshotTransport({
                    url: "vbscript:MsgBox(1)",
                    scope: {channel: "c"},
                }),
        ).toThrow();
    });

    test("rejects blob: scheme (could outlive container)", () => {
        expect(
            () =>
                new SnapshotTransport({
                    url: "blob:https://example.com/abc",
                    scope: {channel: "c"},
                }),
        ).toThrow();
    });

    test("rejects data: with JSON payload (no fetch-to-inline shortcut)", () => {
        // The inline `data` option exists for this purpose; allowing
        // data: URLs at the url boundary would let an attacker smuggle
        // a synthetic snapshot past any CSP that restricts fetch hosts.
        expect(
            () =>
                new SnapshotTransport({
                    url: "data:application/json,{\"version\":1}",
                    scope: {channel: "c"},
                }),
        ).toThrow();
    });

    test("accepts absolute http and https URLs", () => {
        expect(
            () =>
                new SnapshotTransport({
                    url: "http://localhost:4000/s.json",
                    scope: {channel: "c"},
                }),
        ).not.toThrow();
        expect(
            () =>
                new SnapshotTransport({
                    url: "https://cdn.example/s.json",
                    scope: {channel: "c"},
                }),
        ).not.toThrow();
    });

    test("accepts relative URLs", () => {
        expect(
            () =>
                new SnapshotTransport({
                    url: "/snapshots/a.json",
                    scope: {channel: "c"},
                }),
        ).not.toThrow();
        expect(
            () =>
                new SnapshotTransport({
                    url: "snapshots/a.json",
                    scope: {channel: "c"},
                }),
        ).not.toThrow();
    });
});

describe("SnapshotTransport — payload validation", () => {
    let originalFetch: typeof fetch;
    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("rejects snapshot with wrong version literal", async () => {
        globalThis.fetch = (async () =>
            new Response(
                JSON.stringify({
                    version: 2,
                    generatedAt: 0,
                    server: "x",
                    channel: "c",
                    messages: [],
                }),
                {status: 200, headers: {"Content-Type": "application/json"}},
            )) as unknown as typeof fetch;

        const transport = new SnapshotTransport({
            url: "https://example.com/s.json",
            scope: {channel: "c"},
        });
        await expect(transport.connect(() => {})).rejects.toThrow(/Invalid snapshot/);
    });

    test("rejects snapshot where message.content is not a string", async () => {
        globalThis.fetch = (async () =>
            new Response(
                JSON.stringify({
                    version: 1,
                    generatedAt: 0,
                    server: "x",
                    channel: "c",
                    messages: [
                        {
                            id: 1,
                            senderId: 1,
                            senderFullName: "a",
                            senderEmail: "a@x",
                            avatarUrl: "",
                            timestamp: 0,
                            // hostile: object instead of string would
                            // bypass string-coercion assumptions
                            // downstream if parseSnapshot didn't block it.
                            content: {evil: "<img onerror=alert(1)>"},
                            contentIsHtml: true,
                            type: "channel",
                            channelName: "c",
                            reactions: [],
                        },
                    ],
                }),
                {status: 200, headers: {"Content-Type": "application/json"}},
            )) as unknown as typeof fetch;

        const transport = new SnapshotTransport({
            url: "https://example.com/s.json",
            scope: {channel: "c"},
        });
        await expect(transport.connect(() => {})).rejects.toThrow(/Invalid snapshot/);
    });

    test("rejects snapshot with missing 'messages' array", async () => {
        globalThis.fetch = (async () =>
            new Response(
                JSON.stringify({
                    version: 1,
                    generatedAt: 0,
                    server: "x",
                    channel: "c",
                }),
                {status: 200, headers: {"Content-Type": "application/json"}},
            )) as unknown as typeof fetch;

        const transport = new SnapshotTransport({
            url: "https://example.com/s.json",
            scope: {channel: "c"},
        });
        await expect(transport.connect(() => {})).rejects.toThrow(/Invalid snapshot/);
    });

    test("surfaces HTTP errors from fetch", async () => {
        globalThis.fetch = (async () =>
            new Response("forbidden", {status: 403})) as unknown as typeof fetch;

        const transport = new SnapshotTransport({
            url: "https://example.com/s.json",
            scope: {channel: "c"},
        });
        await expect(transport.connect(() => {})).rejects.toThrow(/403/);
    });

    test("emits connection=error event before throwing on connect failure", async () => {
        globalThis.fetch = (async () =>
            new Response("nope", {status: 500})) as unknown as typeof fetch;

        const transport = new SnapshotTransport({
            url: "https://example.com/s.json",
            scope: {channel: "c"},
        });
        const statuses: string[] = [];
        const errors: string[] = [];
        await expect(
            transport.connect((e) => {
                if (e.type === "connection") statuses.push(e.status);
                if (e.type === "error") errors.push(e.error);
            }),
        ).rejects.toThrow();
        expect(statuses).toContain("error");
        expect(errors.length).toBeGreaterThan(0);
    });

    test("sendTyping is a no-op (does not reject) in snapshot mode", async () => {
        // The composer is hidden in snapshot mode but an embedder who
        // forgot the read-only attribute shouldn't see rejected-promise
        // noise from debounced typing pings.
        const transport = new SnapshotTransport({
            url: "unused://",
            scope: {channel: "c"},
            data: {
                version: 1,
                generatedAt: 0,
                server: "x",
                channel: "c",
                topic: undefined,
                messages: [],
            },
        });
        await transport.connect(() => {});
        await expect(transport.sendTyping("start", {channel: "c"})).resolves.toBeUndefined();
        await expect(transport.sendTyping("stop", {channel: "c"})).resolves.toBeUndefined();
    });

    test("getCurrentUserId is undefined (anonymous snapshot viewer)", async () => {
        const transport = new SnapshotTransport({
            url: "unused://",
            scope: {channel: "c"},
            data: {
                version: 1,
                generatedAt: 0,
                server: "x",
                channel: "c",
                topic: undefined,
                messages: [],
            },
        });
        await transport.connect(() => {});
        expect(transport.getCurrentUserId()).toBeUndefined();
    });
});
