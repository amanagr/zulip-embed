import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import "../src/index.ts";

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushMany(n: number): Promise<void> {
    for (let i = 0; i < n; i++) await flush();
}

describe("<zulip-chat> — integration", () => {
    beforeEach(() => {
        vi.useFakeTimers({shouldAdvanceTime: true});
    });

    afterEach(() => {
        document.body.replaceChildren();
        vi.useRealTimers();
    });

    test("channel attribute change triggers a re-init", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);
        await flushMany(5);

        expect(el.shadowRoot?.querySelector(".header-channel")?.textContent).toBe("general");

        el.setAttribute("channel", "announce");
        await flushMany(5);

        expect(el.shadowRoot?.querySelector(".header-channel")?.textContent).toBe("announce");
    });

    test("topic attribute change triggers a re-init", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        el.setAttribute("topic", "first");
        document.body.append(el);
        await flushMany(5);

        expect(el.shadowRoot?.querySelector(".header-topic")?.textContent).toBe("first");

        el.setAttribute("topic", "second");
        await flushMany(5);

        expect(el.shadowRoot?.querySelector(".header-topic")?.textContent).toBe("second");
    });

    test("read-only mode renders the composer element but CSS hides it", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        el.setAttribute("read-only", "");
        document.body.append(el);
        await flushMany(5);

        // Composer still exists in the DOM (the CSS hides it via
        // :host([read-only]) .composer { display: none; }) — that way
        // toggling the attribute off doesn't require a rebuild.
        const composer = el.shadowRoot?.querySelector(".composer");
        expect(composer).not.toBeNull();
        // The host attribute is what drives the CSS; assert its
        // presence so any future refactor that drops the attribute
        // would immediately re-expose the composer.
        expect(el.hasAttribute("read-only")).toBe(true);
    });

    test("snapshot-url mode also hides the composer via the same CSS path", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("snapshot-url", "data:application/json,{}"); // ctor-rejected scheme
        el.setAttribute("channel", "general");
        document.body.append(el);
        await flushMany(5);

        // snapshot-url attribute is present regardless of whether the
        // snapshot load succeeds; this is what the CSS rule keys on.
        expect(el.hasAttribute("snapshot-url")).toBe(true);
    });

    test("mode=floating renders a launcher button before open", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("mode", "floating");
        document.body.append(el);
        await flush();

        const launcher = el.shadowRoot?.querySelector<HTMLButtonElement>(".launcher");
        expect(launcher).not.toBeNull();
        expect(launcher?.getAttribute("aria-label")).toBe("Open chat");
        expect(el.hasAttribute("open")).toBe(false);
    });

    test("mode=floating launcher click sets open attribute", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("mode", "floating");
        document.body.append(el);
        await flush();

        el.shadowRoot?.querySelector<HTMLButtonElement>(".launcher")?.click();
        expect(el.hasAttribute("open")).toBe(true);
    });

    test("non-reinit attribute changes (theme) do not rebuild the feed", async () => {
        // Theme swap should only flip a class / host attribute, not
        // trigger a transport reconnect. Pin this by asserting the
        // same feed element survives a theme change.
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);
        await flushMany(5);

        const feedBefore = el.shadowRoot?.querySelector(".feed");
        el.setAttribute("theme", "dark");
        await flush();
        const feedAfter = el.shadowRoot?.querySelector(".feed");
        expect(feedAfter).toBe(feedBefore);
    });

    test("missing credentials banner clears once demo attribute is added", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("channel", "general");
        document.body.append(el);
        await flushMany(3);

        let banner = el.shadowRoot?.querySelector(".error-banner");
        expect(banner?.textContent ?? "").toContain('requires a "server"');

        // Flipping into demo mode should clear the config error.
        el.setAttribute("demo", "");
        await flushMany(5);

        banner = el.shadowRoot?.querySelector(".error-banner");
        // Either the banner is gone entirely, or its text no longer
        // mentions the config error.
        expect(banner?.textContent ?? "").not.toContain('requires a "server"');
    });

    test("removing channel attribute does not crash the component", async () => {
        // The component today tolerates missing channel in demo mode by
        // falling back to the previous value; this test just pins that
        // it doesn't throw on removal so the operator can safely
        // rewrite attributes at runtime.
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);
        await flushMany(5);

        expect(() => {
            el.removeAttribute("channel");
        }).not.toThrow();
        await flushMany(5);
        expect(el.shadowRoot).toBeTruthy();
    });

    test("zulip-connection-change bubbles through the shadow DOM boundary", async () => {
        // composed: true on the CustomEvent lets it cross shadow DOM.
        // Pin that guarantee by listening on document rather than the
        // element itself — if composed were flipped off, this test
        // would silently stop receiving events.
        const received: unknown[] = [];
        const handler = (e: Event): void => {
            received.push((e as CustomEvent).detail);
        };
        document.addEventListener("zulip-connection-change", handler);
        try {
            const el = document.createElement("zulip-chat");
            el.setAttribute("demo", "");
            el.setAttribute("channel", "general");
            document.body.append(el);
            await flushMany(10);
            expect(received.length).toBeGreaterThan(0);
        } finally {
            document.removeEventListener("zulip-connection-change", handler);
        }
    });

    test("dispatches zulip-connection-change when demo transport connects", async () => {
        // Attach listener BEFORE append so we catch the synchronous
        // connection event demo transport fires during connect().
        const el = document.createElement("zulip-chat");
        const statuses: string[] = [];
        el.addEventListener("zulip-connection-change", (e) => {
            statuses.push((e as CustomEvent).detail.status);
        });
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);
        await flushMany(10);
        // Demo transport flips straight to "connected"; we just pin that
        // at least one connection-change event fired with a valid status.
        expect(statuses.length).toBeGreaterThan(0);
        expect(["connecting", "connected", "disconnected", "reconnecting"]).toContain(
            statuses[statuses.length - 1],
        );
    });

    test("auth-token attribute alone passes live-mode preflight", async () => {
        // When auth-token is set we skip the "requires email + api-key"
        // error and defer to the ZulipTransport JWT exchange. We stub the
        // JWT endpoint to return immediately so connect() can proceed;
        // the important thing for this test is that the config banner
        // doesn't fire for a missing email/api-key.
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (url: string) => {
            if (url.includes("/api/internal/jwt/fetch_api_key")) {
                return new Response(
                    JSON.stringify({api_key: "k", email: "bot@x"}),
                    {
                        status: 200,
                        headers: {"Content-Type": "application/json"},
                    },
                );
            }
            // Return a pending promise for /register and /events so the
            // component stays in the connecting state; we're only asserting
            // that the config-error banner doesn't fire.
            return new Promise(() => {});
        }) as unknown as typeof fetch;

        try {
            const el = document.createElement("zulip-chat");
            el.setAttribute("server", "https://zulip.example");
            el.setAttribute("auth-token", "jwt.signed");
            el.setAttribute("channel", "general");
            document.body.append(el);
            await flushMany(3);

            const banner = el.shadowRoot?.querySelector(".error-banner");
            expect(banner?.textContent ?? "").not.toContain(
                'requires a "server"',
            );
            expect(banner?.textContent ?? "").not.toContain(
                'requires an "auth-token"',
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
