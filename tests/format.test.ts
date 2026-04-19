import {describe, expect, test} from "vitest";

import {avatarColor, formatRelativeTime, getInitials} from "../src/format.ts";

describe("formatRelativeTime", () => {
    const now = 1_700_000_000_000;

    test('returns "just now" for sub-minute deltas', () => {
        expect(formatRelativeTime(now - 5_000, now)).toBe("just now");
    });

    test("pluralizes minutes", () => {
        expect(formatRelativeTime(now - 60_000, now)).toBe("1 min ago");
        expect(formatRelativeTime(now - 120_000, now)).toBe("2 mins ago");
    });

    test("pluralizes hours", () => {
        expect(formatRelativeTime(now - 60 * 60_000, now)).toBe("1 hour ago");
        expect(formatRelativeTime(now - 180 * 60_000, now)).toBe("3 hours ago");
    });

    test("pluralizes days", () => {
        const day = 24 * 60 * 60_000;
        expect(formatRelativeTime(now - day, now)).toBe("1 day ago");
        expect(formatRelativeTime(now - 2 * day, now)).toBe("2 days ago");
    });
});

describe("getInitials", () => {
    test("uses first and last initial", () => {
        expect(getInitials("Ada Lovelace")).toBe("AL");
    });

    test("handles single names", () => {
        expect(getInitials("Grace")).toBe("G");
    });

    test("handles extra whitespace", () => {
        expect(getInitials("  Alan   Turing  ")).toBe("AT");
    });

    test("handles empty input", () => {
        expect(getInitials("")).toBe("?");
    });
});

describe("avatarColor", () => {
    test("is deterministic for a seed", () => {
        expect(avatarColor(1)).toBe(avatarColor(1));
    });

    test("differs across seeds in the palette", () => {
        const seen = new Set<string>();
        for (let i = 0; i < 8; i++) seen.add(avatarColor(i));
        expect(seen.size).toBeGreaterThan(1);
    });
});
