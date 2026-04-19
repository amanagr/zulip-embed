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
                    Object.assign(new Error("aborted"), {
                        name: "AbortError",
                    }),
                ),
            {once: true},
        );
    });
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {"Content-Type": "application/json"},
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

async function makeConnectedTransport(routes: Route[]): Promise<{
    transport: ZulipTransport;
    calls: FetchArgs[];
    events: ZulipEvent[];
}> {
    const baseRoutes: Route[] = [
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
            handler: (_url, init) => hangOnSignal(init),
        },
    ];
    const routed = makeRoutedFetch([...routes, ...baseRoutes]);
    globalThis.fetch = routed.fetch;
    const transport = new ZulipTransport({
        serverUrl: "https://zulip.example",
        email: "bot@x",
        apiKey: "k",
        scope: {channel: "general"},
    });
    const events: ZulipEvent[] = [];
    await transport.connect((e) => events.push(e));
    return {transport, calls: routed.calls, events};
}

describe("ZulipTransport — mutations", () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    test("sendMessage for channel uses legacy 'stream' type and correct 'to' field", async () => {
        // Wire format invariant: Zulip < 9 rejects type=channel on
        // /api/v1/messages. The embed hardcodes type=stream to support
        // every server version. This test pins that invariant.
        const {transport, calls} = await makeConnectedTransport([
            {
                match: (url, init) =>
                    url.includes("/api/v1/messages") && init?.method === "POST",
                handler: () => jsonResponse({id: 7}),
            },
        ]);

        await transport.sendMessage({
            type: "channel",
            channel: "general",
            topic: "hello",
            content: "hi",
        });

        const postCall = calls.find(
            ([url, init]) => url.includes("/api/v1/messages") && init?.method === "POST",
        );
        expect(postCall).toBeDefined();
        const body = new URLSearchParams(postCall![1]!.body as string);
        expect(body.get("type")).toBe("stream");
        expect(body.get("to")).toBe("general");
        expect(body.get("topic")).toBe("hello");
        expect(body.get("content")).toBe("hi");
        await transport.close();
    });

    test("sendMessage for direct uses JSON-encoded recipients list", async () => {
        const {transport, calls} = await makeConnectedTransport([
            {
                match: (url, init) =>
                    url.includes("/api/v1/messages") && init?.method === "POST",
                handler: () => jsonResponse({id: 7}),
            },
        ]);

        await transport.sendMessage({
            type: "direct",
            recipients: ["a@x", "b@x"],
            content: "hi",
        });

        const postCall = calls.find(
            ([url, init]) => url.includes("/api/v1/messages") && init?.method === "POST",
        );
        const body = new URLSearchParams(postCall![1]!.body as string);
        // Wire value is "private" — legacy form Zulip < 9 requires. See
        // CLAUDE.md "wire format is the one exception."
        expect(body.get("type")).toBe("private");
        expect(JSON.parse(body.get("to")!)).toEqual(["a@x", "b@x"]);
        await transport.close();
    });

    test("editMessage with both content and topic posts PATCH with both fields", async () => {
        const {transport, calls} = await makeConnectedTransport([
            {
                match: (url, init) =>
                    /\/api\/v1\/messages\/\d+/.test(url) && init?.method === "PATCH",
                handler: () => jsonResponse({}),
            },
        ]);

        await transport.editMessage({
            messageId: 42,
            kind: "both",
            content: "new",
            topic: "renamed",
        });

        const patchCall = calls.find(
            ([url, init]) =>
                /\/api\/v1\/messages\/42/.test(url) && init?.method === "PATCH",
        );
        expect(patchCall).toBeDefined();
        const body = new URLSearchParams(patchCall![1]!.body as string);
        expect(body.get("content")).toBe("new");
        expect(body.get("topic")).toBe("renamed");
        await transport.close();
    });

    test("deleteMessage issues DELETE to /api/v1/messages/{id}", async () => {
        const {transport, calls} = await makeConnectedTransport([
            {
                match: (url, init) =>
                    /\/api\/v1\/messages\/99/.test(url) && init?.method === "DELETE",
                handler: () => jsonResponse({}),
            },
        ]);

        await transport.deleteMessage(99);

        const deleteCall = calls.find(
            ([url, init]) =>
                /\/api\/v1\/messages\/99/.test(url) && init?.method === "DELETE",
        );
        expect(deleteCall).toBeDefined();
        await transport.close();
    });

    test("addReaction POSTs to reactions endpoint with emoji_name body", async () => {
        const {transport, calls} = await makeConnectedTransport([
            {
                match: (url, init) =>
                    url.includes("/reactions") && init?.method === "POST",
                handler: () => jsonResponse({}),
            },
        ]);

        await transport.addReaction({messageId: 50, emoji: "tada"});

        const call = calls.find(
            ([url, init]) => url.includes("/reactions") && init?.method === "POST",
        );
        expect(call).toBeDefined();
        expect(call![0]).toContain("/api/v1/messages/50/reactions");
        const body = new URLSearchParams(call![1]!.body as string);
        expect(body.get("emoji_name")).toBe("tada");
        await transport.close();
    });

    test("removeReaction DELETEs with emoji_name as query param", async () => {
        const {transport, calls} = await makeConnectedTransport([
            {
                match: (url, init) =>
                    url.includes("/reactions") && init?.method === "DELETE",
                handler: () => jsonResponse({}),
            },
        ]);

        await transport.removeReaction({messageId: 50, emoji: "tada"});

        const call = calls.find(
            ([url, init]) => url.includes("/reactions") && init?.method === "DELETE",
        );
        expect(call).toBeDefined();
        // DELETE sends params on the URL, not the body.
        expect(call![0]).toContain("emoji_name=tada");
        await transport.close();
    });

    test("sendTyping resolves stream_id then POSTs to /api/v1/typing with legacy type=stream", async () => {
        // Same wire-compat rationale as sendMessage: type=stream is the
        // value every Zulip server accepts on /typing.
        let streamIdFetched = false;
        const {transport, calls} = await makeConnectedTransport([
            {
                match: (url) => url.includes("/api/v1/get_stream_id"),
                handler: () => {
                    streamIdFetched = true;
                    return jsonResponse({stream_id: 77});
                },
            },
            {
                match: (url, init) =>
                    url.includes("/api/v1/typing") && init?.method === "POST",
                handler: () => jsonResponse({}),
            },
        ]);

        await transport.sendTyping("start", {channel: "general", topic: "hello"});
        expect(streamIdFetched).toBe(true);

        const typingCall = calls.find(
            ([url, init]) => url.includes("/api/v1/typing") && init?.method === "POST",
        );
        expect(typingCall).toBeDefined();
        const body = new URLSearchParams(typingCall![1]!.body as string);
        expect(body.get("op")).toBe("start");
        expect(body.get("type")).toBe("stream");
        expect(body.get("stream_id")).toBe("77");
        expect(body.get("topic")).toBe("hello");
        await transport.close();
    });

    test("sendTyping swallows errors from older servers (best-effort)", async () => {
        // The composer fires typing pings rapidly; a 400 from an older
        // server without channel typing must not propagate to the UI
        // as a banner error. Pin this contract.
        const {transport} = await makeConnectedTransport([
            {
                match: (url) => url.includes("/api/v1/get_stream_id"),
                handler: () => jsonResponse({stream_id: 77}),
            },
            {
                match: (url, init) =>
                    url.includes("/api/v1/typing") && init?.method === "POST",
                handler: () =>
                    jsonResponse({result: "error", msg: "not supported"}, 400),
            },
        ]);

        await expect(
            transport.sendTyping("start", {channel: "general"}),
        ).resolves.toBeUndefined();
        await transport.close();
    });

    test("getCurrentUserId returns the id loaded during connect", async () => {
        const {transport} = await makeConnectedTransport([]);
        expect(transport.getCurrentUserId()).toBe(42);
        await transport.close();
    });
});
