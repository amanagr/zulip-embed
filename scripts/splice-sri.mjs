// Splice the freshly-generated SRI table from `dist/INTEGRITY.md` into
// the README between `<!-- sri:start -->` and `<!-- sri:end -->`
// markers. Called by .github/workflows/release.yml on tag push.
//
// Safe to run locally for a dry-run: it just rewrites README.md in
// place, and the CI step only commits if `git diff` shows a change.
//
// Exits non-zero if either marker is missing so a rename accidentally
// breaking the automation surfaces loudly in CI rather than silently
// dropping the update.

import {readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const readmePath = resolve(ROOT, "README.md");
const mdPath = resolve(ROOT, "dist", "INTEGRITY.md");

const readme = readFileSync(readmePath, "utf8");
const md = readFileSync(mdPath, "utf8").trim();

const start = "<!-- sri:start -->";
const end = "<!-- sri:end -->";

const startIdx = readme.indexOf(start);
const endIdx = readme.indexOf(end);
if (startIdx === -1 || endIdx === -1) {
    console.error("splice-sri.mjs: README.md is missing the sri:start / sri:end markers.");
    process.exit(1);
}
if (endIdx < startIdx) {
    console.error("splice-sri.mjs: sri:end precedes sri:start — markers are mis-ordered.");
    process.exit(1);
}

const before = readme.slice(0, startIdx + start.length);
const after = readme.slice(endIdx);
const spliced = `${before}\n\n${md}\n\n${after}`;
writeFileSync(readmePath, spliced);
console.log(`splice-sri.mjs: README.md updated from ${mdPath}`);
