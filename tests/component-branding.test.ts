import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import "../src/index.ts";

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

// brand-logo / brand-name let adopters rebadge the embed as their own
// product. Cover the happy path plus the URL sanitizer — a javascript:
// or data: brand-logo slipped through the host would become an XSS
// vector the adopter probably never thought to audit.
describe("<zulip-chat> branding attributes", () => {
    beforeEach(() => {
        vi.useFakeTimers({shouldAdvanceTime: true});
    });

    afterEach(() => {
        document.body.replaceChildren();
        vi.useRealTimers();
    });

    test("brand-name overrides the channel header label", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        el.setAttribute("brand-name", "Acme Support");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const channel = el.shadowRoot?.querySelector(".header-channel");
        expect(channel?.textContent).toBe("Acme Support");
        // The leading "#" pseudo is suppressed by the data-brand-name hook.
        expect((channel as HTMLElement | null)?.dataset["brandName"]).toBe("1");
    });

    test("clearing brand-name restores the channel label", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        el.setAttribute("brand-name", "Acme Support");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        el.removeAttribute("brand-name");
        await flush();

        const channel = el.shadowRoot?.querySelector<HTMLElement>(".header-channel");
        expect(channel?.textContent).toBe("general");
        expect(channel?.dataset["brandName"]).toBeUndefined();
    });

    test("brand-logo renders an <img> with the sanitized URL", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        el.setAttribute("brand-logo", "https://example.com/logo.png");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const img = el.shadowRoot?.querySelector<HTMLImageElement>(".header-brand-logo");
        expect(img).toBeTruthy();
        expect(img?.hidden).toBe(false);
        expect(img?.getAttribute("src")).toBe("https://example.com/logo.png");
    });

    test("brand-logo rejects javascript: URIs", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        // eslint-disable-next-line no-script-url
        el.setAttribute("brand-logo", "javascript:alert(1)");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const img = el.shadowRoot?.querySelector<HTMLImageElement>(".header-brand-logo");
        expect(img?.hidden).toBe(true);
        expect(img?.hasAttribute("src")).toBe(false);
    });

    test("brand-logo rejects protocol-relative URLs", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        el.setAttribute("brand-logo", "//evil.tld/logo.png");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const img = el.shadowRoot?.querySelector<HTMLImageElement>(".header-brand-logo");
        expect(img?.hidden).toBe(true);
        expect(img?.hasAttribute("src")).toBe(false);
    });

    test("brand-logo accepts relative paths", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        el.setAttribute("brand-logo", "/assets/logo.svg");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const img = el.shadowRoot?.querySelector<HTMLImageElement>(".header-brand-logo");
        expect(img?.hidden).toBe(false);
        expect(img?.getAttribute("src")).toBe("/assets/logo.svg");
    });
});
