import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import "../src/index.ts";

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("<zulip-chat>", () => {
    beforeEach(() => {
        vi.useFakeTimers({shouldAdvanceTime: true});
    });

    afterEach(() => {
        document.body.replaceChildren();
        vi.useRealTimers();
    });

    test("registers a custom element", () => {
        expect(customElements.get("zulip-chat")).toBeTruthy();
    });

    test("renders the demo channel header and feed", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        el.setAttribute("topic", "welcome");
        document.body.append(el);

        await flush();
        await flush();

        const shadow = el.shadowRoot;
        expect(shadow).toBeTruthy();
        const channel = shadow?.querySelector(".header-channel");
        expect(channel?.textContent).toBe("general");
        const topic = shadow?.querySelector(".header-topic");
        expect(topic?.textContent).toBe("welcome");
    });

    test("populates the feed with seeded demo messages", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 5; i++) await flush();

        const messages = el.shadowRoot?.querySelectorAll(".message");
        expect(messages?.length ?? 0).toBeGreaterThan(0);
    });

    test("surfaces a useful error when live mode is missing credentials", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const banner = el.shadowRoot?.querySelector(".error-banner");
        expect(banner?.textContent ?? "").toContain('requires "server"');
    });

    test("shows the new-messages pill when a message arrives while scrolled away", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        // Let the demo transport connect and seed messages.
        for (let i = 0; i < 5; i++) await flush();

        const shadow = el.shadowRoot;
        const feed = shadow?.querySelector<HTMLElement>(".feed");
        const pill = shadow?.querySelector<HTMLButtonElement>(".new-messages-pill");
        expect(pill).not.toBeNull();
        // jsdom gives zero layout dimensions, which means isNearBottom()
        // evaluates true by default. Drive the component through the same
        // public surface a live browser would: inject a message via the
        // internal appendMessage path by dispatching through the transport.
        // The simplest proxy is to simulate "scrolled away" by stubbing
        // scroll metrics, then fire a scroll to update perception.
        if (feed) {
            Object.defineProperty(feed, "scrollHeight", {value: 2000, configurable: true});
            Object.defineProperty(feed, "clientHeight", {value: 400, configurable: true});
            Object.defineProperty(feed, "scrollTop", {value: 0, writable: true, configurable: true});
        }

        // Now push a message through the component API directly. We reach
        // in via the instance rather than dispatch a synthetic event so
        // the test doesn't depend on the transport's reply timing.
        type Internal = {appendMessage: (m: unknown) => void};
        const internal = el as unknown as Internal;
        internal.appendMessage({
            id: 9999,
            senderId: 42,
            senderFullName: "New Person",
            senderEmail: "new@example.com",
            avatarUrl: "",
            timestamp: Date.now(),
            content: "a brand new message",
            contentIsHtml: false,
            type: "channel",
            channelName: "general",
            topic: "welcome",
            reactions: [],
        });

        await flush();

        expect(pill?.hidden).toBe(false);
        expect(pill?.textContent ?? "").toContain("new");
        expect(shadow?.querySelector(".unread-separator")).not.toBeNull();
    });

    test("floating mode starts collapsed as a launcher button", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("mode", "floating");
        document.body.append(el);

        await flush();

        const launcher = el.shadowRoot?.querySelector<HTMLButtonElement>(".launcher");
        expect(launcher?.getAttribute("aria-label")).toBe("Open chat");
        expect(el.hasAttribute("open")).toBe(false);

        launcher?.click();
        expect(el.hasAttribute("open")).toBe(true);

        const closeBtn = el.shadowRoot?.querySelector<HTMLButtonElement>(".header-close");
        closeBtn?.click();
        expect(el.hasAttribute("open")).toBe(false);
    });
});
