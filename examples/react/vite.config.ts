import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";

// Standard React + Vite config.
// `zulip-embed-react` re-exports the Web Component's types and calls
// customElements.define() as a side effect on the first import, so
// nothing needs special-casing here.
export default defineConfig({
    plugins: [react()],
});
