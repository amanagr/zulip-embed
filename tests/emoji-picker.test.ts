import {describe, expect, test} from "vitest";

import {createEmojiPicker} from "../src/emoji-picker.ts";

function makeHost(): {shadow: ShadowRoot; container: HTMLElement} {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({mode: "open"});
    const container = document.createElement("div");
    container.style.position = "relative";
    shadow.append(container);
    return {shadow, container};
}

describe("emoji picker", () => {
    test("starts hidden and is attached to the container", () => {
        const {shadow, container} = makeHost();
        const picker = createEmojiPicker(shadow, container);
        const panel = picker.element();
        expect(panel.hidden).toBe(true);
        expect(container.contains(panel)).toBe(true);
    });

    test("open() reveals the panel and renders a curated grid", () => {
        const {shadow, container} = makeHost();
        const picker = createEmojiPicker(shadow, container);
        const anchor = document.createElement("button");
        container.append(anchor);

        picker.open(anchor, () => {
            /* noop */
        });

        const panel = picker.element();
        expect(panel.hidden).toBe(false);
        const buttons = panel.querySelectorAll(".emoji-picker-btn");
        expect(buttons.length).toBeGreaterThan(10);
        // The curated list must include the most common reactions.
        const names = [...buttons].map((b) => (b as HTMLElement).dataset["emojiName"]);
        expect(names).toContain("+1");
        expect(names).toContain("tada");
        expect(names).toContain("heart");
    });

    test("clicking a button fires onPick with the emoji name and closes", () => {
        const {shadow, container} = makeHost();
        const picker = createEmojiPicker(shadow, container);
        const anchor = document.createElement("button");
        container.append(anchor);

        let picked: string | undefined;
        picker.open(anchor, (name) => {
            picked = name;
        });

        const tada = picker
            .element()
            .querySelector<HTMLButtonElement>('[data-emoji-name="tada"]');
        tada?.click();

        expect(picked).toBe("tada");
        expect(picker.isOpen()).toBe(false);
    });

    test("outside click closes the picker", () => {
        const {shadow, container} = makeHost();
        const picker = createEmojiPicker(shadow, container);
        const anchor = document.createElement("button");
        container.append(anchor);
        const outside = document.createElement("div");
        container.append(outside);

        picker.open(anchor, () => {
            /* noop */
        });
        expect(picker.isOpen()).toBe(true);

        outside.dispatchEvent(new MouseEvent("click", {bubbles: true, composed: true}));
        expect(picker.isOpen()).toBe(false);
    });

    test("Escape closes the picker", () => {
        const {shadow, container} = makeHost();
        const picker = createEmojiPicker(shadow, container);
        const anchor = document.createElement("button");
        container.append(anchor);

        picker.open(anchor, () => {
            /* noop */
        });
        const firstBtn = picker.element().querySelector<HTMLButtonElement>(".emoji-picker-btn");
        firstBtn?.dispatchEvent(
            new KeyboardEvent("keydown", {key: "Escape", bubbles: true, composed: true}),
        );
        expect(picker.isOpen()).toBe(false);
    });
});
