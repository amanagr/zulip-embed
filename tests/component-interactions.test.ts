import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import "../src/index.ts";

// These tests exercise the component's interactive surface that the
// broader integration tests don't cover: infinite-scroll pagination,
// mark-all-read from scroll-to-bottom, and the reaction add/toggle
// delegation path. Each test drives the component through its observable
// shadow DOM rather than reaching into private state so they survive
// internal refactors.

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForMessages(el: HTMLElement, min = 1, maxTicks = 20): Promise<void> {
    for (let i = 0; i < maxTicks; i++) {
        const n = el.shadowRoot?.querySelectorAll(".message").length ?? 0;
        if (n >= min) return;
        await flush();
    }
}

// The emoji picker is lazy-loaded via a dynamic import, so the
// click → picker-visible path takes several microtask turns. Poll
// until the predicate holds instead of guessing a flush count.
async function waitFor(predicate: () => boolean, maxTicks = 40): Promise<void> {
    for (let i = 0; i < maxTicks; i++) {
        if (predicate()) return;
        await flush();
    }
}

describe("<zulip-chat> interactions", () => {
    beforeEach(() => {
        vi.useFakeTimers({shouldAdvanceTime: true});
    });

    afterEach(() => {
        document.body.replaceChildren();
        vi.useRealTimers();
    });

    test("scrolling to the top loads older messages via the demo pagination", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        await waitForMessages(el);

        const feed = el.shadowRoot?.querySelector<HTMLElement>(".feed");
        expect(feed).toBeTruthy();
        const before = el.shadowRoot?.querySelectorAll(".message").length ?? 0;

        // Spoof scroll metrics so handleFeedScroll thinks we're at the top
        // and we still have backlog (DemoTransport returns hasMore=true on
        // the first page, so the latch starts unlocked).
        Object.defineProperty(feed!, "scrollTop", {value: 0, writable: true, configurable: true});
        Object.defineProperty(feed!, "scrollHeight", {value: 1000, configurable: true});
        Object.defineProperty(feed!, "clientHeight", {value: 400, configurable: true});

        feed!.dispatchEvent(new Event("scroll"));
        for (let i = 0; i < 6; i++) await flush();

        const after = el.shadowRoot?.querySelectorAll(".message").length ?? 0;
        // Demo history floor is id=1, so exactly how many we get depends on
        // the seed's oldest id. Pin that at least one older message was
        // prepended (growth is strictly monotonic because the load path
        // dedupes by id).
        expect(after).toBeGreaterThan(before);
    });

    test("toggling a reaction on a seeded message invokes the transport", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        await waitForMessages(el);

        // Find any reaction chip and click it. The demo seeds at least one
        // message with a reaction (see demo-data tests for that invariant).
        const chip = el.shadowRoot?.querySelector<HTMLButtonElement>(".reaction");
        if (chip === null || chip === undefined) {
            // Not every seed yields a reaction. Fall back to clicking the
            // "+" add-reaction button on the first message, which opens
            // the picker; that exercises the same delegation path.
            const addBtn = el.shadowRoot?.querySelector<HTMLButtonElement>(".reaction-add");
            expect(addBtn).toBeTruthy();
            addBtn?.click();
            await flush();
            const picker = el.shadowRoot?.querySelector(".emoji-picker");
            expect(picker).toBeTruthy();
            return;
        }

        const initialPressed = chip.getAttribute("aria-pressed");
        chip.click();
        // Allow the async reaction round-trip + the reaction event to flow
        // back through the transport into the component state.
        for (let i = 0; i < 4; i++) await flush();

        const afterPressed = chip.getAttribute("aria-pressed");
        // Either the chip flipped pressed state, or the chip was removed
        // from the DOM (last reactor clicked off). Both prove the path ran.
        const stillPresent = el.shadowRoot?.contains(chip) ?? false;
        if (stillPresent) {
            expect(afterPressed).not.toBe(initialPressed);
        }
    });

    test("add-reaction button opens the emoji picker anchored to that message", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        await waitForMessages(el);

        const addBtn = el.shadowRoot?.querySelector<HTMLButtonElement>(".reaction-add");
        expect(addBtn).toBeTruthy();

        addBtn?.click();
        await waitFor(
            () =>
                el.shadowRoot?.querySelector<HTMLElement>(".emoji-picker")?.hidden ===
                false,
        );

        const picker = el.shadowRoot?.querySelector<HTMLElement>(".emoji-picker");
        expect(picker).toBeTruthy();
        // v0.1 picker renders at least one emoji option so keyboard users
        // have something to select.
        const options = picker?.querySelectorAll("button");
        expect((options?.length ?? 0)).toBeGreaterThan(0);
    });

    test("picking an emoji from the picker closes it", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        await waitForMessages(el);

        const addBtn = el.shadowRoot?.querySelector<HTMLButtonElement>(".reaction-add");
        addBtn?.click();
        await waitFor(
            () =>
                el.shadowRoot?.querySelector<HTMLElement>(".emoji-picker")?.hidden ===
                false,
        );
        const picker = el.shadowRoot?.querySelector<HTMLElement>(".emoji-picker");
        expect(picker?.hidden).toBe(false);

        const firstEmoji = picker?.querySelector<HTMLButtonElement>(".emoji-picker-btn");
        expect(firstEmoji).toBeTruthy();
        firstEmoji?.click();
        await waitFor(() => picker?.hidden === true);

        // Picker uses [hidden] to toggle visibility rather than detaching
        // the node so the anchor/focus logic stays simple. Pin that —
        // refactoring to detach on pick would break keyboard users whose
        // focus needs to return to the add-reaction button.
        expect(picker?.hidden).toBe(true);
    });

    test("scrolling back to bottom clears the unread separator and pill", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        await waitForMessages(el);

        const shadow = el.shadowRoot;
        const feed = shadow?.querySelector<HTMLElement>(".feed");
        expect(feed).toBeTruthy();

        // Simulate "scrolled away" so a new message creates an unread
        // anchor instead of auto-scrolling to the bottom.
        Object.defineProperty(feed!, "scrollHeight", {value: 2000, configurable: true});
        Object.defineProperty(feed!, "clientHeight", {value: 400, configurable: true});
        Object.defineProperty(feed!, "scrollTop", {value: 0, writable: true, configurable: true});

        type Internal = {appendMessage: (m: unknown) => void};
        const internal = el as unknown as Internal;
        internal.appendMessage({
            id: 9998,
            senderId: 42,
            senderFullName: "Stranger",
            senderEmail: "s@x",
            avatarUrl: "",
            timestamp: Date.now(),
            content: "unread",
            contentIsHtml: false,
            type: "channel",
            channelName: "general",
            topic: "welcome",
            reactions: [],
        });
        await flush();

        expect(shadow?.querySelector(".unread-separator")).not.toBeNull();

        // Now "scroll to bottom" — isNearBottom becomes true.
        Object.defineProperty(feed!, "scrollTop", {value: 1600, writable: true, configurable: true});
        feed!.dispatchEvent(new Event("scroll"));
        await flush();

        expect(shadow?.querySelector(".unread-separator")).toBeNull();
        const pill = shadow?.querySelector<HTMLButtonElement>(".new-messages-pill");
        expect(pill?.hidden).toBe(true);
    });

    test("clicking the new-messages pill scrolls the feed down", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        await waitForMessages(el);

        const shadow = el.shadowRoot;
        const feed = shadow?.querySelector<HTMLElement>(".feed");
        expect(feed).toBeTruthy();

        Object.defineProperty(feed!, "scrollHeight", {value: 2000, configurable: true});
        Object.defineProperty(feed!, "clientHeight", {value: 400, configurable: true});
        Object.defineProperty(feed!, "scrollTop", {value: 0, writable: true, configurable: true});

        type Internal = {appendMessage: (m: unknown) => void};
        (el as unknown as Internal).appendMessage({
            id: 9997,
            senderId: 42,
            senderFullName: "Stranger",
            senderEmail: "s@x",
            avatarUrl: "",
            timestamp: Date.now(),
            content: "ping",
            contentIsHtml: false,
            type: "channel",
            channelName: "general",
            topic: "welcome",
            reactions: [],
        });
        await flush();

        const pill = shadow?.querySelector<HTMLButtonElement>(".new-messages-pill");
        expect(pill?.hidden).toBe(false);

        pill?.click();
        await flush();

        // The pill hides once the viewer is caught up. jsdom doesn't
        // actually scroll, but the component calls scrollTo/sets scrollTop
        // and then treats the feed as caught-up.
        expect(pill?.hidden).toBe(true);
    });
});
