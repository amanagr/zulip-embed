#!/usr/bin/env node
// Mirror the built bundle into site-src/public so Astro serves the
// widget at `${base}/zulip-embed.js` and its lazy chunks resolve
// under `${base}/chunks/`. The Astro head tag (astro.config.mjs)
// injects the script tag once per page, so the landing page + any
// docs page that drops `<zulip-chat>` into the markdown gets live
// hydration with no per-page wiring.
//
// Kept as a tiny vanilla-node script rather than a build plugin so
// the dependency graph for the docs site stays: `pnpm build` ->
// `scripts/sync-bundle-to-site.mjs` -> `astro build`. That ordering
// is enforced by the root `build:site` script in package.json.

import {cpSync, mkdirSync, readdirSync, rmSync, existsSync} from "node:fs";
import {join, dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PUBLIC = join(ROOT, "site-src", "public");

if (!existsSync(DIST)) {
    console.error("dist/ missing — run `pnpm build` first");
    process.exit(1);
}

mkdirSync(PUBLIC, {recursive: true});

// Wipe the prior mirror so deleted/rehashed chunks don't linger and
// confuse the module loader with stale references.
for (const name of readdirSync(PUBLIC)) {
    if (name === ".gitkeep") continue;
    rmSync(join(PUBLIC, name), {recursive: true, force: true});
}

// Copy the main bundle + all entry bundles + chunks. Source maps are
// included so browser devtools surface real filenames when debugging
// against the hosted site.
const ENTRIES = ["zulip-embed.js", "zulip-embed.js.map"];
for (const name of ENTRIES) {
    const src = join(DIST, name);
    if (existsSync(src)) cpSync(src, join(PUBLIC, name));
}

const CHUNKS_SRC = join(DIST, "chunks");
if (existsSync(CHUNKS_SRC)) {
    cpSync(CHUNKS_SRC, join(PUBLIC, "chunks"), {recursive: true});
}

// The per-subpath entry bundles let docs pages wire lighter imports
// (e.g. only the channel-list component on a channel-list doc page).
const ENTRIES_SRC = join(DIST, "entries");
if (existsSync(ENTRIES_SRC)) {
    cpSync(ENTRIES_SRC, join(PUBLIC, "entries"), {recursive: true});
}

console.log("synced dist → site-src/public");
