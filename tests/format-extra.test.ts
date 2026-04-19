import {describe, expect, test} from "vitest";

import {avatarColor, formatRelativeTime, formatTimeOfDay, getInitials} from "../src/format.ts";

describe("formatTimeOfDay", () => {
    test("returns a non-empty string for a valid timestamp", () => {
        // The exact format is locale-dependent (jsdom defaults to
        // en-US). Pin only invariants: non-empty and contains a digit.
        const out = formatTimeOfDay(1_700_000_000_000);
        expect(out.length).toBeGreaterThan(0);
        expect(/\d/.test(out)).toBe(true);
    });

    test("different timestamps hours apart produce different outputs", () => {
        const a = formatTimeOfDay(1_700_000_000_000);
        const b = formatTimeOfDay(1_700_000_000_000 + 3 * 60 * 60 * 1000);
        expect(a).not.toBe(b);
    });
});

describe("formatRelativeTime — edge cases", () => {
    const now = 1_700_000_000_000;

    test("future timestamps (negative delta) still return 'just now'", () => {
        // A future timestamp would produce a negative delta. Current
        // behavior: it falls through the first branch and still
        // returns "just now" because the < MINUTE check passes for
        // negative values. Pin this so a future refactor that adds a
        // "in X min" branch makes a conscious choice.
        expect(formatRelativeTime(now + 30_000, now)).toBe("just now");
    });

    test("exactly at the minute boundary rolls to 1 min", () => {
        expect(formatRelativeTime(now - 60_000, now)).toBe("1 min ago");
    });

    test("exactly at the hour boundary rolls to 1 hour", () => {
        expect(formatRelativeTime(now - 60 * 60_000, now)).toBe("1 hour ago");
    });

    test("exactly at the day boundary rolls to 1 day", () => {
        expect(formatRelativeTime(now - 24 * 60 * 60_000, now)).toBe("1 day ago");
    });

    test("very old timestamps still format as N days ago", () => {
        const day = 24 * 60 * 60_000;
        expect(formatRelativeTime(now - 365 * day, now)).toBe("365 days ago");
    });
});

describe("getInitials — edge cases", () => {
    test("handles names with hyphens (treated as a single token)", () => {
        // The current implementation splits on whitespace, not
        // hyphens. Pin current behavior so the UI doesn't show "M-S"
        // for "Mary-Jane Smith" unexpectedly.
        expect(getInitials("Mary-Jane Smith")).toBe("MS");
    });

    test("handles unicode names", () => {
        expect(getInitials("Aigerim Жанбота")).toBe("AЖ");
    });

    test("handles only whitespace as empty", () => {
        expect(getInitials("   ")).toBe("?");
    });

    test("single-character name returns that character", () => {
        expect(getInitials("X")).toBe("X");
    });

    test("multiple middle names take only first + last", () => {
        expect(getInitials("Maria Anne Elizabeth Smith")).toBe("MS");
    });
});

describe("avatarColor — edge cases", () => {
    test("returns a gradient for negative seed (Math.abs guard)", () => {
        expect(avatarColor(-5)).toMatch(/^linear-gradient\(/);
    });

    test("returns a gradient for zero", () => {
        expect(avatarColor(0)).toMatch(/^linear-gradient\(/);
    });

    test("returns a gradient for very large seed", () => {
        expect(avatarColor(Number.MAX_SAFE_INTEGER)).toMatch(/^linear-gradient\(/);
    });

    test("hue palette wraps modulo the bucket count", () => {
        // seeds n and n+buckets should yield identical gradients;
        // pin by sampling 36 seeds and confirming at most 12 distinct
        // values.
        const colors = new Set<string>();
        for (let i = 0; i < 36; i++) colors.add(avatarColor(i));
        expect(colors.size).toBeLessThanOrEqual(12);
    });
});
