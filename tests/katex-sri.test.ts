// Regression tests for the KaTeX stylesheet's subresource-integrity
// (SRI) pin. The injected <link> must carry a `sha384-…` integrity
// attribute for the default jsdelivr URL so a compromised CDN (or a
// MITM'd fetch) can't substitute malicious CSS into every embed's
// shadow root. See src/katex.ts and SECURITY.md.
import {describe, expect, test} from "vitest";

import {
    DEFAULT_KATEX_CSS,
    KATEX_CSS_SRI,
    KATEX_VERSION,
    ensureKatexStylesheet,
} from "../src/katex.ts";

function makeShadow(): ShadowRoot {
    const host = document.createElement("div");
    document.body.append(host);
    return host.attachShadow({mode: "open"});
}

describe("KATEX_CSS_SRI constant", () => {
    test("is a sha384 base64 digest", () => {
        // Shape enforcement — browsers only accept the two-part form.
        expect(KATEX_CSS_SRI).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/);
    });

    test("pins against the same KaTeX version as the default URL", () => {
        // If someone bumps one without the other, this guards against
        // the hash drifting off the URL silently.
        expect(DEFAULT_KATEX_CSS).toContain(`katex@${KATEX_VERSION}`);
    });
});

describe("ensureKatexStylesheet integrity attribute", () => {
    test("injects sha384 integrity on the default jsdelivr URL", () => {
        const shadow = makeShadow();
        ensureKatexStylesheet(shadow);

        const link = shadow.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
        expect(link).not.toBeNull();
        expect(link?.href).toBe(DEFAULT_KATEX_CSS);
        expect(link?.integrity).toBe(KATEX_CSS_SRI);
        // SRI on a cross-origin stylesheet requires a CORS-enabled fetch.
        expect(link?.crossOrigin).toBe("anonymous");
    });

    test("integrity IDL property starts with sha384-", () => {
        const shadow = makeShadow();
        ensureKatexStylesheet(shadow);

        const link = shadow.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
        // Verify the `integrity` IDL attribute — that's what the browser
        // consults internally before applying the stylesheet. jsdom sets
        // the IDL property but doesn't always reflect it to the serialized
        // `integrity` attribute, so we inspect the IDL side directly.
        expect(link?.integrity).toMatch(/^sha384-/);
    });

    test("does not pin integrity for a consumer-provided override URL", () => {
        // Self-hosted mirrors / a different KaTeX build won't match our
        // hash, so we must not force integrity onto them — that would
        // break legitimate overrides in the field.
        const shadow = makeShadow();
        ensureKatexStylesheet(shadow, "https://self-hosted.example/katex.css");

        const link = shadow.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
        expect(link?.href).toBe("https://self-hosted.example/katex.css");
        // The integrity attribute must not be serialized on the element
        // for override URLs — we never assigned to `link.integrity`, so
        // it is absent/unset. (jsdom exposes the unset IDL as `undefined`;
        // browsers expose it as `""`. Both mean "no SRI enforced.")
        expect(link?.getAttribute("integrity")).toBeNull();
        expect(link?.integrity ?? "").toBe("");
        // crossOrigin is still set so the stylesheet loads consistently
        // and can be hashed by a downstream CSP/SRI policy if desired.
        expect(link?.crossOrigin).toBe("anonymous");
    });
});
