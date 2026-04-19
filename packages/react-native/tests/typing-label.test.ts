import {describe, expect, test} from "vitest";

import {formatTypingLabel} from "../src/typing-label.ts";

describe("formatTypingLabel", () => {
    test("returns undefined when nobody is typing (hides the row)", () => {
        expect(formatTypingLabel([])).toBeUndefined();
    });

    test("formats a single typist as 'X is typing'", () => {
        expect(formatTypingLabel([{userId: 1, fullName: "Alice"}])).toBe("Alice is typing");
    });

    test("formats two typists as 'X and Y are typing'", () => {
        expect(
            formatTypingLabel([
                {userId: 1, fullName: "Alice"},
                {userId: 2, fullName: "Bob"},
            ]),
        ).toBe("Alice and Bob are typing");
    });

    test("collapses three or more typists to the generic label", () => {
        expect(
            formatTypingLabel([
                {userId: 1, fullName: "Alice"},
                {userId: 2, fullName: "Bob"},
                {userId: 3, fullName: "Carol"},
            ]),
        ).toBe("Several people are typing");
    });

    test("trims whitespace from names before formatting", () => {
        expect(formatTypingLabel([{userId: 1, fullName: "  Alice  "}])).toBe("Alice is typing");
    });

    test("falls back to 'Someone is typing' when the only name is blank", () => {
        // Defensive: the server occasionally emits typing entries with
        // empty fullName (e.g. for deactivated accounts). The row should
        // still surface so the UI isn't silently dropping the signal.
        expect(formatTypingLabel([{userId: 1, fullName: "   "}])).toBe("Someone is typing");
    });
});
