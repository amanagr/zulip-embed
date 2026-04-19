import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import {ZulipTransport} from "../src/zulip-transport.ts";
import type {ZulipEvent} from "../src/types.ts";

type FetchArgs = [string, RequestInit | undefined];

type Route = {
    match: (url: string, init: RequestInit | undefined) => boolean;
    handler: (url: string, init: RequestInit | undefined) => Promise<Response> | Response;
};

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
                    Object.assign(new Error("aborted"), {name: "AbortError"}),
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

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {"Content-Type": "application/json", ...headers},
    });
}

describe("ZulipTransport auth options", () => {
    test("constructor throws when neither {email,apiKey} nor {authToken} is provided", () => {
        expect(
            () =>
                new ZulipTransport({
                    serverUrl: "https://zulip.example",
                    scope: {channel: "general"},
                }),
        ).toThrow(/either \{email, apiKey\} or \{authToken\}/);
    });

    test("constructor throws when both credential paths are provided", () => {
        expect(
            () =>
                new ZulipTransport({
                    serverUrl: "https://zulip.example",
                    scope: {channel: "general"},
                    email: "bot@x",
                    apiKey: "k",
                    authToken: "jwt.signed",
                }),
        ).toThrow(/not both/);
    });

    test("constructor accepts {authToken} alone without throwing", () => {
        expect(
            () =>
                new ZulipTransport({
                    serverUrl: "https://zulip.example",
                    scope: {channel: "general"},
                    authToken: "jwt.signed",
                }),
        ).not.toThrow();
    });
});

describe("ZulipTransport JWT exchange", () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    test("exchanges the JWT for an api_key and uses it on subsequent requests", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/internal/jwt/fetch_api_key"),
                handler: () =>
                    jsonResponse({api_key: "secret-key", email: "resolved@example.com"}),
            },
            {
                match: (url) => url.includes("/api/v1/register"),
                handler: () => jsonResponse({queue_id: "q1", last_event_id: 0}),
            },
            {
                match: (url) => url.includes("/api/v1/users/me"),
                handler: () => jsonResponse({user_id: 42, email: "resolved@example.com", full_name: "R"}),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const transport = new ZulipTransport({
            serverUrl: "https://zulip.example",
            authToken: "jwt.signed.payload",
            scope: {channel: "general"},
        });
        const events: ZulipEvent[] = [];
        await transport.connect((e) => events.push(e));
        await transport.close();

        const jwtCall = routed.calls.find(([url]) =>
            url.includes("/api/internal/jwt/fetch_api_key"),
        );
        expect(jwtCall).toBeDefined();
        const [, jwtInit] = jwtCall!;
        expect(jwtInit?.method).toBe("POST");
        // The JWT goes in the body; Authorization header must NOT carry it.
        const headers = jwtInit?.headers as Record<string, string> | undefined;
        expect(headers?.["Authorization"]).toBeUndefined();
        const body = new URLSearchParams(jwtInit?.body as string);
        expect(body.get("token")).toBe("jwt.signed.payload");

        // Subsequent /register call must use Basic auth with the exchanged
        // email:api_key pair.
        const registerCall = routed.calls.find(([url]) =>
            url.includes("/api/v1/register"),
        );
        const registerHeaders = registerCall?.[1]?.headers as
            | Record<string, string>
            | undefined;
        const expectedAuth =
            "Basic " + btoa("resolved@example.com:secret-key");
        expect(registerHeaders?.["Authorization"]).toBe(expectedAuth);
    });

    test("404 from fetch_api_key surfaces as jwt-not-configured error code", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/internal/jwt/fetch_api_key"),
                handler: () =>
                    new Response("Not found", {
                        status: 404,
                    }),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const transport = new ZulipTransport({
            serverUrl: "https://zulip.example",
            authToken: "jwt.signed",
            scope: {channel: "general"},
        });
        const events: ZulipEvent[] = [];
        await expect(transport.connect((e) => events.push(e))).rejects.toThrow(
            /JWT login is not configured/,
        );
        const errorEvents = events.filter((e) => e.type === "error");
        expect(errorEvents).toHaveLength(1);
        expect(errorEvents[0]).toMatchObject({code: "jwt-not-configured"});
    });

    test("401 from fetch_api_key surfaces as unauthorized error code", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/internal/jwt/fetch_api_key"),
                handler: () =>
                    jsonResponse(
                        {result: "error", msg: "Invalid token"},
                        401,
                    ),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const transport = new ZulipTransport({
            serverUrl: "https://zulip.example",
            authToken: "jwt.bad",
            scope: {channel: "general"},
        });
        const events: ZulipEvent[] = [];
        await expect(transport.connect((e) => events.push(e))).rejects.toThrow();
        const errorEvents = events.filter((e) => e.type === "error");
        expect(errorEvents[0]).toMatchObject({code: "unauthorized"});
    });

    test("malformed fetch_api_key response surfaces as unauthorized", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/internal/jwt/fetch_api_key"),
                handler: () => jsonResponse({missing: "fields"}),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const transport = new ZulipTransport({
            serverUrl: "https://zulip.example",
            authToken: "jwt.signed",
            scope: {channel: "general"},
        });
        const events: ZulipEvent[] = [];
        await expect(transport.connect((e) => events.push(e))).rejects.toThrow(
            /missing api_key or email/,
        );
        const errorEvents = events.filter((e) => e.type === "error");
        expect(errorEvents[0]).toMatchObject({code: "unauthorized"});
    });
});

