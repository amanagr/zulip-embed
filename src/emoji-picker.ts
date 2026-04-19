// A searchable, categorised emoji picker modeled on Zulip's own web
// picker. Data lives in emoji-data.ts so the dataset is easy to extend
// without touching picker logic.
//
// The picker is a singleton attached to a shadow root. Consumers call
// `open(anchor, onPick)` to show it; it closes on pick, Escape, or
// outside click. Positioning is dumb-but-useful: anchored near the
// clicked button, clamped to the shadow-root viewport.
//
// Recent picks are remembered in localStorage (per origin) so the
// first row feels personal after the first session. Failure to read
// or write localStorage is fine — the picker degrades to a default
// "recent" row and continues without persistence.

import {
    EMOJI_CATEGORIES,
    EMOJI_INDEX,
    searchEmojis,
    type EmojiCategory,
} from "./emoji-data.ts";

const RECENT_STORAGE_KEY = "zulip-embed:emoji-recent";
const RECENT_MAX = 16;
const DEFAULT_RECENTS = [
    "+1",
    "heart",
    "tada",
    "laughing",
    "eyes",
    "fire",
    "rocket",
    "check",
];

export interface EmojiPickerHandle {
    open(anchor: HTMLElement, onPick: (emojiName: string) => void): void;
    close(): void;
    isOpen(): boolean;
    // Returns the picker element for positioning / test inspection.
    element(): HTMLElement;
}

