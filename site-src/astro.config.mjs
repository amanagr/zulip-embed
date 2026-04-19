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
            sidebar: [
                {label: "Introduction", slug: "index"},
                {
                    label: "Guides",
                    items: [
                        {label: "Quickstart", slug: "guides/quickstart"},
                        {label: "Auth (JWT)", slug: "guides/auth"},
                        {label: "Troubleshooting", slug: "guides/troubleshooting"},
                    ],
                },
                {
                    label: "Frameworks",
                    items: [
                        {label: "HTML / CDN", slug: "frameworks/html"},
                        {label: "React", slug: "frameworks/react"},
                        {label: "React Native", slug: "frameworks/react-native"},
                        {label: "Flutter", slug: "frameworks/flutter"},
                        {label: "Vue", slug: "frameworks/vue"},
                        {label: "Svelte", slug: "frameworks/svelte"},
                        {label: "Next.js", slug: "frameworks/nextjs"},
                        {label: "Angular", slug: "frameworks/angular"},
                        {label: "Headless SDK", slug: "frameworks/headless"},
                    ],
                },
                {
                    label: "Reference",
                    items: [
                        {label: "Events", slug: "reference/events"},
                        {label: "Theming", slug: "reference/theming"},
                        {label: "Agents & AI", slug: "reference/agents"},
                    ],
                },
            ],
        }),
    ],
});
