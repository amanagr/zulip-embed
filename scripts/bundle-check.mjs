// Fail CI if any subpath entry's transitive gzipped size exceeds its
// per-entry budget. Runs on the dist/ output after `pnpm build`.
//
// Why transitive: the emitted entries/*.js files are tiny (a few
// hundred bytes) because Rollup lifts shared code into chunks/. The
// budget needs to count what a browser actually fetches, so we walk
// each entry's static import graph and sum gzipped sizes.

import {readFileSync} from "node:fs";
import {dirname, relative, resolve} from "node:path";
import {gzipSync} from "node:zlib";

const DIST = resolve(import.meta.dirname, "..", "dist");

// Budgets from V1_PLAN.md §10 ("Bundle surgery"). Size in bytes of the
// gzipped transitive closure per subpath entry.
//
// These measure only the STATIC relative-import graph. Dynamic imports
// (e.g. the ZulipTransport / DemoTransport / SnapshotTransport /
// emoji-picker chunks the UI entries pull via `import()` at runtime)
// are intentionally excluded — they split into separate chunks and a
// browser only fetches them when that code path actually runs.
//
// Ratchet policy: pick a number just above today's measurement so CI
// fails on regression. Tighten whenever a real improvement lands.
const BUDGETS = {
    // chat and announcement both pull render.ts, which ships the flat
    // EMOJI_GLYPH_BY_NAME map so reaction pills render their glyph
    // instead of literal ":name:" text. That map costs ~7 KB gzipped;
    // the older 60/20 KB caps predate the fix, when renderer only knew
    // ~20 alias glyphs. Tightened just above current measurement so
    // real regressions still fail CI.
    "entries/chat.js": 62 * 1024,
    "entries/channel-list.js": 8 * 1024,
    "entries/dm-list.js": 10 * 1024,
    "entries/topic-list.js": 8 * 1024,
    "entries/agent.js": 5 * 1024,
    "entries/announcement.js": 23 * 1024,
    "entries/demo.js": 28 * 1024,
};

function gzippedSize(path) {
    return gzipSync(readFileSync(path)).length;
}

// Walk `from "…"` and `import "…"` specifiers. Good enough for our
// generated ESM chunks, which never use dynamic import() and never
// import non-relative paths at this stage.
const IMPORT_SPECIFIER = /\b(?:from|import)\s*["']([^"']+)["']/g;

function transitiveFiles(entryPath) {
    const seen = new Set();
    const stack = [entryPath];
    while (stack.length > 0) {
        const current = stack.pop();
        if (seen.has(current)) continue;
        seen.add(current);
        const src = readFileSync(current, "utf8");
        for (const match of src.matchAll(IMPORT_SPECIFIER)) {
            const specifier = match[1];
            // Skip bare specifiers (e.g. bundled deps that vite left
            // externalized, if any). Only follow relative paths.
            if (!specifier.startsWith(".")) continue;
            const resolved = resolve(dirname(current), specifier);
            if (resolved.endsWith(".js")) {
                stack.push(resolved);
            }
        }
    }
    return [...seen];
}

function format(bytes) {
    return `${(bytes / 1024).toFixed(1)} KB`;
}

let exceeded = 0;
const rows = [];
for (const [rel, budget] of Object.entries(BUDGETS)) {
    const entry = resolve(DIST, rel);
    const files = transitiveFiles(entry);
    const total = files.reduce((sum, f) => sum + gzippedSize(f), 0);
    const pct = Math.round((total / budget) * 100);
    const ok = total <= budget;
    if (!ok) exceeded += 1;
    rows.push({rel, total, budget, pct, ok, files});
}

const headerMark = " ";
const headerName = "entry".padEnd(30);
const headerSize = "gzip".padStart(10);
const headerBudget = "budget".padStart(10);
const headerPct = "pct".padStart(6);
console.log(`${headerMark} ${headerName} ${headerSize} ${headerBudget} ${headerPct}  files`);
console.log("-".repeat(78));
for (const row of rows) {
    const mark = row.ok ? "OK" : "XX";
    console.log(
        `${mark.padEnd(2)} ${row.rel.padEnd(30)} ${format(row.total).padStart(10)} ${format(
            row.budget,
        ).padStart(10)} ${`${row.pct}%`.padStart(6)}  ${row.files.length}`,
    );
}

if (process.env["BUNDLE_CHECK_VERBOSE"] === "1") {
    console.log();
    for (const row of rows) {
        console.log(`\n${row.rel} transitive graph:`);
        for (const file of row.files) {
            const size = gzippedSize(file);
            console.log(`  ${format(size).padStart(10)}  ${relative(DIST, file)}`);
        }
    }
}

if (exceeded > 0) {
    console.error(`\n${exceeded} entr${exceeded === 1 ? "y" : "ies"} exceeded budget.`);
    process.exit(1);
}
