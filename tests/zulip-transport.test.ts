import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import {ZulipTransport} from "../src/zulip-transport.ts";
import type {ZulipEvent} from "../src/types.ts";

type FetchArgs = [string, RequestInit | undefined];

type Route = {
    match: (url: string, init: RequestInit | undefined) => boolean;
    handler: (url: string, init: RequestInit | undefined) => Promise<Response> | Response;
};

// Park on a request until its signal fires. Used as the default for the
// long-poll GET /events so close()'s AbortController cleanly rejects it
// with AbortError. Requests without a signal (like the DELETE /events
// teardown call) resolve instantly with an empty body.
function hangOnSignal(init: RequestInit | undefined): Promise<Response> {
    const signal = init?.signal;
    if (!signal) {
        return Promise.resolve(new Response("{}", {status: 200}));
    }
    return new Promise<Response>((_resolve, reject) => {
        if (signal.aborted) {
            reject(Object.assign(new Error("aborted"), {name: "AbortError"}));
            return;
        }
        signal.addEventListener(
            "abort",
            () =>
                reject(
                    Object.assign(new Error("aborted"), {
                        name: "AbortError",
                    }),
                ),
            {once: true},
        );
    });
}

function makeRoutedFetch(routes: Route[]): {
    fetch: typeof fetch;
    calls: FetchArgs[];
} {
    const calls: FetchArgs[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit): Promise<Response> => {
        calls.push([url, init]);
        for (const route of routes) {
            if (route.match(url, init)) return route.handler(url, init);
        }
        return hangOnSignal(init);
    }) as unknown as typeof fetch;
    return {fetch: fetchImpl, calls};
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {"Content-Type": "application/json"},
    });
}

// Returns a handler that serves `first` once, then parks subsequent
// calls on the abort signal so close() cleanly unwinds the poll loop
// without spin-looping through synthetic empty responses (which starves
// setTimeout and makes the test time out).
function firstThenHang(first: unknown): Route["handler"] {
    let served = false;
    return (_url, init) => {
        if (!served) {
            served = true;
            return jsonResponse(first);
        }
        return hangOnSignal(init);
    };
}

