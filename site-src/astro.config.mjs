// @ts-check
import {defineConfig} from "astro/config";
import starlight from "@astrojs/starlight";

// Starlight docs + landing page for zulip-embed. The base path mirrors
// the GitHub Pages deployment target so internal links work both on
// Pages (/<repo>/) and on custom domains (/ only).
const base = process.env["SITE_BASE"] ?? "/";

export default defineConfig({
    site: "https://amanagr.github.io",
    base,
    trailingSlash: "ignore",
    // Emit straight to ../site so the existing Pages workflow's upload
    // step keeps pointing at the same directory.
    outDir: "../site",
    integrations: [
        starlight({
            title: "zulip-embed",
            description:
                "Embed Zulip chat as a framework-agnostic Web Component or headless SDK.",
            social: [
                {
                    icon: "github",
                    label: "GitHub",
                    href: "https://github.com/amanagr/zulip-embed",
                },
            ],
            customCss: ["./src/styles/site.css"],
            head: [
                // The landing hero and doc pages embed live <zulip-chat>
                // widgets in demo mode. Load the bundle globally so any
                // page that drops the custom element in gets hydration
                // for free — no per-page island wiring required.
                {
                    tag: "script",
                    attrs: {
                        type: "module",
                        src: `${base}zulip-embed.js`,
                    },
                },
            ],
            // Phase 0 smoke-test only ships the landing + quickstart.
            // Phase 1 fills in Frameworks / Reference / Guides.
            sidebar: [
                {label: "Introduction", slug: "index"},
                {label: "Quickstart", slug: "guides/quickstart"},
            ],
        }),
    ],
});
