// Markdown formatting helpers for the composer toolbar.
//
// All operations act on a <textarea> by manipulating `value` and
// selection indices, so browsers keep the undo stack intact and screen
// readers pick up the edit as a single action. The behaviour mirrors
// what Zulip's web composer does:
//
// - Wrap: if text is selected, wrap it with `before`/`after`; otherwise
//   insert the tokens empty and place the cursor between them.
// - Prefix lines: prepend `prefix` to every line in the selection (or
//   to the line containing the cursor) — used for `>` (quote), `- `
//   (bullet), `1. ` (numbered).
// - Insert at cursor: push text at the caret, then move the selection
//   to the end of the insertion.

export function wrapSelection(
    textarea: HTMLTextAreaElement,
    before: string,
    after: string,
    placeholder: string = "",
): void {
    const {value, selectionStart, selectionEnd} = textarea;
    const selected = value.slice(selectionStart, selectionEnd);
    const body = selected === "" ? placeholder : selected;
    const next = value.slice(0, selectionStart) + before + body + after + value.slice(selectionEnd);
    textarea.value = next;
    const selStart = selectionStart + before.length;
    const selEnd = selStart + body.length;
    textarea.setSelectionRange(selStart, selEnd);
    textarea.dispatchEvent(new Event("input", {bubbles: true}));
    textarea.focus();
}

export function insertAtCursor(textarea: HTMLTextAreaElement, text: string): void {
    const {value, selectionStart, selectionEnd} = textarea;
    const next = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
    textarea.value = next;
    const cursor = selectionStart + text.length;
    textarea.setSelectionRange(cursor, cursor);
    textarea.dispatchEvent(new Event("input", {bubbles: true}));
    textarea.focus();
}

// Prefix every line that intersects the current selection with `prefix`.
// Handles the subtle case of a single-line selection (most common: a user
// clicked a button with no selection — we still want the prefix applied
// to the current line). Returns the selection updated to still cover the
// same text region after the prefixes were added.
export function prefixLines(textarea: HTMLTextAreaElement, prefix: string): void {
    const {value, selectionStart, selectionEnd} = textarea;
    // Expand selection to the beginning of the first line and the end of
    // the last line so we rewrite full lines.
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const lineEndRaw = value.indexOf("\n", selectionEnd);
    const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const rewritten = lines
        .map((line, i) => {
            // For numbered lists, increment the counter per line.
            if (prefix === "1. ") return `${String(i + 1)}. ${line}`;
            return prefix + line;
        })
        .join("\n");
    const next = value.slice(0, lineStart) + rewritten + value.slice(lineEnd);
    textarea.value = next;
    const delta = rewritten.length - block.length;
    textarea.setSelectionRange(selectionStart + prefix.length, selectionEnd + delta);
    textarea.dispatchEvent(new Event("input", {bubbles: true}));
    textarea.focus();
}

// Insert a fenced code block around the selection. Multi-line wraps the
// selection in ```…``` on its own lines; single-line falls back to
// inline `backticks` so users don't accidentally turn one-liners into
// empty code blocks.
export function wrapCodeBlock(textarea: HTMLTextAreaElement): void {
    const {value, selectionStart, selectionEnd} = textarea;
    const selected = value.slice(selectionStart, selectionEnd);
    if (selected.includes("\n") || selected === "") {
        const leadingNewline =
            selectionStart === 0 || value[selectionStart - 1] === "\n" ? "" : "\n";
        const trailingNewline =
            selectionEnd === value.length || value[selectionEnd] === "\n" ? "" : "\n";
        const body = selected === "" ? "" : selected;
        const before = `${leadingNewline}\`\`\`\n`;
        const after = `\n\`\`\`${trailingNewline}`;
        wrapSelection(textarea, before, after, body);
        return;
    }
    wrapSelection(textarea, "`", "`", selected);
}

export function wrapLink(textarea: HTMLTextAreaElement): void {
    const {value, selectionStart, selectionEnd} = textarea;
    const selected = value.slice(selectionStart, selectionEnd);
    if (selected === "") {
        wrapSelection(textarea, "[", "](url)", "text");
    } else if (/^https?:\/\//.test(selected)) {
        // Selection looks like a URL — make it the href, leave the label
        // slot empty so the cursor lands in the right place for the user
        // to type a description.
        const next =
            value.slice(0, selectionStart) + `[](${selected})` + value.slice(selectionEnd);
        textarea.value = next;
        textarea.setSelectionRange(selectionStart + 1, selectionStart + 1);
        textarea.dispatchEvent(new Event("input", {bubbles: true}));
        textarea.focus();
    } else {
        wrapSelection(textarea, "[", "](url)", selected);
    }
}
