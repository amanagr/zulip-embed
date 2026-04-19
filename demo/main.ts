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
