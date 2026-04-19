import {resolve} from "node:path";
import {defineConfig} from "vite";
import dts from "vite-plugin-dts";

const MODE_SITE = "site";

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

    return {
        build: {
            lib: {
                entry: resolve(import.meta.dirname, "src/index.ts"),
                name: "ZulipEmbed",
                fileName: (format) => {
                    if (format === "es") return "zulip-embed.js";
                    if (format === "iife") return "zulip-embed.iife.js";
                    return `zulip-embed.${format}.js`;
                },
                formats: ["es", "iife"],
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
