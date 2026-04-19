// Regenerates src/emoji-glyphs.ts from EMOJI_CATEGORIES.
//
// The renderer (reaction pills, inline :name: → glyph) lives in the main
// bundle and only needs a flat {name: glyph} map. Deriving that map at
// runtime from EMOJI_CATEGORIES would pin the whole keyword-rich picker
// dataset into the main chunk — ~10 KB of gzipped metadata we don't
// need. Instead, we check in a static literal in emoji-glyphs.ts so
// Rollup can tree-shake EMOJI_CATEGORIES out of the renderer graph.
//
// Usage: `node scripts/regen-emoji-glyphs.mjs`. Run whenever emoji-data
// adds or removes entries. A matching test asserts both representations
// stay in sync.

import {writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {EMOJI_CATEGORIES} from "../src/emoji-data.ts";

const pairs = [];
for (const cat of EMOJI_CATEGORIES) {
    for (const entry of cat.emojis) {
        pairs.push([entry.name, entry.glyph]);
    }
}
pairs.sort(([a], [b]) => a.localeCompare(b));

const lines = [
    "// GENERATED — do not edit by hand. Run `node scripts/regen-emoji-glyphs.mjs`",
    "// to refresh from src/emoji-data.ts (EMOJI_CATEGORIES).",
    "//",
    "// This file exists so the message renderer can look up a glyph for a",
    "// given Zulip emoji name without importing the keyword-rich picker",
    "// dataset. Keeping the map literal (not a runtime-derived IIFE) lets",
    "// the bundler tree-shake EMOJI_CATEGORIES out of the main chunk when",
    "// only the picker pulls it in.",
    "",
    "export const EMOJI_GLYPH_BY_NAME: Readonly<Record<string, string>> = Object.freeze({",
];
for (const [name, glyph] of pairs) {
    lines.push(`    ${JSON.stringify(name)}: ${JSON.stringify(glyph)},`);
}
lines.push("});");
lines.push("");

const out = resolve(import.meta.dirname, "..", "src", "emoji-glyphs.ts");
writeFileSync(out, lines.join("\n"));
console.log(`Wrote ${pairs.length} entries to ${out}`);
