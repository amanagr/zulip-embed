import "../src/index.ts";

import type {ZulipChatElement} from "../src/index.ts";

function requireElement<T extends HTMLElement>(selector: string): T {
    const el = document.querySelector<T>(selector);
    if (el === null) {
        throw new Error(`Missing required element: ${selector}`);
    }
    return el;
}

const live = requireElement<ZulipChatElement>("#live-chat");
const connectButton = requireElement<HTMLButtonElement>("#connect");
const serverInput = requireElement<HTMLInputElement>("#server");
const authTokenInput = requireElement<HTMLInputElement>("#auth-token");
const channelInput = requireElement<HTMLInputElement>("#channel");
const topicInput = requireElement<HTMLInputElement>("#topic");
const themeSelect = requireElement<HTMLSelectElement>("#theme");

connectButton.addEventListener("click", () => {
    const server = serverInput.value.trim();
    const authToken = authTokenInput.value.trim();
    const channel = channelInput.value.trim() || "general";
    const topic = topicInput.value.trim();
    const theme = themeSelect.value;

    if (server === "" || authToken === "") {
        live.setAttribute("demo", "");
        live.removeAttribute("server");
        live.removeAttribute("auth-token");
    } else {
        live.removeAttribute("demo");
        live.setAttribute("server", server);
        live.setAttribute("auth-token", authToken);
    }
    live.setAttribute("channel", channel);
    if (topic === "") {
        live.removeAttribute("topic");
    } else {
        live.setAttribute("topic", topic);
    }
    live.setAttribute("theme", theme);
});

// Theming playground — plain `<input>`s drive CSS variables on the
// preview <zulip-chat> so visitors can see branding knobs (accent,
// surface, radius, height, typography, brand-name, brand-logo) move
// the widget in real time, then copy a ready-to-paste snippet.

interface PlaygroundPreset {
    accent: string;
    bg: string;
    surface: string;
    text: string;
    theme: "light" | "dark";
}

const PLAYGROUND_PRESETS: Record<string, PlaygroundPreset> = {
    default: {accent: "#6172f3", bg: "#ffffff", surface: "#f7f7f9", text: "#111827", theme: "light"},
    zulip: {accent: "#2b59ff", bg: "#ffffff", surface: "#eef2ff", text: "#0f172a", theme: "light"},
    forest: {accent: "#16a34a", bg: "#f7fbf7", surface: "#e8f5e9", text: "#14532d", theme: "light"},
    sunset: {accent: "#f97316", bg: "#fffaf5", surface: "#fff2e4", text: "#7c2d12", theme: "light"},
    midnight: {accent: "#818cf8", bg: "#0f172a", surface: "#1e293b", text: "#f8fafc", theme: "dark"},
};

