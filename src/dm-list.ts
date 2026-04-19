// <zulip-dm-list> — sidebar element that surfaces the viewer's recent
// direct-message conversations. Mirrors <zulip-channel-list>: same
// lifecycle (transport ctor per fetch, monotonic load token, dynamic
// imports to keep the default entry small), same dispatched event shape
// (one CustomEvent per click), same theming tokens.
//
// Transports that don't implement `listDirectMessageConversations` (old
// SnapshotTransports pointed at a channel-only snapshot) render an empty
// "No direct messages" state rather than throwing — this keeps the
// element safe to drop next to <zulip-channel-list> without conditional
// mounting logic on the host side.

import type {DirectMessageConversation, Transport} from "./transport.ts";
import type {ScopeFilter, User} from "./types.ts";

const OBSERVED_ATTRIBUTES = [
    "demo",
    "snapshot-url",
    "server",
    "auth-token",
    "theme",
] as const;

const REINIT_ATTRIBUTES: ReadonlySet<string> = new Set([
    "demo",
    "snapshot-url",
    "server",
    "auth-token",
]);

// Minimal styles, mirroring channel-list. Kept inline so the element
// works without the host stylesheet and stays self-contained.
const LIST_STYLES = `
:host {
    --zc-font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --zc-font-size: 14px;
    --zc-radius: 12px;
    --zc-radius-sm: 6px;
    --zc-spacing-xs: 4px;
    --zc-spacing-sm: 8px;
    --zc-spacing-md: 12px;
    --zc-spacing-lg: 16px;
    --zc-color-bg: #ffffff;
    --zc-color-surface: #f7f7f9;
    --zc-color-border: #e5e7eb;
    --zc-color-text: #111827;
    --zc-color-muted: #6b7280;
    --zc-color-accent: #6172f3;
    --zc-color-accent-contrast: #ffffff;

    display: block;
    font-family: var(--zc-font-family);
    font-size: var(--zc-font-size);
    color: var(--zc-color-text);
    box-sizing: border-box;
}

:host([theme="dark"]) {
    --zc-color-bg: #111827;
    --zc-color-surface: #1f2937;
    --zc-color-border: #374151;
    --zc-color-text: #f9fafb;
    --zc-color-muted: #9ca3af;
    --zc-color-accent: #818cf8;
}

*,
*::before,
*::after {
    box-sizing: inherit;
}

button {
    font: inherit;
    color: inherit;
    cursor: pointer;
}

.root {
    background: var(--zc-color-bg);
    border: 1px solid var(--zc-color-border);
    border-radius: var(--zc-radius);
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    overflow-y: auto;
    max-height: 100%;
}

.item {
    display: flex;
    align-items: center;
    gap: var(--zc-spacing-sm);
    width: 100%;
    padding: 6px var(--zc-spacing-md);
    border: none;
    background: transparent;
    color: inherit;
    text-align: left;
    font: inherit;
    cursor: pointer;
    border-radius: 0;
    transition: background 120ms ease;
}

.item:hover,
.item:focus-visible {
    background: var(--zc-color-surface);
    outline: none;
}

.avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--zc-color-surface);
    color: var(--zc-color-muted);
    font-size: 11px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
}

.avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.time {
    color: var(--zc-color-muted);
    font-size: 11px;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
}

.status {
    padding: var(--zc-spacing-md);
    color: var(--zc-color-muted);
    font-size: 13px;
    text-align: center;
}

.error {
    padding: var(--zc-spacing-sm) var(--zc-spacing-md);
    background: #fee2e2;
    color: #991b1b;
    font-size: 12px;
    border-bottom: 1px solid #fecaca;
}

:host([theme="dark"]) .error {
    background: #7f1d1d;
    color: #fecaca;
    border-bottom-color: #991b1b;
}
`;

export class ZulipDmListElement extends HTMLElement {
    static readonly observedAttributes = OBSERVED_ATTRIBUTES;

    private readonly shadow: ShadowRoot;
    private listEl: HTMLElement | undefined;
    private statusEl: HTMLElement | undefined;
    private errorEl: HTMLElement | undefined;
    private attachedToDom = false;
    // Monotonic token — same pattern as channel-list/topic-list. Any
    // bootstrapping async work checks this against the live counter so
    // a stale fetch can't overwrite a newer render.
    private loadToken = 0;

    constructor() {
        super();
        this.shadow = this.attachShadow({mode: "open"});
    }

    connectedCallback(): void {
        this.attachedToDom = true;
        this.buildTemplate();
        void this.fetchConversations();
    }

    disconnectedCallback(): void {
        this.attachedToDom = false;
        this.loadToken++;
    }

