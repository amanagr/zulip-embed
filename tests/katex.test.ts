import {describe, expect, test} from "vitest";

import {enhanceKatex, hasKatexContent} from "../src/katex.ts";

function makeShadow(): ShadowRoot {
    const host = document.createElement("div");
    document.body.append(host);
    return host.attachShadow({mode: "open"});
}

describe("hasKatexContent", () => {
    test("detects inline KaTeX wrappers", () => {
        const root = document.createElement("div");
        root.innerHTML = `<p>hi <span class="katex">x</span></p>`;
        expect(hasKatexContent(root)).toBe(true);
    });

    test("detects display KaTeX wrappers", () => {
        const root = document.createElement("div");
        root.innerHTML = `<div><span class="katex-display">y</span></div>`;
        expect(hasKatexContent(root)).toBe(true);
    });

    test("returns false when there's no math", () => {
        const root = document.createElement("div");
        root.innerHTML = `<p>plain text</p>`;
        expect(hasKatexContent(root)).toBe(false);
    });
});

describe("enhanceKatex", () => {
    test("injects a KaTeX stylesheet the first time math is detected", () => {
        const shadow = makeShadow();
        const content = document.createElement("div");
        content.innerHTML = `<p><span class="katex">x</span></p>`;
        shadow.append(content);

        enhanceKatex(content, shadow);
        const link = shadow.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
        expect(link).not.toBeNull();
        expect(link?.href).toMatch(/katex/);
    });

    test("skips stylesheet injection when no math is present", () => {
        const shadow = makeShadow();
        const content = document.createElement("div");
        content.innerHTML = `<p>plain</p>`;
        shadow.append(content);

        enhanceKatex(content, shadow);
        expect(shadow.querySelector('link[rel="stylesheet"]')).toBeNull();
    });

    test("does not duplicate the stylesheet across calls", () => {
        const shadow = makeShadow();
        const content = document.createElement("div");
        content.innerHTML = `<p><span class="katex-display">y</span></p>`;
        shadow.append(content);

        enhanceKatex(content, shadow);
        enhanceKatex(content, shadow);
        enhanceKatex(content, shadow);
        expect(shadow.querySelectorAll('link[rel="stylesheet"]').length).toBe(1);
    });

    test("honors a custom CSS URL", () => {
        const shadow = makeShadow();
        const content = document.createElement("div");
        content.innerHTML = `<p><span class="katex">x</span></p>`;
        shadow.append(content);

        enhanceKatex(content, shadow, "https://self-hosted.example/katex.css");
        const link = shadow.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
        expect(link?.href).toBe("https://self-hosted.example/katex.css");
    });
});