describe("ZulipTransport error taxonomy", () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    test("401 during /register surfaces as unauthorized", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/register"),
                handler: () =>
                    jsonResponse(
                        {result: "error", msg: "Invalid API key"},
                        401,
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
        await expect(transport.connect((e) => events.push(e))).rejects.toThrow();
        expect(events.find((e) => e.type === "error")).toMatchObject({
            code: "unauthorized",
        });
    });

    test("403 Not subscribed surfaces as channel-not-subscribed", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/register"),
                handler: () =>
                    jsonResponse(
                        {
                            result: "error",
                            msg: "Not subscribed to channel 'secret'",
                            code: "NOT_SUBSCRIBED",
                        },
                        403,
                    ),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const transport = new ZulipTransport({
            serverUrl: "https://zulip.example",
            email: "bot@x",
            apiKey: "k",
            scope: {channel: "secret"},
        });
        const events: ZulipEvent[] = [];
        await expect(transport.connect((e) => events.push(e))).rejects.toThrow();
        expect(events.find((e) => e.type === "error")).toMatchObject({
            code: "channel-not-subscribed",
        });
    });

    test("429 Rate limited parses Retry-After header into retryAfterMs", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/register"),
                handler: () =>
                    jsonResponse(
                        {result: "error", msg: "Too many requests"},
                        429,
                        {"Retry-After": "2"},
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
        await expect(transport.connect((e) => events.push(e))).rejects.toThrow();
        const err = events.find((e) => e.type === "error");
        expect(err).toMatchObject({code: "rate-limited", retryAfterMs: 2000});
    });

    test("network TypeError during /register surfaces as network", async () => {
        const fetchImpl = (async () => {
            throw new TypeError("Failed to fetch");
        }) as unknown as typeof fetch;
        globalThis.fetch = fetchImpl;

        const transport = new ZulipTransport({
            serverUrl: "https://zulip.example",
            email: "bot@x",
            apiKey: "k",
            scope: {channel: "general"},
        });
        const events: ZulipEvent[] = [];
        await expect(transport.connect((e) => events.push(e))).rejects.toThrow();
        expect(events.find((e) => e.type === "error")).toMatchObject({
            code: "network",
        });
    });
});

describe("ZulipTransport reconnecting state", () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    test("pollLoop emits reconnecting ConnectionEvent after a failed events fetch", async () => {
        // /register + /users/me succeed; the first /events call rejects
        // with a network error; every later call hangs on the abort signal
        // so close() can cleanly unwind.
        let eventsCallCount = 0;
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
                handler: (_url, init) => {
                    eventsCallCount += 1;
                    if (eventsCallCount === 1) {
                        return Promise.reject(new TypeError("Failed to fetch"));
                    }
                    return hangOnSignal(init);
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
        // Let the pollLoop iterate: first call rejects → error + reconnecting
        // pair emitted.
        await new Promise((r) => setTimeout(r, 40));
        await transport.close();

        const reconnecting = events.find(
            (e) => e.type === "connection" && e.status === "reconnecting",
        );
        expect(reconnecting).toBeDefined();
        expect(reconnecting).toMatchObject({
            type: "connection",
            status: "reconnecting",
            attempt: 1,
        });
        // delayMs is backoff-derived; assert only that it's a positive number.
        const delay = (reconnecting as {delayMs?: number} | undefined)?.delayMs;
        expect(typeof delay).toBe("number");
        expect(delay).toBeGreaterThan(0);

        // Error event is emitted alongside.
        const errorEvent = events.find((e) => e.type === "error");
        expect(errorEvent).toMatchObject({code: "network"});
    });
});

describe("ZulipTransport whenReady / getCurrentUser", () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    test("getCurrentUser resolves with the full User record after connect", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/register"),
                handler: () => jsonResponse({queue_id: "q1", last_event_id: 0}),
            },
            {
                match: (url) => url.includes("/api/v1/users/me"),
                handler: () =>
                    jsonResponse({
                        user_id: 99,
                        email: "me@example.com",
                        full_name: "Me",
                        avatar_url: "https://cdn.example/me.png",
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
        await transport.connect(() => {});

        const user = await transport.getCurrentUser();
        expect(user).toEqual({
            userId: 99,
            email: "me@example.com",
            fullName: "Me",
            avatarUrl: "https://cdn.example/me.png",
        });

        await transport.close();
    });

    test("getCurrentUser rejects if the transport is closed before /users/me resolves", async () => {
        const routed = makeRoutedFetch([
            {
                match: (url) => url.includes("/api/v1/register"),
                // Hang forever — connect() never completes.
                handler: (_url, init) => hangOnSignal(init),
            },
        ]);
        globalThis.fetch = routed.fetch;

        const transport = new ZulipTransport({
            serverUrl: "https://zulip.example",
            email: "bot@x",
            apiKey: "k",
            scope: {channel: "general"},
        });
        // Fire connect() but don't await — it'll hang on the register call.
        const connectPromise = transport.connect(() => {});
        // Swallow the eventual rejection so the test doesn't flag it as
        // unhandled.
        connectPromise.catch(() => {});
        // Close before /register returns so the user promise must reject.
        await transport.close();
        await expect(transport.getCurrentUser()).rejects.toThrow();
    });
});