    attributeChangedCallback(
        name: string,
        oldValue: string | null,
        newValue: string | null,
    ): void {
        if (!this.attachedToDom || oldValue === newValue) return;
        if (!REINIT_ATTRIBUTES.has(name)) return;
        void this.fetchConversations();
    }

    // Imperative refresh hook for host apps that want to re-fetch after
    // a send. Mirrors <zulip-channel-list>'s `refresh()`.
    refresh(): Promise<void> {
        return this.fetchConversations();
    }

    private buildTemplate(): void {
        const style = document.createElement("style");
        style.textContent = LIST_STYLES;

        const root = document.createElement("div");
        root.className = "root";
        root.setAttribute("role", "region");
        root.setAttribute("aria-label", "Zulip direct messages list");

        const error = document.createElement("div");
        error.className = "error";
        error.setAttribute("role", "alert");
        error.hidden = true;
        this.errorEl = error;
        root.append(error);

        const status = document.createElement("div");
        status.className = "status";
        status.textContent = "Loading direct messages\u2026";
        this.statusEl = status;
        root.append(status);

        const list = document.createElement("ul");
        list.className = "list";
        list.setAttribute("role", "list");
        list.hidden = true;
        this.listEl = list;
        root.append(list);

        this.shadow.replaceChildren(style, root);
    }

    private async createTransport(): Promise<Transport> {
        // listDirectMessageConversations is scope-agnostic — the transport
        // queries the viewer's own DMs regardless of what scope the
        // constructor was given. Use a throwaway channel scope so the ctor
        // has something valid to normalize.
        const scope: ScopeFilter = {kind: "channel", channel: "general"};
        const snapshotUrl = this.getAttribute("snapshot-url");
        if (snapshotUrl !== null && snapshotUrl !== "") {
            const {SnapshotTransport} = await import("./snapshot-transport.ts");
            return new SnapshotTransport({url: snapshotUrl, scope});
        }
        if (this.hasAttribute("demo")) {
            const {DemoTransport} = await import("./demo-transport.ts");
            return new DemoTransport({scope});
        }
        const server = this.getAttribute("server");
        const authToken = this.getAttribute("auth-token");
        if (!server) {
            throw new Error(
                'Live mode requires a "server" attribute. Add the "demo" attribute to preview without a server.',
            );
        }
        // Same dynamic-import rationale as channel-list: the Zod + fetch
        // surface is paid for on connect, not on static import.
        const {ZulipTransport} = await import("./zulip-transport.ts");
        if (authToken && authToken !== "") {
            return new ZulipTransport({serverUrl: server, authToken, scope});
        }
        throw new Error(
            'Live mode requires an "auth-token" attribute. Add the "demo" attribute to preview without a server. See docs/jwt.md for the auth-token flow.',
        );
    }

    private async fetchConversations(): Promise<void> {
        if (!this.attachedToDom) return;
        const token = ++this.loadToken;

        this.setError(undefined);
        this.setStatus("Loading direct messages\u2026");

        let transport: Transport;
        try {
            transport = await this.createTransport();
        } catch (error) {
            if (token !== this.loadToken) return;
            this.setStatus(undefined);
            this.setError(describeError(error));
            return;
        }
        if (token !== this.loadToken) {
            // Attribute changed mid-dynamic-import; discard this transport.
            try {
                await transport.close();
            } catch {
                // Ignore teardown errors.
            }
            return;
        }

        try {
            // Gracefully degrade if the transport doesn't implement the
            // optional method (older SnapshotTransports bundled before
            // the helper landed). The list renders an empty state rather
            // than throwing — dropping <zulip-dm-list> next to a
            // channel-only snapshot should not explode.
            if (transport.listDirectMessageConversations === undefined) {
                if (token !== this.loadToken) return;
                this.renderConversations([]);
                return;
            }
            const conversations = await transport.listDirectMessageConversations();
            if (token !== this.loadToken) return;
            this.renderConversations(conversations);
        } catch (error) {
            if (token !== this.loadToken) return;
            this.setStatus(undefined);
            this.setError(describeError(error));
        } finally {
            try {
                await transport.close();
            } catch {
                // Ignore teardown errors.
            }
        }
    }

    private renderConversations(conversations: DirectMessageConversation[]): void {
        if (!this.listEl) return;
        this.listEl.replaceChildren();

        if (conversations.length === 0) {
            this.listEl.hidden = true;
            this.setStatus("No direct messages");
            return;
        }

        for (const conversation of conversations) {
            this.listEl.append(this.buildItem(conversation));
        }
        this.listEl.hidden = false;
        this.setStatus(undefined);
    }