const pgChat = document.querySelector<ZulipChatElement>("#pg-chat");
if (pgChat) {
    const brandNameInput = requireElement<HTMLInputElement>("#pg-brand-name");
    const brandLogoInput = requireElement<HTMLInputElement>("#pg-brand-logo");
    const accentInput = requireElement<HTMLInputElement>("#pg-accent");
    const bgInput = requireElement<HTMLInputElement>("#pg-bg");
    const surfaceInput = requireElement<HTMLInputElement>("#pg-surface");
    const textInput = requireElement<HTMLInputElement>("#pg-text");
    const radiusInput = requireElement<HTMLInputElement>("#pg-radius");
    const radiusVal = requireElement<HTMLElement>("#pg-radius-val");
    const heightInput = requireElement<HTMLInputElement>("#pg-height");
    const heightVal = requireElement<HTMLElement>("#pg-height-val");
    const fontSizeInput = requireElement<HTMLInputElement>("#pg-font-size");
    const fontSizeVal = requireElement<HTMLElement>("#pg-font-size-val");
    const fontFamilyInput = requireElement<HTMLSelectElement>("#pg-font-family");
    const pgThemeInput = requireElement<HTMLSelectElement>("#pg-theme");
    const snippetEl = requireElement<HTMLElement>("#pg-snippet");
    const presetButtons = document.querySelectorAll<HTMLButtonElement>(".preset");

    function applyPlayground(): void {
        if (!pgChat) return;
        const accent = accentInput.value;
        const bg = bgInput.value;
        const surface = surfaceInput.value;
        const text = textInput.value;
        const radius = radiusInput.value;
        const height = heightInput.value;
        const fontSize = fontSizeInput.value;
        const fontFamily = fontFamilyInput.value;
        const theme = pgThemeInput.value;
        const brandName = brandNameInput.value.trim();
        const brandLogo = brandLogoInput.value.trim();

        pgChat.style.setProperty("--zc-color-accent", accent);
        pgChat.style.setProperty("--zc-color-bg", bg);
        pgChat.style.setProperty("--zc-color-surface", surface);
        pgChat.style.setProperty("--zc-color-text", text);
        pgChat.style.setProperty("--zc-radius", `${radius}px`);
        pgChat.style.setProperty("--zc-height", `${height}px`);
        pgChat.style.setProperty("--zc-font-size", `${fontSize}px`);
        pgChat.style.setProperty("--zc-font-family", fontFamily);
        pgChat.setAttribute("theme", theme);

        if (brandName === "") {
            pgChat.removeAttribute("brand-name");
        } else {
            pgChat.setAttribute("brand-name", brandName);
        }
        if (brandLogo === "") {
            pgChat.removeAttribute("brand-logo");
        } else {
            pgChat.setAttribute("brand-logo", brandLogo);
        }

        radiusVal.textContent = radius;
        heightVal.textContent = height;
        fontSizeVal.textContent = fontSize;

        snippetEl.textContent = buildSnippet({
            accent,
            bg,
            surface,
            text,
            radius,
            height,
            fontSize,
            fontFamily,
            theme,
            brandName,
            brandLogo,
        });
    }

    function buildSnippet(opts: {
        accent: string;
        bg: string;
        surface: string;
        text: string;
        radius: string;
        height: string;
        fontSize: string;
        fontFamily: string;
        theme: string;
        brandName: string;
        brandLogo: string;
    }): string {
        const attrs = [
            `theme="${escapeAttr(opts.theme)}"`,
            `channel="general"`,
            `topic="welcome"`,
            `mode="inline"`,
        ];
        if (opts.brandName !== "") attrs.push(`brand-name="${escapeAttr(opts.brandName)}"`);
        if (opts.brandLogo !== "") attrs.push(`brand-logo="${escapeAttr(opts.brandLogo)}"`);
        const styleLines = [
            `  --zc-color-accent: ${opts.accent};`,
            `  --zc-color-bg: ${opts.bg};`,
            `  --zc-color-surface: ${opts.surface};`,
            `  --zc-color-text: ${opts.text};`,
            `  --zc-radius: ${opts.radius}px;`,
            `  --zc-height: ${opts.height}px;`,
            `  --zc-font-size: ${opts.fontSize}px;`,
            `  --zc-font-family: ${opts.fontFamily};`,
        ].join("\n");
        return [
            `<zulip-chat`,
            `  ${attrs.join("\n  ")}`,
            `  server="https://chat.example.com"`,
            `  auth-token="<short-lived JWT from your backend>"`,
            `  style="`,
            styleLines,
            `  "`,
            `></zulip-chat>`,
        ].join("\n");
    }

    function escapeAttr(s: string): string {
        return s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
    }

    const bindInputs = [
        brandNameInput,
        brandLogoInput,
        accentInput,
        bgInput,
        surfaceInput,
        textInput,
        radiusInput,
        heightInput,
        fontSizeInput,
        fontFamilyInput,
        pgThemeInput,
    ];
    for (const input of bindInputs) {
        input.addEventListener("input", applyPlayground);
        input.addEventListener("change", applyPlayground);
    }

    for (const btn of presetButtons) {
        btn.addEventListener("click", () => {
            const key = btn.dataset["preset"] ?? "default";
            const preset = PLAYGROUND_PRESETS[key] ?? PLAYGROUND_PRESETS["default"]!;
            accentInput.value = preset.accent;
            bgInput.value = preset.bg;
            surfaceInput.value = preset.surface;
            textInput.value = preset.text;
            pgThemeInput.value = preset.theme;
            applyPlayground();
        });
    }

    applyPlayground();
}

// ------------------------------------------------------------------
// Framework + install tab switching.
//
// The landing page repeats the "tabs → snippet panels" pattern twice:
// once for the framework gallery (HTML / React / React Native / Flutter
// / Headless) and once for the install commands (script / npm / react /
// rn / flutter). Both groups share a single wiring by driving off the
// data-* attributes on the buttons and panels, so we don't end up with
// two nearly-identical copies of the same logic.
// ------------------------------------------------------------------

function wireTabs(groupAttr: string, panelAttr: string): void {
    const tabs = document.querySelectorAll<HTMLButtonElement>(`[${groupAttr}]`);
    const panels = document.querySelectorAll<HTMLElement>(`[${panelAttr}]`);
    if (tabs.length === 0 || panels.length === 0) return;

    function activate(key: string): void {
        for (const tab of tabs) {
            const isActive = tab.dataset[toCamel(groupAttr)] === key;
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
        }
        for (const panel of panels) {
            const isActive = panel.dataset[toCamel(panelAttr)] === key;
            panel.hidden = !isActive;
        }
    }

    for (const tab of tabs) {
        tab.addEventListener("click", () => {
            const key = tab.dataset[toCamel(groupAttr)];
            if (key === undefined || key === "") return;
            activate(key);
        });
    }
}

// data-framework-panel → "frameworkPanel" (dataset keys are camelCase).
function toCamel(attr: string): string {
    return attr
        .replace(/^data-/, "")
        .replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

wireTabs("data-framework", "data-framework-panel");
wireTabs("data-install", "data-install-panel");

// Copy-to-clipboard buttons. Each carries `data-copy-target="<id>"`
// pointing at the <code> element whose textContent should be copied.
for (const btn of document.querySelectorAll<HTMLButtonElement>(".copy-btn")) {
    btn.addEventListener("click", async () => {
        const targetId = btn.dataset["copyTarget"];
        if (targetId === undefined || targetId === "") return;
        const target = document.getElementById(targetId);
        if (target === null) return;
        const text = target.textContent ?? "";
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // Clipboard API unavailable (http://, older browsers) — fall
            // back to the legacy execCommand path so the button still
            // works on the built site.
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand("copy");
            } finally {
                document.body.removeChild(ta);
            }
        }
        const original = btn.textContent ?? "Copy";
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        window.setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove("copied");
        }, 1600);
    });
}
