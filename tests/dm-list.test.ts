import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import type {DirectMessageConversation} from "../src/transport.ts";

// Injected per-test so we can swap fixtures without re-mocking. Mirrors
// the setup in channel-list.test.ts.
let fakeConversations: DirectMessageConversation[] = [];
let listImpl: (() => Promise<DirectMessageConversation[]>) | undefined;
let listImplementedAsUndefined = false;

vi.mock("../src/demo-transport.ts", () => {
    // Loose shape: the dm-list element only touches connect/close and
    // listDirectMessageConversations. Using Partial<Transport> here would
    // fight us because the optional method's declared signature is still
    // tracked as non-undefined by Partial's mapped-type widen.
    class FakeDemoTransport {
        constructor(_options: unknown) {}
        connect = async (): Promise<void> => {};
        close = async (): Promise<void> => {};
        // Conditionally left undefined so the "graceful degrade" test can
        // exercise the branch where the transport doesn't implement the
        // method at all. Vitest can't express "method absent" via a
        // stub's body alone — we have to hide the property.
        listDirectMessageConversations:
            | (() => Promise<DirectMessageConversation[]>)
            | undefined = listImplementedAsUndefined
            ? undefined
            : async (): Promise<DirectMessageConversation[]> => {
                  if (listImpl !== undefined) return listImpl();
                  return fakeConversations;
              };
    }
    return {DemoTransport: FakeDemoTransport};
});

