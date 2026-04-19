import {defineConfig} from "vite";
import {svelte} from "@sveltejs/vite-plugin-svelte";

// Standard Svelte 5 + Vite config.
//
// Svelte's compiler treats any unknown tag as a plain DOM element and
// emits no warning, so Web Components like <zulip-chat> work out of
// the box — no `isCustomElement` flag, no config toggles.
export default defineConfig({
    plugins: [svelte()],
});
