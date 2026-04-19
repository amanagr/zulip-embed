import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import {ZulipTransport} from "../src/zulip-transport.ts";

// Cover ZulipTransport.listChannels / listTopics. These power the new
// <zulip-channel-list> and <zulip-topic-list> web components, so pinning
// the wire shape + ordering + the resolved-topic prefix stripping here
// prevents silent regressions on those consumers.

type FetchArgs = [string, RequestInit | undefined];

type Route = {
    match: (url: string, init: RequestInit | undefined) => boolean;
    handler: (url: string, init: RequestInit | undefined) => Promise<Response> | Response;
};

function hangOnSignal(init: RequestInit | undefined): Promise<Response> {
    const signal = init?.signal;
    if (!signal) return Promise.resolve(new Response("{}", {status: 200}));
    return new Promise<Response>((_resolve, reject) => {
        if (signal.aborted) {
            reject(Object.assign(new Error("aborted"), {name: "AbortError"}));
            return;
        }
        signal.addEventListener(
            "abort",
            () =>
                reject(Object.assign(new Error("aborted"), {name: "AbortError"})),
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

function makeTransport(): ZulipTransport {
    return new ZulipTransport({
        serverUrl: "https://zulip.example",
        email: "bot@x",
        apiKey: "k",
        scope: {channel: "general"},
    });
}

describe("ZulipTransport.listChannels", () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    test("maps subscription rows into Channel shape with Zulip snake→camel rename", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/users/me/subscriptions"),
                handler: () =>
                    jsonResponse({
                        subscriptions: [
                            {
                                stream_id: 7,
                                name: "announce",
                                description: "the announcements channel",
                                color: "#112233",
                                pin_to_top: true,
                                is_muted: false,
                            },
                        ],
                    }),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const channels = await makeTransport().listChannels();
        expect(channels).toEqual([
            {
                channelId: 7,
                name: "announce",
                description: "the announcements channel",
                color: "#112233",
                pinToTop: true,
                isMuted: false,
            },
        ]);
    });

    test("sorts pinned first, then alphabetical within each group", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/users/me/subscriptions"),
                handler: () =>
                    jsonResponse({
                        subscriptions: [
                            {stream_id: 1, name: "zebra", pin_to_top: false, is_muted: false},
                            {stream_id: 2, name: "apple", pin_to_top: false, is_muted: false},
                            {stream_id: 3, name: "mango", pin_to_top: true, is_muted: false},
                            {stream_id: 4, name: "banana", pin_to_top: true, is_muted: false},
                        ],
                    }),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const channels = await makeTransport().listChannels();
        expect(channels.map((c) => c.name)).toEqual([
            "banana",
            "mango",
            "apple",
            "zebra",
        ]);
    });

    test("defaults description to empty string when the server omits it", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/users/me/subscriptions"),
                handler: () =>
                    jsonResponse({
                        subscriptions: [
                            {stream_id: 1, name: "general", pin_to_top: false, is_muted: false},
                        ],
                    }),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const channels = await makeTransport().listChannels();
        expect(channels[0]?.description).toBe("");
    });

    test("sends the auth header with the subscriptions GET", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/users/me/subscriptions"),
                handler: () => jsonResponse({subscriptions: []}),
            },
        ]);
        globalThis.fetch = routed.fetch;

        await makeTransport().listChannels();
        const call = routed.calls.find(([url]) =>
            url.includes("/api/v1/users/me/subscriptions"),
        );
        expect(call).toBeDefined();
        const headers = call![1]?.headers as Record<string, string> | Headers | undefined;
        const auth =
            headers instanceof Headers
                ? headers.get("Authorization")
                : (headers as Record<string, string> | undefined)?.["Authorization"];
        expect(auth).toMatch(/^Basic /);
    });
});

describe("ZulipTransport.listTopics", () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    test("resolves channel name to stream_id before fetching topics", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/get_stream_id"),
                handler: () => jsonResponse({stream_id: 42}),
            },
            {
                // The topic-list path includes the stream id — pin that
                // wire shape so a future URL tweak fails loudly here
                // rather than at runtime in the browser.
                match: (url) => url.includes("/api/v1/users/me/42/topics"),
                handler: () =>
                    jsonResponse({
                        topics: [
                            {name: "welcome", max_id: 5},
                            {name: "release notes", max_id: 9},
                        ],
                    }),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const topics = await makeTransport().listTopics("general");
        expect(topics.map((t) => t.name)).toEqual(["welcome", "release notes"]);
        expect(topics[0]?.maxMessageId).toBe(5);
    });

    test("strips the resolved-topic prefix and exposes isResolved=true", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/get_stream_id"),
                handler: () => jsonResponse({stream_id: 42}),
            },
            {
                match: (url) => url.includes("/api/v1/users/me/42/topics"),
                handler: () =>
                    jsonResponse({
                        topics: [
                            // "\u2714 " is the magic prefix Zulip uses for
                            // resolved topics. Consumers should never see it.
                            {name: "\u2714 fixed last week", max_id: 100},
                            {name: "ongoing", max_id: 120},
                        ],
                    }),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const topics = await makeTransport().listTopics("general");
        const fixed = topics.find((t) => t.maxMessageId === 100);
        const ongoing = topics.find((t) => t.maxMessageId === 120);
        expect(fixed?.name).toBe("fixed last week");
        expect(fixed?.isResolved).toBe(true);
        expect(ongoing?.name).toBe("ongoing");
        expect(ongoing?.isResolved).toBe(false);
    });

    test("returns an empty array when the channel cannot be resolved", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/get_stream_id"),
                handler: () =>
                    new Response(JSON.stringify({result: "error", msg: "No such stream"}), {
                        status: 400,
                    }),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const topics = await makeTransport().listTopics("ghost");
        expect(topics).toEqual([]);
    });

    test("caches the resolved stream id across calls for the same channel", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/get_stream_id"),
                handler: () => jsonResponse({stream_id: 42}),
            },
            {
                match: (url) => url.includes("/api/v1/users/me/42/topics"),
                handler: () => jsonResponse({topics: []}),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const transport = makeTransport();
        await transport.listTopics("general");
        await transport.listTopics("general");
        const resolveCalls = routed.calls.filter(([url]) =>
            url.includes("/api/v1/get_stream_id"),
        );
        // Only the first call should hit get_stream_id — the second uses
        // the cached id. Without this cache each list refresh would burn
        // two round-trips instead of one.
        expect(resolveCalls).toHaveLength(1);
    });
});