await import("../src/dm-list.ts").then((m) => {
    m.registerZulipDmListElement();
});

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("<zulip-dm-list>", () => {
    beforeEach(() => {
        fakeConversations = [];
        listImpl = undefined;
        listImplementedAsUndefined = false;
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    test("registers a custom element", () => {
        expect(customElements.get("zulip-dm-list")).toBeTruthy();
    });

    test("renders each conversation in the transport-supplied order", async () => {
        const now = Date.now();
        fakeConversations = [
            {
                users: [{userId: 11, email: "a@x.com", fullName: "Alice", avatarUrl: ""}],
                lastMessageId: 500,
                lastMessageTime: now - 60_000,
            },
            {
                users: [{userId: 12, email: "b@x.com", fullName: "Bob", avatarUrl: ""}],
                lastMessageId: 501,
                lastMessageTime: now - 600_000,
            },
        ];
        const el = document.createElement("zulip-dm-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const names = [...(el.shadowRoot?.querySelectorAll(".name") ?? [])].map(
            (n) => n.textContent,
        );
        expect(names).toEqual(["Alice", "Bob"]);
    });

    test("formats a 1:1 label as the peer's full name", async () => {
        fakeConversations = [
            {
                users: [{userId: 11, email: "a@x.com", fullName: "Alice Adams", avatarUrl: ""}],
                lastMessageId: 1,
                lastMessageTime: Date.now(),
            },
        ];
        const el = document.createElement("zulip-dm-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const name = el.shadowRoot?.querySelector<HTMLElement>(".name");
        expect(name?.textContent).toBe("Alice Adams");
    });

    test("formats a group DM label by joining names with commas", async () => {
        fakeConversations = [
            {
                users: [
                    {userId: 11, email: "a@x.com", fullName: "Alice", avatarUrl: ""},
                    {userId: 12, email: "b@x.com", fullName: "Bob", avatarUrl: ""},
                    {userId: 13, email: "c@x.com", fullName: "Carla", avatarUrl: ""},
                ],
                lastMessageId: 1,
                lastMessageTime: Date.now(),
            },
        ];
        const el = document.createElement("zulip-dm-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const name = el.shadowRoot?.querySelector<HTMLElement>(".name");
        expect(name?.textContent).toBe("Alice, Bob, Carla");
    });

    test("truncates group DMs over three participants with +N suffix", async () => {
        fakeConversations = [
            {
                users: [
                    {userId: 11, email: "a@x.com", fullName: "Alice", avatarUrl: ""},
                    {userId: 12, email: "b@x.com", fullName: "Bob", avatarUrl: ""},
                    {userId: 13, email: "c@x.com", fullName: "Carla", avatarUrl: ""},
                    {userId: 14, email: "d@x.com", fullName: "Dan", avatarUrl: ""},
                    {userId: 15, email: "e@x.com", fullName: "Eve", avatarUrl: ""},
                ],
                lastMessageId: 1,
                lastMessageTime: Date.now(),
            },
        ];
        const el = document.createElement("zulip-dm-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const name = el.shadowRoot?.querySelector<HTMLElement>(".name");
        expect(name?.textContent).toBe("Alice, Bob, Carla +2");
    });

    test("click dispatches dm-selected with canonical userIds and users", async () => {
        fakeConversations = [
            {
                users: [
                    {userId: 13, email: "c@x.com", fullName: "Carla", avatarUrl: ""},
                    {userId: 11, email: "a@x.com", fullName: "Alice", avatarUrl: ""},
                ],
                lastMessageId: 42,
                lastMessageTime: Date.now(),
            },
        ];
        const el = document.createElement("zulip-dm-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        type Detail = {userIds: number[]; lastMessageId: number};
        const seen: Detail[] = [];
        el.addEventListener("dm-selected", (e) => {
            seen.push((e as CustomEvent<Detail>).detail);
        });

        for (let i = 0; i < 3; i++) await flush();

        const button = el.shadowRoot?.querySelector<HTMLButtonElement>(".item");
        button?.click();

        expect(seen.length).toBe(1);
        // userIds mirrors the `users` array order supplied by the
        // transport — bucketing already canonicalized by user id.
        expect(seen[0]?.userIds).toEqual([13, 11]);
        expect(seen[0]?.lastMessageId).toBe(42);
    });

    test("renders a friendly empty state when there are no DMs", async () => {
        fakeConversations = [];
        const el = document.createElement("zulip-dm-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const status = el.shadowRoot?.querySelector(".status");
        expect(status?.textContent).toContain("No direct messages");
    });

    test("renders an empty state when the transport omits the optional helper", async () => {
        // Older snapshot transports don't implement the method. The
        // element must degrade to "No direct messages" rather than
        // throwing or hanging on the loading spinner.
        listImplementedAsUndefined = true;
        const el = document.createElement("zulip-dm-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const status = el.shadowRoot?.querySelector(".status");
        expect(status?.textContent).toContain("No direct messages");
        const errorBanner = el.shadowRoot?.querySelector<HTMLElement>(".error");
        // No error banner should be displayed for this graceful-degrade path.
        expect(errorBanner?.hidden).toBe(true);
    });

    test("surfaces transport errors in the banner", async () => {
        listImpl = async () => {
            throw new Error("dm-fetch-failed");
        };
        const el = document.createElement("zulip-dm-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const err = el.shadowRoot?.querySelector(".error");
        expect(err?.textContent).toContain("dm-fetch-failed");
    });

    test("errors when live mode is missing credentials", async () => {
        // No `demo`, no `server` — the transport factory rejects this
        // config because we refuse to guess credentials.
        const el = document.createElement("zulip-dm-list");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const err = el.shadowRoot?.querySelector(".error");
        expect(err?.textContent ?? "").toContain('requires a "server"');
    });

    test("refresh() re-runs the fetch", async () => {
        fakeConversations = [
            {
                users: [{userId: 11, email: "a@x.com", fullName: "Alice", avatarUrl: ""}],
                lastMessageId: 1,
                lastMessageTime: Date.now(),
            },
        ];
        type PublicApi = HTMLElement & {refresh: () => Promise<void>};
        const el = document.createElement("zulip-dm-list") as PublicApi;
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();
        let names = [...(el.shadowRoot?.querySelectorAll(".name") ?? [])].map((n) => n.textContent);
        expect(names).toEqual(["Alice"]);

        fakeConversations = [
            {
                users: [{userId: 11, email: "a@x.com", fullName: "Alice", avatarUrl: ""}],
                lastMessageId: 1,
                lastMessageTime: Date.now(),
            },
            {
                users: [{userId: 12, email: "b@x.com", fullName: "Bob", avatarUrl: ""}],
                lastMessageId: 2,
                lastMessageTime: Date.now(),
            },
        ];
        await el.refresh();
        for (let i = 0; i < 2; i++) await flush();

        names = [...(el.shadowRoot?.querySelectorAll(".name") ?? [])].map((n) => n.textContent);
        expect(names).toEqual(["Alice", "Bob"]);
    });

    test("rejects unsafe avatar URLs and falls back to initials", async () => {
        // The avatar <img> must never honor a `javascript:` or `data:` URL —
        // a compromised snapshot could otherwise run arbitrary JS. The
        // element should silently drop the unsafe src and render initials.
        fakeConversations = [
            {
                users: [
                    {
                        userId: 11,
                        email: "a@x.com",
                        fullName: "Alice Adams",
                        avatarUrl: "javascript:alert(1)",
                    },
                ],
                lastMessageId: 1,
                lastMessageTime: Date.now(),
            },
        ];
        const el = document.createElement("zulip-dm-list");
        el.setAttribute("demo", "");
        document.body.append(el);

        for (let i = 0; i < 3; i++) await flush();

        const avatar = el.shadowRoot?.querySelector<HTMLElement>(".avatar");
        // No <img> should have been inserted for the unsafe URL.
        expect(avatar?.querySelector("img")).toBeNull();
        // Initials are "AA" (Alice Adams) uppercased.
        expect(avatar?.textContent).toBe("AA");
    });
});
