import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import type {Transport} from "../src/transport.ts";
import type {Channel} from "../src/types.ts";

// Exercises the stale-response guard (loadToken) on <zulip-channel-list>.
// Without this guard, a slow earlier fetch can resolve after a faster
// later one and overwrite a fresh channel list with stale data — which
// bites users who switch servers or force-refresh quickly. The primary
// channel-list suite covers happy-path rendering; this file pins the
// race behavior so a refactor of the token logic fails loudly.

let listChannelsImpl: (() => Promise<Channel[]>) | undefined;

vi.mock("../src/demo-transport.ts", () => {
    class FakeDemoTransport implements Partial<Transport> {
        constructor(_options: unknown) {}
        connect = async (): Promise<void> => {};
        close = async (): Promise<void> => {};
        listChannels = async (): Promise<Channel[]> => {
            if (listChannelsImpl !== undefined) return listChannelsImpl();
            return [];
        };
        listTopics = async (): Promise<[]> => [];
    }
    return {DemoTransport: FakeDemoTransport};
});

await import("../src/channel-list.ts").then((m) => {
    m.registerZulipChannelListElement();
});

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("<zulip-channel-list> stale-response guard", () => {
    beforeEach(() => {
        listChannelsImpl = undefined;
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    test("a refresh() kicked off before the previous fetch resolves wins", async () => {
        // Simulate: fetch #1 is slow, refresh() starts fetch #2 which is
        // fast and resolves first, then fetch #1 finally resolves. The
        // loadToken guard must drop fetch #1's stale result so the UI
        // reflects fetch #2's channels, not #1's.
        let resolveSlow: ((v: Channel[]) => void) | undefined;
        let callCount = 0;
        listChannelsImpl = async () => {
            callCount++;
            if (callCount === 1) {
                return new Promise<Channel[]>((resolve) => {
                    resolveSlow = resolve;
                });
            }
            return [
                {channelId: 9, name: "fresh", description: "", color: "#00ff00"},
            ];
        };

        const el = document.createElement("zulip-channel-list");
        el.setAttribute("demo", "");
        document.body.append(el);
        // First fetch is in flight but not resolved yet.
        await flush();

        // Fire a second fetch while the first is still pending.
        type Refreshable = {refresh: () => void};
        (el as unknown as Refreshable).refresh();
        // Let the second fetch run to completion.
        for (let i = 0; i < 3; i++) await flush();

        // Now resolve the first, stale fetch.
        resolveSlow?.([
            {channelId: 1, name: "stale", description: "", color: "#ff0000"},
        ]);
        for (let i = 0; i < 3; i++) await flush();

        const items = el.shadowRoot?.querySelectorAll(".item") ?? [];
        const names = [...items].map((i) => i.querySelector(".name")?.textContent);
        // Fresh won — stale never overwrites.
        expect(names).toEqual(["fresh"]);
    });

    test("errors from a stale fetch do not override a successful fresh result", async () => {
        let rejectSlow: ((e: Error) => void) | undefined;
        let callCount = 0;
        listChannelsImpl = async () => {
            callCount++;
            if (callCount === 1) {
                return new Promise<Channel[]>((_, reject) => {
                    rejectSlow = reject;
                });
            }
            return [
                {channelId: 9, name: "fresh", description: "", color: "#00ff00"},
            ];
        };

        const el = document.createElement("zulip-channel-list");
        el.setAttribute("demo", "");
        document.body.append(el);
        await flush();

        type Refreshable = {refresh: () => void};
        (el as unknown as Refreshable).refresh();
        for (let i = 0; i < 3; i++) await flush();

        // The first fetch errors late — must not replace the fresh list
        // with an error banner.
        rejectSlow?.(new Error("network exploded"));
        for (let i = 0; i < 3; i++) await flush();

        const errorBanner = el.shadowRoot?.querySelector(".error");
        expect(errorBanner?.textContent ?? "").not.toContain("network exploded");
        const names = [...(el.shadowRoot?.querySelectorAll(".item") ?? [])].map(
            (i) => i.querySelector(".name")?.textContent,
        );
        expect(names).toEqual(["fresh"]);
    });
});
