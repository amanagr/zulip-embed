import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import type {Transport} from "../src/transport.ts";
import type {Channel} from "../src/types.ts";

// Injected in each test via setFake(); the mocked DemoTransport below
// returns whatever this holds. Keeping the hook at module scope (rather
// than as a constructor arg) lets us swap the dataset per-test without
// re-mocking between runs.
let fakeChannels: Channel[] = [];
let listChannelsImpl: (() => Promise<Channel[]>) | undefined;

vi.mock("../src/demo-transport.ts", () => {
    class FakeDemoTransport implements Partial<Transport> {
        constructor(_options: unknown) {}
        connect = async (): Promise<void> => {};
        close = async (): Promise<void> => {};
        listChannels = async (): Promise<Channel[]> => {
            if (listChannelsImpl !== undefined) return listChannelsImpl();
            return fakeChannels;
        };
        listTopics = async (): Promise<[]> => [];
    }
    return {DemoTransport: FakeDemoTransport};
});

// Import after mocks are registered so the component picks up the fake.
await import("../src/channel-list.ts").then((m) => {
    m.registerZulipChannelListElement();
});

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("<zulip-channel-list>", () => {
    beforeEach(() => {
        fakeChannels = [];
        listChannelsImpl = undefined;
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    test("registers a custom element", () => {
        expect(customElements.get("zulip-channel-list")).toBeTruthy();
    });

    test("renders subscribed channels in transport order", async () => {
        fakeChannels = [
            {channelId: 1, name: "announce", description: "", color: "#ff0000", pinToTop: true},
            {channelId: 2, name: "general", description: "", color: "#00ff00"},
            {channelId: 3, name: "random", description: "", color: "#0000ff"},
        ];

        const el = document.createElement("zulip-channel-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const items = el.shadowRoot?.querySelectorAll(".item") ?? [];
        expect(items.length).toBe(3);
        const names = [...items].map((i) => i.querySelector(".name")?.textContent);
        expect(names).toEqual(["announce", "general", "random"]);
    });

    test("shows unread badge only when unreadCount > 0", async () => {
        fakeChannels = [
            {channelId: 1, name: "busy", description: "", unreadCount: 7},
            {channelId: 2, name: "quiet", description: "", unreadCount: 0},
            {channelId: 3, name: "none", description: ""},
        ];

        const el = document.createElement("zulip-channel-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const items = [...(el.shadowRoot?.querySelectorAll(".item") ?? [])];
        expect(items[0]?.querySelector(".badge")?.textContent).toBe("7");
        expect(items[1]?.querySelector(".badge")).toBeNull();
        expect(items[2]?.querySelector(".badge")).toBeNull();
    });

    test("renders pin icon for pinned channels and dims muted ones", async () => {
        fakeChannels = [
            {channelId: 1, name: "pinned", description: "", pinToTop: true},
            {channelId: 2, name: "muted", description: "", isMuted: true},
            {channelId: 3, name: "plain", description: ""},
        ];

        const el = document.createElement("zulip-channel-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const items = [...(el.shadowRoot?.querySelectorAll(".item") ?? [])];
        expect(items[0]?.querySelector(".pin")).not.toBeNull();
        expect(items[1]?.classList.contains("item-muted")).toBe(true);
        expect(items[2]?.querySelector(".pin")).toBeNull();
        expect(items[2]?.classList.contains("item-muted")).toBe(false);
    });

    test("click fires channel-selected with {channelId, name}", async () => {
        fakeChannels = [{channelId: 42, name: "general", description: "Main discussion"}];

        const el = document.createElement("zulip-channel-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        const detail: Array<{channelId: number; name: string}> = [];
        el.addEventListener("channel-selected", (e) => {
            detail.push((e as CustomEvent<{channelId: number; name: string}>).detail);
        });

        for (let i = 0; i < 3; i++) await flush();

        const button = el.shadowRoot?.querySelector<HTMLButtonElement>(".item");
        button?.click();

        expect(detail).toEqual([{channelId: 42, name: "general"}]);
    });

    test("sets description as title attribute on the channel name", async () => {
        fakeChannels = [{channelId: 1, name: "support", description: "Customer questions"}];

        const el = document.createElement("zulip-channel-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const name = el.shadowRoot?.querySelector<HTMLElement>(".name");
        expect(name?.title).toBe("Customer questions");
    });

    test("refresh() re-fetches channels", async () => {
        fakeChannels = [{channelId: 1, name: "first", description: ""}];

        type PublicApi = HTMLElement & {refresh: () => Promise<void>};
        const el = document.createElement("zulip-channel-list") as PublicApi;
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();
        let names = [...(el.shadowRoot?.querySelectorAll(".name") ?? [])].map((n) => n.textContent);
        expect(names).toEqual(["first"]);

        fakeChannels = [
            {channelId: 1, name: "first", description: ""},
            {channelId: 2, name: "second", description: ""},
        ];
        await el.refresh();
        for (let i = 0; i < 2; i++) await flush();

        names = [...(el.shadowRoot?.querySelectorAll(".name") ?? [])].map((n) => n.textContent);
        expect(names).toEqual(["first", "second"]);
    });

    test("renders a friendly message when there are no subscriptions", async () => {
        fakeChannels = [];

        const el = document.createElement("zulip-channel-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const status = el.shadowRoot?.querySelector(".status");
        expect(status?.textContent).toContain("No channels");
    });

    test("surfaces transport errors in the banner", async () => {
        listChannelsImpl = async () => {
            throw new Error("boom");
        };

        const el = document.createElement("zulip-channel-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const err = el.shadowRoot?.querySelector(".error");
        expect(err?.textContent).toContain("boom");
    });

    test("errors when live mode is missing credentials", async () => {
        const el = document.createElement("zulip-channel-list");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const err = el.shadowRoot?.querySelector(".error");
        expect(err?.textContent ?? "").toContain('requires a "server"');
    });
});
