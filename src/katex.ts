// KaTeX CSS loader.
//
// Zulip's server pre-renders math expressions via KaTeX, which means by
// the time a message reaches us, the HTML already contains fully formed
// <span class="katex">…</span> / <span class="katex-display">…</span>
// trees. All the runtime needs is KaTeX's stylesheet so those nested
// spans lay out correctly — the layout is entirely CSS-driven.
//
// We lazily load the stylesheet the first time we detect a KaTeX node,
// so chat embeds without math don't pay the ~70KB CSS cost, and embeds
// on pages without an outbound CDN connection never fetch it at all.
// The <link> is injected into the component's shadow root so the CSS
// only affects the embed, not the host page.

// Pinned to a specific KaTeX release: behavior is deterministic and the
// server side uses the same version range. Overridable via the
// zulip-chat[katex-css] attribute for consumers who want to self-host the
// stylesheet or use a different CDN.
export const KATEX_VERSION = "0.16.11";
export const DEFAULT_KATEX_CSS = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;

// Subresource-integrity hash for the exact pinned KaTeX CSS URL above.
// Without this, a compromised jsdelivr (or a MITM'd proxy) could ship
// arbitrary CSS into every embed's shadow root, opening the door to
// CSS-based exfil (attribute-selector side channels, @import redirects,
// etc.). With it, the browser refuses to apply a stylesheet whose
// bytes don't match the hash.
//
// Update on every katex version bump; compute with:
//   curl -sL 'https://cdn.jsdelivr.net/npm/katex@<ver>/dist/katex.min.css' \
//     | openssl dgst -sha384 -binary | openssl base64 -A
// TODO(1.1): automate via scripts/fetch-katex-sri.mjs so the hash can't
// drift from the pinned version.
export const KATEX_CSS_SRI =
    "sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+";

// Keep track of which shadow roots have already received the <link> tag
// so subsequent renders don't duplicate it. WeakSet means we don't leak
// once the host element is garbage-collected.
const loadedFor = new WeakSet<ShadowRoot>();

export function ensureKatexStylesheet(shadow: ShadowRoot, cssUrl?: string): void {
    if (loadedFor.has(shadow)) return;
    loadedFor.add(shadow);

    const link = document.createElement("link");
    link.rel = "stylesheet";
    const href = cssUrl ?? DEFAULT_KATEX_CSS;
    link.href = href;
    // Only pin the SRI when we're loading our own pinned default URL.
    // A consumer-provided cssUrl (self-hosted mirror, different CDN, a
    // different KaTeX build) is out of our knowledge, so we can't assert
    // a hash for it — forcing one would break legitimate overrides.
    if (href === DEFAULT_KATEX_CSS) {
        link.integrity = KATEX_CSS_SRI;
    }
    // crossOrigin="anonymous" is required for SRI to succeed on a
    // cross-origin stylesheet (the browser needs a CORS-enabled response
    // to hash the body), and still correct when no integrity is set.
    link.crossOrigin = "anonymous";
    // Place the stylesheet before any sibling so the embed's own styles
    // can still override KaTeX's fonts/colors via normal cascade rules.
    const firstChild = shadow.firstChild;
    if (firstChild !== null) {
        shadow.insertBefore(link, firstChild);
    } else {
        shadow.append(link);
    }
}

export function hasKatexContent(root: ParentNode): boolean {
    return root.querySelector(".katex, .katex-display") !== null;
}

// Attach the stylesheet iff the rendered content contains KaTeX output.
// Safe to call repeatedly — the WeakSet short-circuits after the first
// successful load.
export function enhanceKatex(contentRoot: ParentNode, shadow: ShadowRoot, cssUrl?: string): void {
    if (!hasKatexContent(contentRoot)) return;
    ensureKatexStylesheet(shadow, cssUrl);
}