    private buildItem(conversation: DirectMessageConversation): HTMLElement {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "item";

        // Avatar cluster — single avatar for 1:1, initials stack for
        // group DMs. Falls back to muted initials when the transport
        // couldn't resolve an avatar URL (snapshot, demo).
        const avatar = document.createElement("span");
        avatar.className = "avatar";
        avatar.setAttribute("aria-hidden", "true");
        const primary = conversation.users[0];
        if (primary !== undefined) {
            const safeSrc = sanitizeAvatarUrl(primary.avatarUrl);
            if (safeSrc !== undefined) {
                const img = document.createElement("img");
                img.src = safeSrc;
                img.alt = "";
                img.loading = "lazy";
                img.decoding = "async";
                avatar.append(img);
            } else {
                avatar.textContent = initialsOf(primary);
            }
        }
        button.append(avatar);

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = displayNameOf(conversation.users);
        button.append(name);

        const time = document.createElement("span");
        time.className = "time";
        time.textContent = formatRelativeTime(conversation.lastMessageTime);
        button.append(time);

        const userIds = conversation.users.map((u) => u.userId);
        button.addEventListener("click", () => {
            // The caller decides what a click means — typically mounting
            // (or swapping) a <zulip-chat dm-user-ids="..."> into a pane
            // next to this list. `detail.userIds` is already canonical
            // (sorted ascending) courtesy of the bucketing helper.
            this.dispatchEvent(
                new CustomEvent("dm-selected", {
                    detail: {
                        userIds,
                        users: conversation.users,
                        lastMessageId: conversation.lastMessageId,
                    },
                    bubbles: true,
                    composed: true,
                }),
            );
        });

        li.append(button);
        return li;
    }

    private setStatus(label: string | undefined): void {
        if (!this.statusEl) return;
        if (label === undefined) {
            this.statusEl.hidden = true;
            this.statusEl.textContent = "";
            return;
        }
        this.statusEl.hidden = false;
        this.statusEl.textContent = label;
    }

    private setError(message: string | undefined): void {
        if (!this.errorEl) return;
        if (message === undefined) {
            this.errorEl.hidden = true;
            this.errorEl.textContent = "";
            return;
        }
        this.errorEl.hidden = false;
        this.errorEl.textContent = message;
        if (this.listEl) this.listEl.hidden = true;
    }
}

function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

// Render a human-readable DM label from the participant list. One-on-one
// conversations display the peer's full name; group DMs show a comma-
// separated list capped at three names with a "+N" overflow hint. We
// never include the viewer in the rendered label — the bucketer already
// excluded them, but defensively filter empty names here.
function displayNameOf(users: User[]): string {
    const names = users.map((u) => u.fullName.trim()).filter((n) => n.length > 0);
    if (names.length === 0) return "(unknown)";
    if (names.length === 1) return names[0]!;
    if (names.length === 2) return `${names[0]!}, ${names[1]!}`;
    if (names.length === 3) return `${names[0]!}, ${names[1]!}, ${names[2]!}`;
    return `${names[0]!}, ${names[1]!}, ${names[2]!} +${String(names.length - 3)}`;
}

// Two-letter initials from the user's full name for the avatar fallback.
// Falls back to "?" when the name is empty so the circle isn't blank.
function initialsOf(user: User): string {
    const trimmed = user.fullName.trim();
    if (trimmed === "") return "?";
    const parts = trimmed.split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    const initials = `${first}${second}`.toUpperCase();
    return initials === "" ? "?" : initials;
}

// Relative-time formatter: "just now" / "3m" / "2h" / "Tue" / "Apr 12".
// Deliberately avoids Intl.RelativeTimeFormat because it isn't present in
// some older jsdom builds we run tests against.
function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const deltaMs = now - timestamp;
    const minutes = Math.round(deltaMs / 60_000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${String(minutes)}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${String(hours)}h`;
    const days = Math.round(hours / 24);
    if (days < 7) {
        return new Date(timestamp).toLocaleDateString(undefined, {weekday: "short"});
    }
    return new Date(timestamp).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
    });
}

// Same sanitization rules as the message avatar: only http(s) URLs reach
// the DOM, everything else falls back to the initials placeholder. A
// malicious server / snapshot could otherwise ship `javascript:` or
// `data:` avatars that execute on attribute set.
function sanitizeAvatarUrl(raw: string): string | undefined {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    if (trimmed.startsWith("//")) return undefined;
    const base =
        typeof document !== "undefined" && document.baseURI
            ? document.baseURI
            : "https://zulip.invalid/";
    try {
        const parsed = new URL(trimmed, base);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
            return parsed.toString();
        }
    } catch {
        return undefined;
    }
    return undefined;
}

let registered = false;

export function registerZulipDmListElement(): void {
    if (registered) return;
    if (typeof customElements === "undefined") return;
    if (customElements.get("zulip-dm-list") === undefined) {
        customElements.define("zulip-dm-list", ZulipDmListElement);
    }
    registered = true;
}
