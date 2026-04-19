import {describe, expect, test} from "vitest";

// Public API surface pin. If any named export below is renamed or
// removed, downstream embedders break silently. Keep this list in
// sync with src/index.ts and the package's documented exports.
import {
    DemoTransport,
    SnapshotTransport,
    ZulipChatElement,
    ZulipClient,
    ZulipTransport,
    registerZulipChatElement,
} from "../src/index.ts";

describe("public API surface", () => {
    test("ZulipClient is a constructor", () => {
        expect(typeof ZulipClient).toBe("function");
        expect(ZulipClient.prototype.constructor).toBe(ZulipClient);
    });

    test("DemoTransport is a constructor", () => {
        expect(typeof DemoTransport).toBe("function");
    });

    test("SnapshotTransport is a constructor", () => {
        expect(typeof SnapshotTransport).toBe("function");
    });

    test("ZulipTransport is a constructor", () => {
        expect(typeof ZulipTransport).toBe("function");
    });

    test("ZulipChatElement is an HTMLElement subclass", () => {
        expect(typeof ZulipChatElement).toBe("function");
        expect(Object.prototype.isPrototypeOf.call(HTMLElement, ZulipChatElement)).toBe(true);
    });

    test("registerZulipChatElement is exported and idempotent", () => {
        expect(typeof registerZulipChatElement).toBe("function");
        // index.ts already calls it once at import time; calling it
        // again must not throw (custom-element registry rejects
        // double-registration with a DOMException — the helper must
        // guard that internally).
        expect(() => registerZulipChatElement()).not.toThrow();
    });

    test("<zulip-chat> is in the CustomElementRegistry after index import", () => {
        expect(customElements.get("zulip-chat")).toBe(ZulipChatElement);
    });

    test("ZulipClient can be constructed with a minimal transport stub", () => {
        // Smoke test — ensure the public constructor signature doesn't
        // silently require fields that aren't documented on
        // ZulipClientOptions. We pass a minimally-typed transport via
        // a structural cast; the ctor should not inspect methods eagerly.
        const stub = {
            connect: async () => {},
            close: async () => {},
            getMessages: async () => ({messages: [], hasMore: false}),
            sendMessage: async () => {},
            editMessage: async () => {},
            deleteMessage: async () => {},
            addReaction: async () => {},
            removeReaction: async () => {},
            sendTyping: async () => {},
            getCurrentUserId: () => undefined,
            // Forward-compat: may be required by a future Transport
            // interface that adds listChannels / listTopics; keep the
            // stub minimal but include these as no-ops so the test
            // survives interface growth.
            listChannels: async () => [],
            listTopics: async () => [],
        };
        expect(
            () =>
                new ZulipClient({
                    transport: stub as unknown as ConstructorParameters<typeof ZulipClient>[0]["transport"],
                }),
        ).not.toThrow();
    });

    test("DemoTransport can be constructed with minimal options", () => {
        expect(
            () => new DemoTransport({scope: {channel: "general"}}),
        ).not.toThrow();
    });
});
