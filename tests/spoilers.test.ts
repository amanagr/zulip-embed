import {describe, expect, test} from "vitest";

import {sanitizeHtml} from "../src/render.ts";
import {enhanceSpoilers} from "../src/spoilers.ts";

function hostWith(html: string): HTMLElement {
    const host = document.createElement("div");
    host.append(sanitizeHtml(html, "https://chat.example.com"));
    return host;
}

describe("enhanceSpoilers", () => {
    test("marks spoiler blocks collapsed and wires click to reveal", () => {
        const host = hostWith(
            `<div class="spoiler-block"><div class="spoiler-header"><p>Ending</p></div><div class="spoiler-content" aria-hidden="true"><p>It was Zulip.</p></div></div>`,
        );
        enhanceSpoilers(host);

        const block = host.querySelector<HTMLElement>(".spoiler-block");
        const header = host.querySelector<HTMLElement>(".spoiler-header");
        const content = host.querySelector<HTMLElement>(".spoiler-content");
        expect(block?.dataset["revealed"]).toBe("false");
        expect(header?.getAttribute("role")).toBe("button");
        expect(header?.getAttribute("tabindex")).toBe("0");
        expect(header?.getAttribute("aria-expanded")).toBe("false");
        expect(content?.getAttribute("aria-hidden")).toBe("true");

        header?.click();
        expect(block?.dataset["revealed"]).toBe("true");
        expect(header?.getAttribute("aria-expanded")).toBe("true");
        expect(content?.getAttribute("aria-hidden")).toBe("false");

        header?.click();
        expect(block?.dataset["revealed"]).toBe("false");
        expect(header?.getAttribute("aria-expanded")).toBe("false");
    });

    test("Enter and Space toggle the spoiler from the keyboard", () => {
        const host = hostWith(
            `<div class="spoiler-block"><div class="spoiler-header">Peek</div><div class="spoiler-content"><p>hi</p></div></div>`,
        );
        enhanceSpoilers(host);
        const header = host.querySelector<HTMLElement>(".spoiler-header");
        const block = host.querySelector<HTMLElement>(".spoiler-block");

        header?.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        expect(block?.dataset["revealed"]).toBe("true");

        header?.dispatchEvent(new KeyboardEvent("keydown", {key: " ", bubbles: true}));
        expect(block?.dataset["revealed"]).toBe("false");
    });

    test("supplies a default label when the header is empty", () => {
        const host = hostWith(
            `<div class="spoiler-block"><div class="spoiler-header"></div><div class="spoiler-content"><p>body</p></div></div>`,
        );
        enhanceSpoilers(host);
        const header = host.querySelector<HTMLElement>(".spoiler-header");
        expect(header?.textContent).toBe("Spoiler");
    });

    test("is idempotent — re-running doesn't double-bind listeners", () => {
        const host = hostWith(
            `<div class="spoiler-block"><div class="spoiler-header">h</div><div class="spoiler-content"><p>b</p></div></div>`,
        );
        enhanceSpoilers(host);
        enhanceSpoilers(host);
        const header = host.querySelector<HTMLElement>(".spoiler-header");
        const block = host.querySelector<HTMLElement>(".spoiler-block");
        header?.click();
        // One click → one toggle. If listeners had stacked, we'd be back to
        // false after two ignored toggles.
        expect(block?.dataset["revealed"]).toBe("true");
    });
});
