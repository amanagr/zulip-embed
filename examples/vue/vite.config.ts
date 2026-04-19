import {defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";

// Standard Vue 3 + Vite config.
//
// The `isCustomElement` option tells Vue's template compiler that any tag
// starting with `zulip-` is a Web Component, not a Vue component. Without
// this, Vue logs a noisy "Failed to resolve component" warning in dev for
// every <zulip-chat>, <zulip-channel-list>, etc. It does not affect
// rendering — Vue always renders unknown tags as-is, so the component
// still works without this flag. But a clean dev console is worth the
// two lines.
export default defineConfig({
    plugins: [
        vue({
            template: {
                compilerOptions: {
                    isCustomElement: (tag) => tag.startsWith("zulip-"),
                },
            },
        }),
    ],
});
