import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import type {Transport} from "../src/transport.ts";
import type {Message} from "../src/types.ts";

let fakeMessage: Message | undefined;
let fetchMessageImpl: ((id: number) => Promise<Message | undefined>) | undefined;

vi.mock("../src/demo-transport.ts", () => {
    class FakeDemoTransport implements Partial<Transport> {
        constructor(_options: unknown) {}
        connect = async (): Promise<void> => {};
        close = async (): Promise<void> => {};
        fetchMessage = async (id: number): Promise<Message | undefined> => {
            if (fetchMessageImpl !== undefined) return fetchMessageImpl(id);
            return fakeMessage;
        };
    }
    return {DemoTransport: FakeDemoTransport};
});

await import("../src/announcement.ts").then((m) => {
    m.registerZulipAnnouncementElement();
});

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeMessage(overrides: Partial<Message> = {}): Message {
    return {
        id: 123,
        type: "channel",
        channelName: "general",
        topic: "announcements",
        content: "Hello team!",
        contentIsHtml: false,
        timestamp: 1_700_000_000,
        senderId: 7,
        senderFullName: "Ada",
        senderEmail: "ada@example.com",
        avatarUrl: "",
        reactions: [],
        ...overrides,
    } as Message;
}

describe("<zulip-announcement>", () => {
    beforeEach(() => {
        fakeMessage = undefined;
        fetchMessageImpl = undefined;
        globalThis.localStorage?.clear();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    test("registers a custom element", () => {
        expect(customElements.get("zulip-announcement")).toBeTruthy();
    });

    test("renders plain-text announcement body", async () => {
        fakeMessage = makeMessage({content: "System maintenance at 22:00 UTC."});

        const el = document.createElement("zulip-announcement");
        el.setAttribute("demo", "");
        el.setAttribute("message-id", "123");
        document.body.append(el);

        for (let i = 0; i < 4; i++) await flush();

        const body = el.shadowRoot?.querySelector(".body");
        expect(body?.textContent).toContain("System maintenance at 22:00 UTC.");
    });

    test("renders HTML announcement body via sanitizer", async () => {
        fakeMessage = makeMessage({
            content: '<p>Read the <a href="https://example.com">docs</a>.</p>',
            contentIsHtml: true,
        });

        const el = document.createElement("zulip-announcement");
        el.setAttribute("demo", "");
        el.setAttribute("message-id", "99");
        document.body.append(el);

        for (let i = 0; i < 4; i++) await flush();

        const link = el.shadowRoot?.querySelector(".body a");
        expect(link?.textContent).toBe("docs");
        expect(link?.getAttribute("href")).toBe("https://example.com");
    });

    test("renders a dismiss button when dismissible is set", async () => {
        fakeMessage = makeMessage();

        const el = document.createElement("zulip-announcement");
        el.setAttribute("demo", "");
        el.setAttribute("message-id", "123");
        el.setAttribute("dismissible", "");
        document.body.append(el);

        for (let i = 0; i < 4; i++) await flush();

        const dismiss = el.shadowRoot?.querySelector<HTMLButtonElement>(".dismiss");
        expect(dismiss).toBeTruthy();
    });

    test("dismiss() hides the banner and dispatches announcement-dismissed", async () => {
        fakeMessage = makeMessage();

        const el = document.createElement("zulip-announcement");
        el.setAttribute("demo", "");
        el.setAttribute("message-id", "42");
        el.setAttribute("dismissible", "");
        document.body.append(el);

        const detail: Array<{messageId: number | undefined}> = [];
        el.addEventListener("announcement-dismissed", (e) => {
            detail.push((e as CustomEvent<{messageId: number | undefined}>).detail);
        });

        for (let i = 0; i < 4; i++) await flush();

        const dismiss = el.shadowRoot?.querySelector<HTMLButtonElement>(".dismiss");
        dismiss?.click();

        expect(el.hidden).toBe(true);
        expect(detail).toEqual([{messageId: 42}]);
    });

    test("persists dismissal across reloads via localStorage", async () => {
        fakeMessage = makeMessage();

        const el = document.createElement("zulip-announcement");
        el.setAttribute("demo", "");
        el.setAttribute("message-id", "77");
        el.setAttribute("dismissible", "");
        document.body.append(el);

        for (let i = 0; i < 4; i++) await flush();
        el.shadowRoot?.querySelector<HTMLButtonElement>(".dismiss")?.click();
        el.remove();

        // Re-mount with the same id — should stay hidden without fetching.
        const fetchSpy = vi.fn();
        fetchMessageImpl = async (id) => {
            fetchSpy();
            return makeMessage({id});
        };

        const el2 = document.createElement("zulip-announcement");
        el2.setAttribute("demo", "");
        el2.setAttribute("message-id", "77");
        el2.setAttribute("dismissible", "");
        document.body.append(el2);

        for (let i = 0; i < 4; i++) await flush();

        expect(el2.hidden).toBe(true);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("changing message-id resets dismissal and re-fetches", async () => {
        fakeMessage = makeMessage({id: 1, content: "first"});

        const el = document.createElement("zulip-announcement");
        el.setAttribute("demo", "");
        el.setAttribute("message-id", "1");
        el.setAttribute("dismissible", "");
        document.body.append(el);

        for (let i = 0; i < 4; i++) await flush();
        el.shadowRoot?.querySelector<HTMLButtonElement>(".dismiss")?.click();
        expect(el.hidden).toBe(true);

        fakeMessage = makeMessage({id: 2, content: "second"});
        el.setAttribute("message-id", "2");

        for (let i = 0; i < 4; i++) await flush();

        expect(el.hidden).toBe(false);
        expect(el.shadowRoot?.querySelector(".body")?.textContent).toContain("second");
    });

    test("shows error when message-id is invalid", async () => {
        const el = document.createElement("zulip-announcement");
        el.setAttribute("demo", "");
        el.setAttribute("message-id", "not-a-number");
        document.body.append(el);

        for (let i = 0; i < 4; i++) await flush();

        const error = el.shadowRoot?.querySelector(".error");
        expect(error?.textContent).toContain("Invalid message-id");
    });

    test("shows status prompt when no message-id is set", async () => {
        const el = document.createElement("zulip-announcement");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 4; i++) await flush();

        const status = el.shadowRoot?.querySelector(".status");
        expect(status?.textContent).toContain("message-id");
    });

    test("shows error when viewer cannot see the message", async () => {
        fetchMessageImpl = async () => undefined;

        const el = document.createElement("zulip-announcement");
        el.setAttribute("demo", "");
        el.setAttribute("message-id", "555");
        document.body.append(el);

        for (let i = 0; i < 4; i++) await flush();

        const error = el.shadowRoot?.querySelector(".error");
        expect(error?.textContent).toContain("not visible");
    });

    test("surfaces transport errors in the banner", async () => {
        fetchMessageImpl = async () => {
            throw new Error("boom");
        };

        const el = document.createElement("zulip-announcement");
        el.setAttribute("demo", "");
        el.setAttribute("message-id", "5");
        document.body.append(el);

        for (let i = 0; i < 4; i++) await flush();

        const error = el.shadowRoot?.querySelector(".error");
        expect(error?.textContent).toContain("boom");
    });

    test("errors when live mode is missing credentials", async () => {
        const el = document.createElement("zulip-announcement");
        el.setAttribute("message-id", "1");
        document.body.append(el);

        for (let i = 0; i < 4; i++) await flush();

        const error = el.shadowRoot?.querySelector(".error");
        expect(error?.textContent ?? "").toContain('"server"');
    });
});
