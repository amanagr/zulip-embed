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
// The plan's final targets (chat ≤72 / channel-list ≤20 / topic-list
// ≤15) assume #10d has landed: DemoTransport + SnapshotTransport are
// dynamic-imported from component.ts / channel-list.ts / topic-list.ts
// so they don't sit in the base chunk of every UI entry. Until that
// work ships, channel-list and topic-list pull the 24 KB demo chunk
// into their closure via Rollup's entry-sharing. The budgets below
// reflect *today's* state with a small headroom so CI actually fails
// on regression; tighten to the final targets in the #10d commit.
const BUDGETS = {
    "entries/chat.js": 72 * 1024,
    "entries/channel-list.js": 36 * 1024, // target 20 after #10d
    "entries/topic-list.js": 36 * 1024, // target 15 after #10d
    "entries/agent.js": 15 * 1024,
    "entries/demo.js": 30 * 1024,
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
