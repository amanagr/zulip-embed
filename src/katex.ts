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
const DEFAULT_KATEX_CSS =
    "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";

// Keep track of which shadow roots have already received the <link> tag
// so subsequent renders don't duplicate it. WeakSet means we don't leak
// once the host element is garbage-collected.
const loadedFor = new WeakSet<ShadowRoot>();

export function ensureKatexStylesheet(shadow: ShadowRoot, cssUrl?: string): void {
    if (loadedFor.has(shadow)) return;
    loadedFor.add(shadow);

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssUrl ?? DEFAULT_KATEX_CSS;
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
