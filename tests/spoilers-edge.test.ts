import {describe, expect, test} from "vitest";

import {sanitizeHtml} from "../src/render.ts";
import {enhanceSpoilers} from "../src/spoilers.ts";

// Edge-case battery for enhanceSpoilers. The happy path is covered in
// spoilers.test.ts; these tests exercise malformed server output, deep
// nesting, and accessibility details.
function hostWith(html: string): HTMLElement {
    const host = document.createElement("div");
    host.append(sanitizeHtml(html, "https://chat.example.com"));
    return host;
}

describe("enhanceSpoilers — edge cases", () => {
    test("nested spoilers each toggle independently", () => {
        // A spoiler whose content embeds another spoiler. Clicking the
        // outer header should only toggle the outer block; the inner
        // block stays collapsed until its own header is clicked.
        const host = hostWith(
            `<div class="spoiler-block"><div class="spoiler-header">Outer</div>` +
                `<div class="spoiler-content">` +
                `<div class="spoiler-block"><div class="spoiler-header">Inner</div>` +
                `<div class="spoiler-content"><p>secret</p></div></div>` +
                `</div></div>`,
        );
        enhanceSpoilers(host);
        const blocks = host.querySelectorAll<HTMLElement>(".spoiler-block");
        expect(blocks.length).toBe(2);
        const [outer, inner] = blocks;
        const outerHeader = outer?.querySelector<HTMLElement>(":scope > .spoiler-header");
        outerHeader?.click();
        expect(outer?.dataset["revealed"]).toBe("true");
        expect(inner?.dataset["revealed"]).toBe("false");

        const innerHeader = inner?.querySelector<HTMLElement>(":scope > .spoiler-header");
        innerHeader?.click();
        expect(outer?.dataset["revealed"]).toBe("true");
        expect(inner?.dataset["revealed"]).toBe("true");
    });

    test("block missing its content sibling is skipped (no crash)", () => {
        const host = hostWith(
            `<div class="spoiler-block"><div class="spoiler-header">orphan</div></div>`,
        );
        expect(() => enhanceSpoilers(host)).not.toThrow();
        const header = host.querySelector<HTMLElement>(".spoiler-header");
        // No enhancement: dataset ready flag stays unset, role is absent.
        expect(header?.dataset["zcSpoiler"]).toBeUndefined();
        expect(header?.getAttribute("role")).toBeNull();
    });

    test("block missing its header is skipped", () => {
        const host = hostWith(
            `<div class="spoiler-block"><div class="spoiler-content"><p>lonely</p></div></div>`,
        );
        expect(() => enhanceSpoilers(host)).not.toThrow();
        const block = host.querySelector<HTMLElement>(".spoiler-block");
        expect(block?.dataset["revealed"]).toBeUndefined();
    });

    test("Space key does not scroll the page when toggling", () => {
        // The handler must call preventDefault() on Space so Space
        // toggles the spoiler instead of scrolling the viewport (which
        // Space does on any other focusable element). Detect via a
        // preventDefault spy on the dispatched event.
        const host = hostWith(
            `<div class="spoiler-block"><div class="spoiler-header">h</div>` +
                `<div class="spoiler-content"><p>b</p></div></div>`,
        );
        enhanceSpoilers(host);
        const header = host.querySelector<HTMLElement>(".spoiler-header");
        const ev = new KeyboardEvent("keydown", {key: " ", bubbles: true, cancelable: true});
        header?.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
    });

    test("non-toggling keys are ignored (arrow keys, letters)", () => {
        const host = hostWith(
            `<div class="spoiler-block"><div class="spoiler-header">h</div>` +
                `<div class="spoiler-content"><p>b</p></div></div>`,
        );
        enhanceSpoilers(host);
        const header = host.querySelector<HTMLElement>(".spoiler-header");
        const block = host.querySelector<HTMLElement>(".spoiler-block");
        for (const key of ["ArrowDown", "Tab", "a", "Escape"]) {
            const ev = new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true});
            header?.dispatchEvent(ev);
            expect(ev.defaultPrevented).toBe(false);
        }
        expect(block?.dataset["revealed"]).toBe("false");
    });

    test("default 'Spoiler' label is not applied when header has whitespace-only text", () => {
        // Current behavior: textContent.trim() === "" falls through to
        // the "Spoiler" default. Pin this so authors who deliberately
        // ship an empty header still get a readable label.
        const host = hostWith(
            `<div class="spoiler-block"><div class="spoiler-header">   \n\t  </div>` +
                `<div class="spoiler-content"><p>b</p></div></div>`,
        );
        enhanceSpoilers(host);
        const header = host.querySelector<HTMLElement>(".spoiler-header");
        expect(header?.textContent).toBe("Spoiler");
    });

    test("header with existing text is not replaced by the default label", () => {
        const host = hostWith(
            `<div class="spoiler-block"><div class="spoiler-header">Secret</div>` +
                `<div class="spoiler-content"><p>b</p></div></div>`,
        );
        enhanceSpoilers(host);
        const header = host.querySelector<HTMLElement>(".spoiler-header");
        expect(header?.textContent).toBe("Secret");
    });

    test("subsequent toggles keep aria-hidden in sync with dataset", () => {
        const host = hostWith(
            `<div class="spoiler-block"><div class="spoiler-header">h</div>` +
                `<div class="spoiler-content"><p>b</p></div></div>`,
        );
        enhanceSpoilers(host);
        const header = host.querySelector<HTMLElement>(".spoiler-header");
        const content = host.querySelector<HTMLElement>(".spoiler-content");
        const block = host.querySelector<HTMLElement>(".spoiler-block");
        for (const expected of ["true", "false", "true", "false"]) {
            header?.click();
            expect(block?.dataset["revealed"]).toBe(expected);
            expect(content?.getAttribute("aria-hidden")).toBe(
                expected === "true" ? "false" : "true",
            );
        }
    });
});
