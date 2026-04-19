// A small curated emoji picker panel. v0.1 scope: no search, no categories,
// no full Unicode table — just the same short list the renderer already
// uses for demo reactions, kept in sync via EMOJI_GLYPHS_DOT_
//
// The picker is a singleton attached to a shadow root. Consumers call
// `open(anchor, onPick)` to show it; it closes on pick, Escape, or
// outside click. Positioning is dumb-but-useful: anchored under the
// clicked button, clamped to the shadow-root viewport.

import {EMOJI_GLYPHS} from "./render.ts";

// Curated order — reactions that actually show up in chat, ordered by
// rough frequency so the common ones are in the first row. Each entry
// maps a display glyph to the Zulip emoji name we send to the server.
function glyphOf(name: string, fallback: string): string {
    return EMOJI_GLYPHS[name] ?? fallback;
}

const CURATED: {name: string; glyph: string}[] = [
    {name: "+1", glyph: glyphOf("+1", "👍")},
    {name: "-1", glyph: glyphOf("-1", "👎")},
    {name: "tada", glyph: glyphOf("tada", "🎉")},
    {name: "heart", glyph: glyphOf("heart", "❤️")},
    {name: "smile", glyph: glyphOf("smile", "😄")},
    {name: "laughing", glyph: glyphOf("laughing", "😂")},
    {name: "thinking", glyph: glyphOf("thinking", "🤔")},
    {name: "eyes", glyph: glyphOf("eyes", "👀")},
    {name: "fire", glyph: glyphOf("fire", "🔥")},
    {name: "rocket", glyph: glyphOf("rocket", "🚀")},
    {name: "check", glyph: glyphOf("check", "✅")},
    {name: "party", glyph: glyphOf("party", "🥳")},
    {name: "wave", glyph: glyphOf("wave", "👋")},
    {name: "pray", glyph: glyphOf("pray", "🙏")},
    {name: "clap", glyph: glyphOf("clap", "👏")},
    {name: "bug", glyph: glyphOf("bug", "🐛")},
    {name: "sparkles", glyph: glyphOf("sparkles", "✨")},
    {name: "octopus", glyph: glyphOf("octopus", "🐙")},
];

export interface EmojiPickerHandle {
    open(anchor: HTMLElement, onPick: (emojiName: string) => void): void;
    close(): void;
    isOpen(): boolean;
    // Returns the picker element for positioning / test inspection.
    element(): HTMLElement;
}

// Build and install the picker inside `container` (a positioned element
// within the shadow root). Called once per component; the returned
// handle is how the component drives it.
export function createEmojiPicker(
    shadow: ShadowRoot,
    container: HTMLElement,
): EmojiPickerHandle {
    const panel = document.createElement("div");
    panel.className = "emoji-picker";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Pick a reaction");
    panel.hidden = true;

    const grid = document.createElement("div");
    grid.className = "emoji-picker-grid";
    panel.append(grid);

    let currentOnPick: ((emojiName: string) => void) | undefined;

    // Build buttons once and keep them across opens; nothing about the
    // curated list is per-message, so reusing the grid saves layout work.
    for (const {name, glyph} of CURATED) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "emoji-picker-btn";
        btn.dataset["emojiName"] = name;
        btn.setAttribute("aria-label", name);
        btn.title = `:${name}:`;
        btn.textContent = glyph;
        btn.addEventListener("click", (event) => {
            event.stopPropagation();
            const pick = currentOnPick;
            currentOnPick = undefined;
            close();
            pick?.(name);
        });
        grid.append(btn);
    }

    // Clicking outside the panel should dismiss it. Use a capturing
    // listener on the shadow root so it fires even when a message click
    // would otherwise stop propagation.
    const outsideHandler = (event: Event): void => {
        if (panel.hidden) return;
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (panel.contains(target)) return;
        close();
    };

    const keyHandler = (event: Event): void => {
        if (panel.hidden) return;
        if (!(event instanceof KeyboardEvent)) return;
        if (event.key === "Escape") {
            event.preventDefault();
            close();
        }
    };

    shadow.addEventListener("click", outsideHandler, {capture: true});
    // ShadowRoot's typings only surface "slotchange" on the typed overload,
    // but at runtime it's a full EventTarget — the host element bubbles
    // keystrokes into it just like any DOM node.
    (shadow as unknown as EventTarget).addEventListener("keydown", keyHandler, {
        capture: true,
    });

    function open(anchor: HTMLElement, onPick: (emojiName: string) => void): void {
        currentOnPick = onPick;
        panel.hidden = false;
        positionPanel(panel, anchor, container);
        // Focus the first button for keyboard users.
        const first = panel.querySelector<HTMLButtonElement>(".emoji-picker-btn");
        first?.focus();
    }

    function close(): void {
        if (panel.hidden) return;
        panel.hidden = true;
        currentOnPick = undefined;
    }

    function isOpen(): boolean {
        return !panel.hidden;
    }

    container.append(panel);
    return {open, close, isOpen, element: () => panel};
}

// Position the panel above the anchor when there's room, otherwise below.
// Coordinates are relative to `container` (a positioned ancestor) so the
// picker can use absolute positioning inside it.
function positionPanel(panel: HTMLElement, anchor: HTMLElement, container: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const top = anchorRect.top - containerRect.top;
    const left = anchorRect.left - containerRect.left;

    // Default: above the anchor, aligned to its left edge. Clamp so the
    // panel doesn't hang off the right side of the container.
    const panelWidth = panel.offsetWidth;
    const maxLeft = Math.max(4, containerRect.width - panelWidth - 4);
    panel.style.left = `${String(Math.min(maxLeft, Math.max(4, left)))}px`;

    // Measure after making it visible so height is valid.
    const panelHeight = panel.offsetHeight;
    const above = top - panelHeight - 6;
    if (above >= 4) {
        panel.style.top = `${String(above)}px`;
    } else {
        // Fall back to below when the anchor is near the top of the feed.
        const below = top + anchorRect.height + 6;
        const maxTop = Math.max(4, containerRect.height - panelHeight - 4);
        panel.style.top = `${String(Math.min(below, maxTop))}px`;
    }
}
