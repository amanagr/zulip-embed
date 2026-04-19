import {resolve} from "node:path";
import {defineConfig, type LibraryFormats} from "vite";
import dts from "vite-plugin-dts";

const MODE_SITE = "site";
const FORMAT_IIFE = "iife";

// Matches the specifier in `from '…'`, `from "…"`, and `import('…')`
// when the specifier starts with `./` or `../` and ends with `.ts`.
// Captures:
//   1: `from ` or `import(` prefix (incl. any whitespace)
//   2: the opening quote character
//   3: the specifier body (without the `.ts` suffix)
// The trailing quote is matched via backreference to group 2.
//
// We rewrite `.ts` -> `.js` (not strip entirely) so the emitted
// declarations resolve under `moduleResolution: "node16"` /
// `"nodenext"`, which require explicit extensions on relative
// imports in `.d.ts` files. TypeScript matches the `.js` specifier
// to the colocated `.d.ts` — the physical `.js` need not exist at
// that path. Under `"bundler"` resolution this also works fine.
const TS_EXT_IN_RELATIVE_SPECIFIER =
    /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]*?)\.ts\2/g;

function rewriteTsExtensionsInDts(content: string): string {
    return content.replace(
        TS_EXT_IN_RELATIVE_SPECIFIER,
        (_match, prefix: string, quote: string, specifier: string) =>
            `${prefix}${quote}${specifier}.js${quote}`,
    );
}

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
                    "entries/dm-list": resolve(import.meta.dirname, "src/entries/dm-list.ts"),
                    "entries/topic-list": resolve(
                        import.meta.dirname,
                        "src/entries/topic-list.ts",
                    ),
                    "entries/agent": resolve(import.meta.dirname, "src/entries/agent.ts"),
                    "entries/announcement": resolve(
                        import.meta.dirname,
                        "src/entries/announcement.ts",
                    ),
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
                // Without this, Rollup treats the `zulip-embed` entry's
                // re-exports (`export { DemoTransport } from …`) as
                // unused and strips them, leaving consumers with a
                // side-effect-only shim. `strict` keeps every declared
                // export in the emitted entry file.
                preserveEntrySignatures: "strict" as const,
            },
            sourcemap: true,
            target: "es2022",
            outDir: "dist",
            emptyOutDir: true,
        },
        plugins: [
            dts({
                include: ["src/**/*.ts"],
                // rollupTypes was dropped when we went multi-entry: the
                // rolled output placed some bundled .d.ts files at
                // dist/<name>.d.ts and left channel-list / topic-list
                // without a top-level rollup. Emit per-file .d.ts
                // mirroring src/ instead — subpath types resolve
                // cleanly via relative imports and the tree matches
                // what tsc would produce standalone.
                outDir: "dist",
                // Rewrite `.ts` -> `.js` on relative import specifiers
                // in emitted declarations. Source files use `.ts`
                // extensions (allowImportingTsExtensions, required by
                // moduleResolution: "bundler"), but the plugin passes
                // those paths through verbatim — and downstream
                // consumers on moduleResolution "node16" / "nodenext"
                // reject `from './foo.ts'` in `.d.ts` inputs. See
                // rewriteTsExtensionsInDts above for the rationale on
                // the `.js` target.
                beforeWriteFile: (filePath, content) =>
                    filePath.endsWith(".d.ts")
                        ? {content: rewriteTsExtensionsInDts(content)}
                        : undefined,
            }),
        ],
        server: {
            open: "/demo/index.html",
            port: 5173,
        },
    };
});
