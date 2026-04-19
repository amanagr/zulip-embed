import {describe, expect, test} from "vitest";

import {stripHtml} from "../src/strip-html.ts";

describe("stripHtml", () => {
    test("removes plain HTML tags and preserves inner text", () => {
        expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
    });

    test("decodes the entities Zulip commonly emits", () => {
        expect(stripHtml("AT&amp;T &lt;3 &quot;quoted&quot; &#39;s&#39;")).toBe(
            `AT&T <3 "quoted" 's'`,
        );
    });

    test("defuses HTML-encoded script tags (partial-entity bypass)", () => {
        // A naive strip-then-decode leaves this string as `<script>alert(1)</script>`
        // because the encoded angle brackets slip past the tag regex in
        // the first pass and only turn into real angle brackets after
        // decoding — the output then reads like a script tag even
        // though no code runs inside RN's <Text>.
        const payload = "&lt;script&gt;alert(1)&lt;/script&gt;";
        const out = stripHtml(payload);
        expect(out).not.toContain("<script");
        expect(out).not.toContain("</script");
    });

    test("defuses double-encoded payloads", () => {
        // `&amp;lt;img&amp;gt;` → `&lt;img&gt;` → `<img>` → "".
        const payload = "&amp;lt;img src=x onerror=alert(1)&amp;gt;";
        const out = stripHtml(payload);
        expect(out).not.toContain("<img");
        expect(out).not.toContain("onerror");
    });

    test("trims surrounding whitespace", () => {
        expect(stripHtml("  <p>hi</p>  ")).toBe("hi");
    });
});
