import {DemoTransport} from "./demo-transport.ts";
import {SnapshotTransport} from "./snapshot-transport.ts";
import type {Transport} from "./transport.ts";
import type {Channel, ScopeFilter} from "./types.ts";
import {ZulipTransport} from "./zulip-transport.ts";

const OBSERVED_ATTRIBUTES = [
    "demo",
    "snapshot-url",
    "server",
    "email",
    "api-key",
    "theme",
] as const;

const REINIT_ATTRIBUTES: ReadonlySet<string> = new Set([
    "demo",
    "snapshot-url",
    "server",
    "email",
    "api-key",
]);

const PIN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;

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
    --zc-color-error: #dc2626;

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

.item-muted {
    opacity: 0.55;
}

.color-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--zc-color-muted);
}

.name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.name::before {
    content: "#";
    color: var(--zc-color-muted);
    margin-right: 2px;
}

.pin {
    width: 12px;
    height: 12px;
    color: var(--zc-color-muted);
    flex-shrink: 0;
}

.pin svg {
    width: 100%;
    height: 100%;
}

.badge {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--zc-color-accent);
    color: var(--zc-color-accent-contrast);
    font-size: 11px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
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

export class ZulipChannelListElement extends HTMLElement {
    static readonly observedAttributes = OBSERVED_ATTRIBUTES;

    private readonly shadow: ShadowRoot;
    private rootEl: HTMLElement | undefined;
    private listEl: HTMLElement | undefined;
    private statusEl: HTMLElement | undefined;
    private errorEl: HTMLElement | undefined;
    private attachedToDom = false;
    // Monotonic token guards against stale async responses racing past
    // a disconnect or re-init.
    private loadToken = 0;

    constructor() {
        super();
        this.shadow = this.attachShadow({mode: "open"});
    }

    connectedCallback(): void {
        this.attachedToDom = true;
        this.buildTemplate();
        void this.fetchChannels();
    }

    disconnectedCallback(): void {
        this.attachedToDom = false;
        this.loadToken++;
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (!this.attachedToDom || oldValue === newValue) return;
        if (!REINIT_ATTRIBUTES.has(name)) return;
        void this.fetchChannels();
    }

    refresh(): Promise<void> {
        return this.fetchChannels();
    }

    private buildTemplate(): void {
        const style = document.createElement("style");
        style.textContent = LIST_STYLES;

        const root = document.createElement("div");
        root.className = "root";
        root.setAttribute("role", "region");
        root.setAttribute("aria-label", "Zulip channel list");

        const error = document.createElement("div");
        error.className = "error";
        error.setAttribute("role", "alert");
        error.hidden = true;
        this.errorEl = error;
        root.append(error);

        const status = document.createElement("div");
        status.className = "status";
        status.textContent = "Loading channels…";
        this.statusEl = status;
        root.append(status);

        const list = document.createElement("ul");
        list.className = "list";
        list.setAttribute("role", "list");
        list.hidden = true;
        this.listEl = list;
        root.append(list);

        this.rootEl = root;
        this.shadow.replaceChildren(style, root);
    }

    private createTransport(): Transport {
        // listChannels is scope-agnostic, but Transport ctors need a
        // scope. Use a throwaway "general" — no messages are fetched.
        const scope: ScopeFilter = {channel: "general"};
        const snapshotUrl = this.getAttribute("snapshot-url");
        if (snapshotUrl !== null && snapshotUrl !== "") {
            return new SnapshotTransport({url: snapshotUrl, scope});
        }
        if (this.hasAttribute("demo")) {
            return new DemoTransport({scope});
        }
        const server = this.getAttribute("server");
        const email = this.getAttribute("email");
        const apiKey = this.getAttribute("api-key");
        if (!server || !email || !apiKey) {
            throw new Error(
                'Live mode requires "server", "email", and "api-key" attributes. Add the "demo" attribute to preview without a server.',
            );
        }
        return new ZulipTransport({serverUrl: server, email, apiKey, scope});
    }

    private async fetchChannels(): Promise<void> {
        if (!this.attachedToDom) return;
        const token = ++this.loadToken;

        this.setError(undefined);
        this.setStatus("Loading channels…");

        let transport: Transport;
        try {
            transport = this.createTransport();
        } catch (error) {
            this.setStatus(undefined);
            this.setError(describeError(error));
            return;
        }

        try {
            // ZulipTransport.listChannels() calls /subscriptions directly
            // without requiring connect(), so we skip the event-queue
            // handshake here — the list is a one-shot read.
            const channels = await transport.listChannels();
            if (token !== this.loadToken) return;
            this.renderChannels(channels);
        } catch (error) {
            if (token !== this.loadToken) return;
            this.setStatus(undefined);
            this.setError(describeError(error));
        } finally {
            // Best-effort cleanup; ZulipTransport.close() is idempotent
            // and SnapshotTransport.close() is a no-op.
            try {
                await transport.close();
            } catch {
                // Ignore teardown errors.
            }
        }
    }

    private renderChannels(channels: Channel[]): void {
        if (!this.listEl) return;
        this.listEl.replaceChildren();

        if (channels.length === 0) {
            this.listEl.hidden = true;
            this.setStatus("No channels");
            return;
        }

        for (const channel of channels) {
            this.listEl.append(this.buildItem(channel));
        }
        this.listEl.hidden = false;
        this.setStatus(undefined);
    }

    private buildItem(channel: Channel): HTMLElement {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "item";
        if (channel.isMuted === true) {
            button.classList.add("item-muted");
        }

        const dot = document.createElement("span");
        dot.className = "color-dot";
        if (channel.color !== undefined && channel.color !== "") {
            // Apply via .style to avoid inlining untrusted values into
            // the stylesheet. The Channel.color field is a hex string
            // from the server; browsers silently drop invalid input.
            dot.style.background = channel.color;
        }
        button.append(dot);

        const name = document.createElement("span");
        name.className = "name";
        // Plain text — no HTML, no DOMPurify needed.
        name.textContent = channel.name;
        if (channel.description !== "") {
            // Shown as a native browser tooltip. Description may contain
            // markdown on the server side but we treat it as plain text
            // here — title attributes don't render HTML anyway.
            name.title = channel.description;
        }
        button.append(name);

        if (channel.pinToTop === true) {
            const pin = document.createElement("span");
            pin.className = "pin";
            pin.setAttribute("aria-label", "Pinned");
            pin.innerHTML = PIN_SVG;
            button.append(pin);
        }

        const unread = channel.unreadCount ?? 0;
        if (unread > 0) {
            const badge = document.createElement("span");
            badge.className = "badge";
            badge.textContent = unread > 99 ? "99+" : String(unread);
            badge.setAttribute(
                "aria-label",
                `${String(unread)} unread ${unread === 1 ? "message" : "messages"}`,
            );
            button.append(badge);
        }

        button.addEventListener("click", () => {
            this.dispatchEvent(
                new CustomEvent("channel-selected", {
                    detail: {channelId: channel.channelId, name: channel.name},
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

let registered = false;

export function registerZulipChannelListElement(): void {
    if (registered) return;
    if (typeof customElements === "undefined") return;
    if (customElements.get("zulip-channel-list") === undefined) {
        customElements.define("zulip-channel-list", ZulipChannelListElement);
    }
    registered = true;
}
