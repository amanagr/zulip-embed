import {describe, expect, test} from "vitest";

import {createEmojiPicker} from "../src/emoji-picker.ts";
import {EMOJI_GLYPHS} from "../src/render.ts";

// Cover emoji-picker behaviors the primary suite doesn't hit: close()
// idempotency, second-open callback replacement, non-Escape keys passing
// through, and the invariant that every curated name resolves to a real
// glyph (prevents the grid from silently showing the fallback).

function makeHost(): {shadow: ShadowRoot; container: HTMLElement} {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({mode: "open"});
    const container = document.createElement("div");
    container.style.position = "relative";
    shadow.append(container);
    return {shadow, container};
}

describe("emoji picker — lifecycle edges", () => {
    test("close() on an already-closed picker is a no-op", () => {
        const {shadow, container} = makeHost();
        const picker = createEmojiPicker(shadow, container);
        expect(picker.isOpen()).toBe(false);
        picker.close();
        picker.close();
        expect(picker.isOpen()).toBe(false);
    });

    test("reopening the picker does not duplicate grid buttons", () => {
        const {shadow, container} = makeHost();
        const picker = createEmojiPicker(shadow, container);
        const anchor = document.createElement("button");
        container.append(anchor);

        const before = picker.element().querySelectorAll(".emoji-picker-btn").length;
        picker.open(anchor, () => {});
        picker.close();
        picker.open(anchor, () => {});
        const after = picker.element().querySelectorAll(".emoji-picker-btn").length;
        expect(after).toBe(before);
    });

    test("a second open() replaces the onPick callback from the first", () => {
        const {shadow, container} = makeHost();
        const picker = createEmojiPicker(shadow, container);
        const anchor = document.createElement("button");
        container.append(anchor);

        let first = 0;
        let second = 0;
        picker.open(anchor, () => first++);
        picker.open(anchor, () => second++);

        const tada = picker
            .element()
            .querySelector<HTMLButtonElement>('[data-emoji-name="tada"]');
        tada?.click();

        expect(first).toBe(0);
        expect(second).toBe(1);
    });

    test("non-Escape keys do not close the picker", () => {
        const {shadow, container} = makeHost();
        const picker = createEmojiPicker(shadow, container);
        const anchor = document.createElement("button");
        container.append(anchor);

        picker.open(anchor, () => {});
        const firstBtn = picker.element().querySelector<HTMLButtonElement>(".emoji-picker-btn");
        for (const key of ["Enter", " ", "ArrowDown", "Tab", "a"]) {
            firstBtn?.dispatchEvent(
                new KeyboardEvent("keydown", {key, bubbles: true, composed: true}),
            );
        }
        expect(picker.isOpen()).toBe(true);
    });

    test("clicking an emoji button while closed (pathological) does not call onPick", () => {
        // If something external resurrects a reference to a grid button
        // after close(), clicking it must not call a stale onPick. Pins
        // that close() clears currentOnPick.
        const {shadow, container} = makeHost();
        const picker = createEmojiPicker(shadow, container);
        const anchor = document.createElement("button");
        container.append(anchor);

        let called = 0;
        picker.open(anchor, () => called++);
        picker.close();

        const tada = picker
            .element()
            .querySelector<HTMLButtonElement>('[data-emoji-name="tada"]');
        tada?.click();
        expect(called).toBe(0);
    });
});

describe("emoji picker — curated list invariants", () => {
    test("every curated button has a non-empty visible glyph", () => {
        const {shadow, container} = makeHost();
        const picker = createEmojiPicker(shadow, container);
        const buttons = picker.element().querySelectorAll<HTMLButtonElement>(".emoji-picker-btn");
        expect(buttons.length).toBeGreaterThan(0);
        for (const btn of buttons) {
            expect(btn.textContent?.length ?? 0).toBeGreaterThan(0);
            // dataset name must be set and non-empty so the click handler
            // has something to report back.
            expect(btn.dataset["emojiName"]?.length ?? 0).toBeGreaterThan(0);
        }
    });

    test("every curated button name appears in EMOJI_GLYPHS or uses a hardcoded fallback", () => {
        // Regression cover: when the renderer's glyph map is extended, the
        // picker's curated entries should continue to display — either
        // because the name is in EMOJI_GLYPHS or because glyphOf()'s
        // fallback is a real emoji character. This pins the no-blank-cell
        // invariant.
        const {shadow, container} = makeHost();
        const picker = createEmojiPicker(shadow, container);
        const buttons = picker.element().querySelectorAll<HTMLButtonElement>(".emoji-picker-btn");
        for (const btn of buttons) {
            const name = btn.dataset["emojiName"] ?? "";
            const glyphTextLen = btn.textContent?.length ?? 0;
            // If the name is in the glyph map, the button glyph matches.
            // Either way, glyphTextLen > 0 (pinned above); this test just
            // makes the intent explicit so a future regression that
            // emptied the fallback string would fail loudly here.
            if (name in EMOJI_GLYPHS) {
                expect(btn.textContent).toBe(EMOJI_GLYPHS[name]);
            } else {
                expect(glyphTextLen).toBeGreaterThan(0);
            }
        }
    });

    test("aria-label on each button is the emoji name (screen reader friendly)", () => {
        const {shadow, container} = makeHost();
        const picker = createEmojiPicker(shadow, container);
        const buttons = picker.element().querySelectorAll<HTMLButtonElement>(".emoji-picker-btn");
        for (const btn of buttons) {
            expect(btn.getAttribute("aria-label")).toBe(btn.dataset["emojiName"]);
        }
    });
});
