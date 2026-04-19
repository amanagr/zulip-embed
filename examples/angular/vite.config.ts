import {defineConfig} from "vite";
import angular from "@analogjs/vite-plugin-angular";

// Standard Angular + Vite config, using @analogjs/vite-plugin-angular to
// run the Angular compiler (ngtsc) inside Vite — no Angular CLI, no
// webpack, just the same Vite dev-server / Rollup build as the other
// examples in this folder.
//
// Unlike Vue's `isCustomElement`, Angular's template compiler does not
// warn on unknown tags at the Vite level — instead it _errors_ at the
// component level unless you tell it the unknown tag is a real DOM
// element. That's handled per-component via `CUSTOM_ELEMENTS_SCHEMA`
// (see `src/app/app.component.ts`), not here.
export default defineConfig({
    resolve: {
        mainFields: ["module"],
    },
    plugins: [angular()],
});