describe("ZulipTransport", () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    test("narrow builder sends legacy 'stream' operator to /register", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/register"),
                handler: () => jsonResponse({queue_id: "q1", last_event_id: 0}),
            },
            {
                match: (url) => url.includes("/api/v1/users/me"),
                handler: () => jsonResponse({user_id: 42}),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const transport = new ZulipTransport({
            serverUrl: "https://zulip.example",
            email: "bot@x",
            apiKey: "k",
            scope: {channel: "general", topic: "hello"},
        });
        const events: ZulipEvent[] = [];
        await transport.connect((e) => events.push(e));
        await transport.close();

        const registerCall = routed.calls.find(([url]) => url.includes("/api/v1/register"));
        expect(registerCall).toBeDefined();
        const [, init] = registerCall!;
        const body = new URLSearchParams(init!.body as string);
        const narrow = JSON.parse(body.get("narrow")!) as Array<[string, string]>;
        expect(narrow).toEqual([
            ["stream", "general"],
            ["topic", "hello"],
        ]);
        expect(body.get("apply_markdown")).toBe("true");
    });

    test("surfaces Zulip error 'msg' field on non-2xx register", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/register"),
                handler: () =>
                    jsonResponse(
                        {
                            result: "error",
                            msg: "Invalid narrow operator: foo",
                            code: "BAD_REQUEST",
                        },
                        400,
                    ),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const transport = new ZulipTransport({
            serverUrl: "https://zulip.example",
            email: "bot@x",
            apiKey: "k",
            scope: {channel: "general"},
        });
        const events: ZulipEvent[] = [];
        await expect(transport.connect((e) => events.push(e))).rejects.toThrow(
            /Invalid narrow operator: foo/,
        );
        const errorEvents = events.filter((e) => e.type === "error");
        expect(errorEvents.length).toBeGreaterThan(0);
    });

    test("scope guard drops update_message events for unseen messages", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/register"),
                handler: () => jsonResponse({queue_id: "q1", last_event_id: 0}),
            },
            {
                match: (url) => url.includes("/api/v1/users/me"),
                handler: () => jsonResponse({user_id: 42}),
            },
            {
                match: (url) => url.includes("/api/v1/events"),
                handler: firstThenHang({
                    events: [
                        {
                            id: 1,
                            type: "update_message",
                            message_id: 9999,
                            rendered_content: "<p>evil</p>",
                        },
                    ],
                }),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const transport = new ZulipTransport({
            serverUrl: "https://zulip.example",
            email: "bot@x",
            apiKey: "k",
            scope: {channel: "general"},
        });
        const events: ZulipEvent[] = [];
        await transport.connect((e) => events.push(e));
        // Give the poll loop a chance to process the first (and only)
        // events batch before we shut down.
        await new Promise((r) => setTimeout(r, 20));
        await transport.close();

        const updates = events.filter((e) => e.type === "message-update");
        expect(updates).toHaveLength(0);
    });

    test("reaction event composes bucket state across add and remove ops", async () => {
        // getMessages must run before the events poll receives its
        // reaction batch, so we gate the /events route on a flag the
        // messages handler flips. Without that ordering the poll fires
        // before reactionState knows about msg 100 and the scope guard
        // drops every reaction event.
        let messagesFetched = false;
        let firstEventsServed = false;
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/register"),
                handler: () => jsonResponse({queue_id: "q1", last_event_id: 0}),
            },
            {
                match: (url) => url.includes("/api/v1/users/me"),
                handler: () => jsonResponse({user_id: 42}),
            },
            {
                match: (url, init) =>
                    url.includes("/api/v1/messages") && (init?.method ?? "GET") === "GET",
                handler: () => {
                    messagesFetched = true;
                    return jsonResponse({
                        messages: [
                            {
                                id: 100,
                                sender_id: 1,
                                sender_full_name: "A",
                                sender_email: "a@x",
                                avatar_url: null,
                                timestamp: 0,
                                content: "hi",
                                type: "stream",
                                display_recipient: "general",
                                subject: "t",
                                reactions: [],
                            },
                        ],
                        found_oldest: true,
                    });
                },
            },
            {
                match: (url) => url.includes("/api/v1/events"),
                handler: async (_url, init) => {
                    if (firstEventsServed) return hangOnSignal(init);
                    // Wait until getMessages has primed the reaction
                    // cache, abort-aware so close() can unwind this
                    // handler too.
                    while (!messagesFetched) {
                        if (init?.signal?.aborted) return hangOnSignal(init);
                        await new Promise((r) => setTimeout(r, 5));
                    }
                    firstEventsServed = true;
                    return jsonResponse({
                        events: [
                            {
                                id: 1,
                                type: "reaction",
                                op: "add",
                                message_id: 100,
                                emoji_name: "tada",
                                user_id: 7,
                            },
                            {
                                id: 2,
                                type: "reaction",
                                op: "add",
                                message_id: 100,
                                emoji_name: "tada",
                                user_id: 8,
                            },
                            {
                                id: 3,
                                type: "reaction",
                                op: "remove",
                                message_id: 100,
                                emoji_name: "tada",
                                user_id: 7,
                            },
                        ],
                    });
                },
            },
        ]);
        globalThis.fetch = routed.fetch;

        const transport = new ZulipTransport({
            serverUrl: "https://zulip.example",
            email: "bot@x",
            apiKey: "k",
            scope: {channel: "general"},
        });
        const events: ZulipEvent[] = [];
        await transport.connect((e) => events.push(e));
        await transport.getMessages({channel: "general"});
        // Wait long enough for: poll's current in-flight fetch to reject
        // with hangOnSignal re-fire after messagesFetched flips, drain,
        // and schedule a new poll request — this one returns the event
        // batch.
        await new Promise((r) => setTimeout(r, 30));
        await transport.close();

        const reactionEvents = events.filter((e) => e.type === "reaction");
        expect(reactionEvents).toHaveLength(3);
        const last = reactionEvents.at(-1);
        if (last?.type !== "reaction") throw new Error("expected reaction");
        expect(last.reactions).toEqual([{emoji: "tada", count: 1, userIds: [8]}]);
    });

    test("constructor accepts non-ASCII credentials without throwing", () => {
        // btoa() throws InvalidCharacterError on non-Latin1 input, so the
        // Basic-auth header build must route through TextEncoder first.
        expect(
            () =>
                new ZulipTransport({
                    serverUrl: "https://zulip.example",
                    email: "тест@x",
                    apiKey: "ключ",
                    scope: {channel: "general"},
                }),
        ).not.toThrow();
    });

    test("rejects non-http(s) server URLs", () => {
        expect(
            () =>
                new ZulipTransport({
                    serverUrl: "javascript:alert(1)",
                    email: "a@x",
                    apiKey: "k",
                    scope: {channel: "general"},
                }),
        ).toThrow();
        expect(
            () =>
                new ZulipTransport({
                    serverUrl: "file:///etc/passwd",
                    email: "a@x",
                    apiKey: "k",
                    scope: {channel: "general"},
                }),
        ).toThrow();
    });
});
