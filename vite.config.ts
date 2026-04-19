import {resolve} from "node:path";
import {defineConfig, type LibraryFormats} from "vite";
import dts from "vite-plugin-dts";

const MODE_SITE = "site";
const FORMAT_IIFE = "iife";

// Build layout:
//   - Default invocation emits an ESM multi-entry bundle. The root
//     `zulip-embed.js` is the back-compat "registers everything" shim
//     consumed by the `.` and `./all` subpaths. The `entries/*.js`
//     outputs each register exactly one custom element (or, for agent /
//     demo, expose a framework-agnostic helper with no DOM side effect).
//   - VITE_FORMAT=iife runs a second pass that emits the single
//     `zulip-embed.iife.js` bundle used by the unpkg script tag. Has to
//     be its own pass because Vite's lib mode rejects `iife` alongside
//     multi-entry `rollupOptions.input`.
//   - VITE_MODE=site builds the demo landing page as usual.

export default defineConfig(() => {
    if (process.env["VITE_MODE"] === MODE_SITE) {
        return {
            root: resolve(import.meta.dirname, "demo"),
            base: process.env["VITE_BASE"] ?? "./",
            build: {
                outDir: resolve(import.meta.dirname, "site"),
                emptyOutDir: true,
                sourcemap: true,
                target: "es2022",
            },
        };
    }

    if (process.env["VITE_FORMAT"] === FORMAT_IIFE) {
        return {
            build: {
                lib: {
                    entry: resolve(import.meta.dirname, "src/index.ts"),
                    name: "ZulipEmbed",
                    fileName: () => "zulip-embed.iife.js",
                    formats: ["iife"] satisfies LibraryFormats[],
                },
                sourcemap: true,
                target: "es2022",
                outDir: "dist",
                // Second pass: preserve the ESM artifacts emitted above.
                emptyOutDir: false,
            },
        };
    }

    return {
        build: {
            rollupOptions: {
                input: {
                    "zulip-embed": resolve(import.meta.dirname, "src/index.ts"),
                    "entries/chat": resolve(import.meta.dirname, "src/entries/chat.ts"),
                    "entries/channel-list": resolve(
                        import.meta.dirname,
                        "src/entries/channel-list.ts",
                    ),
                    "entries/topic-list": resolve(
                        import.meta.dirname,
                        "src/entries/topic-list.ts",
                    ),
                    "entries/agent": resolve(import.meta.dirname, "src/entries/agent.ts"),
                    "entries/demo": resolve(import.meta.dirname, "src/entries/demo.ts"),
                },
                output: {
                    format: "es" as const,
                    entryFileNames: "[name].js",
                    chunkFileNames: "chunks/[name]-[hash].js",
                    // Shared code (component.ts, transports, types) naturally
                    // lifts into chunks/ — size-budget script counts the
                    // transitive graph, not the entry file alone.
                },
            },
            sourcemap: true,
            target: "es2022",
            outDir: "dist",
            emptyOutDir: true,
        },
        plugins: [
            dts({
                include: ["src/**/*.ts"],
                rollupTypes: true,
                outDir: "dist",
            }),
        ],
        server: {
            open: "/demo/index.html",
            port: 5173,
        },
    };
});
