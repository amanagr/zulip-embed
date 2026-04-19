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
