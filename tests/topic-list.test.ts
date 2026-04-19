import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import type {Transport} from "../src/transport.ts";
import type {Topic} from "../src/types.ts";

// Per-channel fake datasets. The mocked DemoTransport routes
// listTopics(channel) through here so tests can stage different
// topic sets per channel (used for the attribute-change test).
const topicsByChannel = new Map<string, Topic[]>();
const callLog: string[] = [];
let listTopicsImpl: ((channel: string) => Promise<Topic[]>) | undefined;

vi.mock("../src/demo-transport.ts", () => {
    class FakeDemoTransport implements Partial<Transport> {
        constructor(_options: unknown) {}
        connect = async (): Promise<void> => {};
        close = async (): Promise<void> => {};
        listChannels = async (): Promise<[]> => [];
        listTopics = async (channel: string): Promise<Topic[]> => {
            callLog.push(channel);
            if (listTopicsImpl !== undefined) return listTopicsImpl(channel);
            return topicsByChannel.get(channel) ?? [];
        };
    }
    return {DemoTransport: FakeDemoTransport};
});

await import("../src/topic-list.ts").then((m) => {
    m.registerZulipTopicListElement();
});

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("<zulip-topic-list>", () => {
    beforeEach(() => {
        topicsByChannel.clear();
        callLog.length = 0;
        listTopicsImpl = undefined;
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    test("registers a custom element", () => {
        expect(customElements.get("zulip-topic-list")).toBeTruthy();
    });

    test("renders topics in the order the transport returns them", async () => {
        topicsByChannel.set("general", [
            {name: "newest", maxMessageId: 30},
            {name: "middle", maxMessageId: 20},
            {name: "oldest", maxMessageId: 10},
        ]);

        const el = document.createElement("zulip-topic-list");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const names = [...(el.shadowRoot?.querySelectorAll(".name") ?? [])].map(
            (n) => n.textContent,
        );
        expect(names).toEqual(["newest", "middle", "oldest"]);
    });

    test("renders a resolved check on resolved topics only", async () => {
        topicsByChannel.set("general", [
            {name: "done", maxMessageId: 20, isResolved: true},
            {name: "open", maxMessageId: 10, isResolved: false},
        ]);

        const el = document.createElement("zulip-topic-list");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const items = [...(el.shadowRoot?.querySelectorAll(".item") ?? [])];
        expect(items[0]?.querySelector(".resolved-check")?.textContent).toBe("\u2714");
        expect(items[1]?.querySelector(".resolved-check")).toBeNull();
        expect(items[1]?.querySelector(".resolved-placeholder")).not.toBeNull();
    });

    test("click fires topic-selected with {topic}", async () => {
        topicsByChannel.set("general", [
            {name: "lunch plans", maxMessageId: 20},
        ]);

        const el = document.createElement("zulip-topic-list");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        const detail: Array<{topic: string}> = [];
        el.addEventListener("topic-selected", (e) => {
            detail.push((e as CustomEvent<{topic: string}>).detail);
        });

        for (let i = 0; i < 3; i++) await flush();

        const button = el.shadowRoot?.querySelector<HTMLButtonElement>(".item");
        button?.click();

        expect(detail).toEqual([{topic: "lunch plans"}]);
    });

    test("changing the channel attribute triggers a re-fetch", async () => {
        topicsByChannel.set("general", [{name: "intro", maxMessageId: 5}]);
        topicsByChannel.set("random", [
            {name: "memes", maxMessageId: 9},
            {name: "gifs", maxMessageId: 8},
        ]);

        const el = document.createElement("zulip-topic-list");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();
        expect(callLog).toEqual(["general"]);
        let names = [...(el.shadowRoot?.querySelectorAll(".name") ?? [])].map(
            (n) => n.textContent,
        );
        expect(names).toEqual(["intro"]);

        el.setAttribute("channel", "random");
        for (let i = 0; i < 3; i++) await flush();

        expect(callLog).toEqual(["general", "random"]);
        names = [...(el.shadowRoot?.querySelectorAll(".name") ?? [])].map(
            (n) => n.textContent,
        );
        expect(names).toEqual(["memes", "gifs"]);
    });

    test("prompts to set a channel when the attribute is missing", async () => {
        const el = document.createElement("zulip-topic-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const status = el.shadowRoot?.querySelector(".status");
        expect(status?.textContent).toContain('"channel"');
        expect(callLog).toEqual([]);
    });

    test("reports an empty-state message when no topics exist", async () => {
        topicsByChannel.set("general", []);

        const el = document.createElement("zulip-topic-list");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const status = el.shadowRoot?.querySelector(".status");
        expect(status?.textContent).toContain("No topics");
    });

    test("surfaces transport errors in the banner", async () => {
        listTopicsImpl = async () => {
            throw new Error("kaboom");
        };

        const el = document.createElement("zulip-topic-list");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const err = el.shadowRoot?.querySelector(".error");
        expect(err?.textContent).toContain("kaboom");
    });

    test("errors when live mode is missing credentials", async () => {
        const el = document.createElement("zulip-topic-list");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const err = el.shadowRoot?.querySelector(".error");
        expect(err?.textContent ?? "").toContain('requires "server"');
    });

    test("refresh() re-fetches topics", async () => {
        topicsByChannel.set("general", [{name: "one", maxMessageId: 1}]);

        type PublicApi = HTMLElement & {refresh: () => Promise<void>};
        const el = document.createElement("zulip-topic-list") as PublicApi;
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();
        expect(callLog.length).toBe(1);

        await el.refresh();
        for (let i = 0; i < 2; i++) await flush();
        expect(callLog.length).toBe(2);
    });
});
