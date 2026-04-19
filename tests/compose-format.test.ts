// Markdown helpers are pure DOM manipulation — no network, no transport.
// We exercise them through a real <textarea> so selection semantics
// match what the browser would produce at runtime.

import {beforeEach, describe, expect, test} from "vitest";

import {
    insertAtCursor,
    prefixLines,
    wrapCodeBlock,
    wrapLink,
    wrapSelection,
} from "../src/compose-format.ts";

function mkTextarea(
    value = "",
    selectionStart = value.length,
    selectionEnd = value.length,
): HTMLTextAreaElement {
    const ta = document.createElement("textarea");
    document.body.append(ta);
    ta.value = value;
    ta.focus();
    ta.setSelectionRange(selectionStart, selectionEnd);
    return ta;
}

describe("wrapSelection", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    test("wraps a non-empty selection and re-selects the body", () => {
        const ta = mkTextarea("hello world", 6, 11);
        wrapSelection(ta, "**", "**", "placeholder");
        expect(ta.value).toBe("hello **world**");
        expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe("world");
    });

    test("inserts placeholder when no selection", () => {
        const ta = mkTextarea("abc");
        wrapSelection(ta, "*", "*", "italic");
        expect(ta.value).toBe("abc*italic*");
        expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe("italic");
    });
});

describe("prefixLines", () => {
    test("prefixes a single line without any selection", () => {
        const ta = mkTextarea("hello");
        ta.setSelectionRange(2, 2);
        prefixLines(ta, "> ");
        expect(ta.value).toBe("> hello");
    });

    test("prefixes every line in a multi-line selection", () => {
        const ta = mkTextarea("a\nb\nc", 0, 5);
        prefixLines(ta, "- ");
        expect(ta.value).toBe("- a\n- b\n- c");
    });

    test("numbered list increments per line", () => {
        const ta = mkTextarea("x\ny\nz", 0, 5);
        prefixLines(ta, "1. ");
        expect(ta.value).toBe("1. x\n2. y\n3. z");
    });
});

describe("wrapCodeBlock", () => {
    test("single-line selection uses inline backticks", () => {
        const ta = mkTextarea("hello foo world", 6, 9);
        wrapCodeBlock(ta);
        expect(ta.value).toBe("hello `foo` world");
    });

    test("multi-line selection wraps with fenced block on its own lines", () => {
        const ta = mkTextarea("line1\nline2", 0, 11);
        wrapCodeBlock(ta);
        expect(ta.value).toBe("```\nline1\nline2\n```");
    });

    test("empty selection inserts an empty fenced block", () => {
        const ta = mkTextarea("");
        wrapCodeBlock(ta);
        expect(ta.value).toBe("```\n\n```");
    });
});

describe("wrapLink", () => {
    test("empty selection inserts the label/url template", () => {
        const ta = mkTextarea("");
        wrapLink(ta);
        expect(ta.value).toBe("[text](url)");
    });

    test("URL-looking selection becomes the href", () => {
        const ta = mkTextarea("see https://example.com for details", 4, 23);
        wrapLink(ta);
        expect(ta.value).toBe("see [](https://example.com) for details");
    });

    test("plain-word selection becomes the label", () => {
        const ta = mkTextarea("click here please", 6, 10);
        wrapLink(ta);
        expect(ta.value).toBe("click [here](url) please");
    });
});

describe("insertAtCursor", () => {
    test("inserts at the caret and leaves caret after the insertion", () => {
        const ta = mkTextarea("hello world", 5, 5);
        insertAtCursor(ta, "😀");
        expect(ta.value).toBe("hello😀 world");
        expect(ta.selectionStart).toBe(5 + "😀".length);
        expect(ta.selectionEnd).toBe(5 + "😀".length);
    });
});
