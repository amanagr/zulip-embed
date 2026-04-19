// Coverage for the categorised / searchable emoji picker.
//
// These tests instantiate the picker directly rather than going through
// <zulip-chat> so we can assert against the panel DOM without juggling
// transport state. Storage interactions go through the real localStorage
// that jsdom provides; tests clean it up to stay independent.

import {beforeEach, describe, expect, test} from "vitest";

import {createEmojiPicker} from "../src/emoji-picker.ts";

const RECENT_KEY = "zulip-embed:emoji-recent";

function mount(): {
    shadow: ShadowRoot;
    container: HTMLElement;
    handle: ReturnType<typeof createEmojiPicker>;
    anchor: HTMLButtonElement;
} {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({mode: "open"});
    const container = document.createElement("div");
    container.style.position = "relative";
    shadow.append(container);
    const anchor = document.createElement("button");
    anchor.textContent = "anchor";
    container.append(anchor);
    const handle = createEmojiPicker(shadow, container);
    return {shadow, container, handle, anchor};
}

describe("emoji-picker — categorised picker", () => {
    beforeEach(() => {
        try {
            localStorage.removeItem(RECENT_KEY);
        } catch {
            // jsdom lacks storage in some corners; ignore.
        }
    });

    test("renders a category nav and heading for each category", () => {
        const {handle, anchor} = mount();
        handle.open(anchor, () => {});
        const panel = handle.element();
        const tabs = panel.querySelectorAll(".emoji-picker-tab");
        // recents + 8 categories
        expect(tabs.length).toBe(9);
        const headings = Array.from(panel.querySelectorAll(".emoji-picker-heading")).map(
            (h) => h.textContent,
        );
        expect(headings).toContain("People");
        expect(headings).toContain("Nature");
        expect(headings).toContain("Flags");
    });

    test("search filters to matching emoji only", () => {
        const {handle, anchor} = mount();
        handle.open(anchor, () => {});
        const panel = handle.element();
        const search = panel.querySelector<HTMLInputElement>(".emoji-picker-search");
        expect(search).not.toBeNull();
        if (search === null) return;
        search.value = "heart";
        search.dispatchEvent(new Event("input", {bubbles: true}));
        const buttons = panel.querySelectorAll<HTMLButtonElement>(".emoji-picker-btn");
        expect(buttons.length).toBeGreaterThan(0);
        for (const b of buttons) {
            const name = b.dataset["emojiName"] ?? "";
            expect(name.length).toBeGreaterThan(0);
            // Every hit should contain "heart" somewhere in name or keyword.
            const ok = name.includes("heart") || /heart|love/.test(name);
            expect(ok).toBe(true);
        }
    });

    test("search with no matches renders an empty state", () => {
        const {handle, anchor} = mount();
        handle.open(anchor, () => {});
        const panel = handle.element();
        const search = panel.querySelector<HTMLInputElement>(".emoji-picker-search")!;
        search.value = "zzznonexistent";
        search.dispatchEvent(new Event("input", {bubbles: true}));
        const empty = panel.querySelector(".emoji-picker-empty");
        expect(empty).not.toBeNull();
    });

    test("clicking an emoji invokes the callback and closes the panel", () => {
        const {handle, anchor} = mount();
        let picked: string | undefined;
        handle.open(anchor, (name) => {
            picked = name;
        });
        const panel = handle.element();
        const btn = panel.querySelector<HTMLButtonElement>(".emoji-picker-btn");
        expect(btn).not.toBeNull();
        btn?.click();
        expect(picked).toBeDefined();
        expect(handle.isOpen()).toBe(false);
    });

    test("picking an emoji records it in localStorage recents", () => {
        const {handle, anchor} = mount();
        handle.open(anchor, () => {});
        const panel = handle.element();
        const search = panel.querySelector<HTMLInputElement>(".emoji-picker-search")!;
        search.value = "fire";
        search.dispatchEvent(new Event("input", {bubbles: true}));
        const btn = panel.querySelector<HTMLButtonElement>(
            '.emoji-picker-btn[data-emoji-name="fire"]',
        );
        expect(btn).not.toBeNull();
        btn?.click();
        const stored = localStorage.getItem(RECENT_KEY);
        expect(stored).not.toBeNull();
        const parsed = stored === null ? [] : (JSON.parse(stored) as string[]);
        expect(parsed[0]).toBe("fire");
    });

    test("reopening shows fresh state (search input cleared)", () => {
        const {handle, anchor} = mount();
        handle.open(anchor, () => {});
        const search1 = handle
            .element()
            .querySelector<HTMLInputElement>(".emoji-picker-search")!;
        search1.value = "heart";
        search1.dispatchEvent(new Event("input", {bubbles: true}));
        handle.close();
        handle.open(anchor, () => {});
        const search2 = handle
            .element()
            .querySelector<HTMLInputElement>(".emoji-picker-search")!;
        expect(search2.value).toBe("");
    });

    test("hovering an emoji shows its :name: in the footer", () => {
        const {handle, anchor} = mount();
        handle.open(anchor, () => {});
        const panel = handle.element();
        const btn = panel.querySelector<HTMLButtonElement>(
            '.emoji-picker-btn[data-emoji-name="+1"]',
        );
        expect(btn).not.toBeNull();
        btn?.dispatchEvent(new Event("mouseenter", {bubbles: true}));
        const footer = panel.querySelector(".emoji-picker-footer");
        expect(footer?.textContent).toBe(":+1:");
    });
});
