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
const emailInput = requireElement<HTMLInputElement>("#email");
const apiKeyInput = requireElement<HTMLInputElement>("#api-key");
const channelInput = requireElement<HTMLInputElement>("#channel");
const topicInput = requireElement<HTMLInputElement>("#topic");
const themeSelect = requireElement<HTMLSelectElement>("#theme");

connectButton.addEventListener("click", () => {
    const server = serverInput.value.trim();
    const email = emailInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const channel = channelInput.value.trim() || "general";
    const topic = topicInput.value.trim();
    const theme = themeSelect.value;

    if (server === "" || email === "" || apiKey === "") {
        live.setAttribute("demo", "");
        live.removeAttribute("server");
        live.removeAttribute("email");
        live.removeAttribute("api-key");
    } else {
        live.removeAttribute("demo");
        live.setAttribute("server", server);
        live.setAttribute("email", email);
        live.setAttribute("api-key", apiKey);
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
            `  email="you@example.com"`,
            `  api-key="..."`,
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