export function createEmojiPicker(
    shadow: ShadowRoot,
    container: HTMLElement,
): EmojiPickerHandle {
    const panel = document.createElement("div");
    panel.className = "emoji-picker";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Pick an emoji");
    panel.hidden = true;

    // Search row sits above everything so keyboard users land in a
    // predictable spot on open.
    const searchRow = document.createElement("div");
    searchRow.className = "emoji-picker-search-row";
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "emoji-picker-search";
    searchInput.setAttribute("aria-label", "Search emoji");
    searchInput.placeholder = "Search emoji…";
    searchRow.append(searchInput);
    panel.append(searchRow);

    // Category nav row — clicking a glyph scrolls the grid to that
    // category's header. A "recents" tab stays pinned on the left.
    const nav = document.createElement("div");
    nav.className = "emoji-picker-nav";
    nav.setAttribute("role", "tablist");
    panel.append(nav);

    const grid = document.createElement("div");
    grid.className = "emoji-picker-grid";
    panel.append(grid);

    const footer = document.createElement("div");
    footer.className = "emoji-picker-footer";
    footer.textContent = " ";
    panel.append(footer);

    let currentOnPick: ((emojiName: string) => void) | undefined;
    // Section header <-> scroll target map so clicking a category tab
    // jumps to the right slice of the grid.
    const sectionTops = new Map<string, HTMLElement>();
    let recents = loadRecents();

    buildNav();
    buildGrid();

    function buildNav(): void {
        nav.replaceChildren();
        const addTab = (id: string, label: string, icon: string): void => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "emoji-picker-tab";
            b.setAttribute("role", "tab");
            b.setAttribute("aria-label", label);
            b.title = label;
            b.dataset["category"] = id;
            b.textContent = icon;
            b.addEventListener("click", () => {
                const target = sectionTops.get(id);
                if (target !== undefined) {
                    // Smooth scroll would be nice, but jsdom doesn't
                    // implement it and the instant jump feels snappy.
                    grid.scrollTop = target.offsetTop - grid.offsetTop;
                }
            });
            nav.append(b);
        };
        addTab("recent", "Recently used", "🕑");
        for (const cat of EMOJI_CATEGORIES) addTab(cat.id, cat.label, cat.icon);
    }

    function buildGrid(): void {
        grid.replaceChildren();
        sectionTops.clear();
        // Recents section first; a non-category so it doesn't clash with
        // the real category IDs.
        const recentCat: EmojiCategory = {
            id: "people",
            label: "Recently used",
            icon: "🕑",
            emojis: recents.map((name) => {
                const hit = EMOJI_INDEX.find((e) => e.name === name);
                return hit ?? {name, glyph: `:${name}:`};
            }),
        };
        addSection("recent", "Recently used", recentCat.emojis);
        for (const cat of EMOJI_CATEGORIES) {
            addSection(cat.id, cat.label, cat.emojis);
        }
    }

    function addSection(
        id: string,
        label: string,
        entries: readonly {name: string; glyph: string}[],
    ): void {
        if (entries.length === 0) return;
        const heading = document.createElement("div");
        heading.className = "emoji-picker-heading";
        heading.textContent = label;
        grid.append(heading);
        sectionTops.set(id, heading);
        const section = document.createElement("div");
        section.className = "emoji-picker-section";
        for (const e of entries) section.append(buttonFor(e));
        grid.append(section);
    }

    function buttonFor(entry: {name: string; glyph: string}): HTMLButtonElement {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "emoji-picker-btn";
        btn.dataset["emojiName"] = entry.name;
        btn.setAttribute("aria-label", entry.name);
        btn.title = `:${entry.name}:`;
        btn.textContent = entry.glyph;
        btn.addEventListener("mouseenter", () => {
            footer.textContent = `:${entry.name}:`;
        });
        btn.addEventListener("focus", () => {
            footer.textContent = `:${entry.name}:`;
        });
        btn.addEventListener("click", (event) => {
            event.stopPropagation();
            const pick = currentOnPick;
            currentOnPick = undefined;
            bumpRecent(entry.name);
            close();
            pick?.(entry.name);
        });
        return btn;
    }

    function bumpRecent(name: string): void {
        const next = [name, ...recents.filter((n) => n !== name)].slice(0, RECENT_MAX);
        recents = next;
        persistRecents(next);
        // Rebuilding the grid after every pick is cheap (≤300 buttons)
        // and keeps the recents row accurate without extra wiring.
        buildGrid();
    }

    // Search: live-filter as the user types. When empty, restore the
    // full categorised grid.
    searchInput.addEventListener("input", () => {
        const q = searchInput.value;
        if (q.trim() === "") {
            buildGrid();
            return;
        }
        const hits = searchEmojis(q);
        grid.replaceChildren();
        sectionTops.clear();
        if (hits.length === 0) {
            const empty = document.createElement("div");
            empty.className = "emoji-picker-empty";
            empty.textContent = "No emoji match that search.";
            grid.append(empty);
            return;
        }
        const section = document.createElement("div");
        section.className = "emoji-picker-section";
        for (const e of hits) section.append(buttonFor(e));
        grid.append(section);
    });

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
    (shadow as unknown as EventTarget).addEventListener("keydown", keyHandler, {
        capture: true,
    });

    function open(anchor: HTMLElement, onPick: (emojiName: string) => void): void {
        currentOnPick = onPick;
        panel.hidden = false;
        searchInput.value = "";
        buildGrid();
        positionPanel(panel, anchor, container);
        // Focus the search input so keyboard users can start filtering
        // immediately. Tests that assert on the first button can still
        // query .emoji-picker-btn.
        requestAnimationFrame(() => searchInput.focus());
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

    function loadRecents(): string[] {
        try {
            const raw = globalThis.localStorage?.getItem(RECENT_STORAGE_KEY);
            if (raw === null || raw === undefined) return [...DEFAULT_RECENTS];
            const parsed = JSON.parse(raw);
            if (
                Array.isArray(parsed) &&
                parsed.every((x) => typeof x === "string")
            ) {
                return (parsed as string[]).slice(0, RECENT_MAX);
            }
        } catch {
            // fall through to defaults
        }
        return [...DEFAULT_RECENTS];
    }

    function persistRecents(next: string[]): void {
        try {
            globalThis.localStorage?.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
        } catch {
            // SafariPrivate + quota-exceeded etc. — persistence is
            // best-effort; the UI still works without it.
        }
    }
}

// Position the panel above the anchor when there's room, otherwise below.
// Coordinates are relative to `container` (a positioned ancestor) so the
// picker can use absolute positioning inside it.
function positionPanel(panel: HTMLElement, anchor: HTMLElement, container: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const top = anchorRect.top - containerRect.top;
    const left = anchorRect.left - containerRect.left;

    const panelWidth = panel.offsetWidth;
    const maxLeft = Math.max(4, containerRect.width - panelWidth - 4);
    panel.style.left = `${String(Math.min(maxLeft, Math.max(4, left)))}px`;

    const panelHeight = panel.offsetHeight;
    const above = top - panelHeight - 6;
    if (above >= 4) {
        panel.style.top = `${String(above)}px`;
    } else {
        const below = top + anchorRect.height + 6;
        const maxTop = Math.max(4, containerRect.height - panelHeight - 4);
        panel.style.top = `${String(Math.min(below, maxTop))}px`;
    }
}

// Re-export shared types so tests can assert on the picker surface
// without reaching into emoji-data directly.
export type {EmojiSearchEntry} from "./emoji-data.ts";
