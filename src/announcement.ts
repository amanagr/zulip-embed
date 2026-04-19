import {sanitizeHtml} from "./render.ts";
import type {Transport} from "./transport.ts";
import type {Message, ScopeFilter} from "./types.ts";

const OBSERVED_ATTRIBUTES = [
    "demo",
    "snapshot-url",
    "server",
    "email",
    "api-key",
    "auth-token",
    "message-id",
    "dismissible",
    "theme",
] as const;

const REINIT_ATTRIBUTES: ReadonlySet<string> = new Set([
    "demo",
    "snapshot-url",
    "server",
    "email",
    "api-key",
    "auth-token",
    "message-id",
]);

const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>`;

const ANNOUNCEMENT_STYLES = `
:host {
    --zc-font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --zc-font-size: 14px;
    --zc-radius: 12px;
    --zc-spacing-sm: 8px;
    --zc-spacing-md: 12px;
    --zc-spacing-lg: 16px;
    --zc-color-bg: #f5f3ff;
    --zc-color-border: #ddd6fe;
    --zc-color-text: #1f1b3a;
    --zc-color-muted: #6b5ca3;
    --zc-color-accent: #6172f3;

    display: block;
    font-family: var(--zc-font-family);
    font-size: var(--zc-font-size);
    color: var(--zc-color-text);
    box-sizing: border-box;
}

:host([hidden]) {
    display: none;
}

:host([theme="dark"]) {
    --zc-color-bg: #2a1f4a;
    --zc-color-border: #4c3f7a;
    --zc-color-text: #f5f3ff;
    --zc-color-muted: #c4b8ec;
}

*,
*::before,
*::after {
    box-sizing: inherit;
}

.root {
    background: var(--zc-color-bg);
    border: 1px solid var(--zc-color-border);
    border-radius: var(--zc-radius);
    padding: var(--zc-spacing-md) var(--zc-spacing-lg);
    display: flex;
    gap: var(--zc-spacing-md);
    align-items: flex-start;
}

.badge {
    flex-shrink: 0;
    background: var(--zc-color-accent);
    color: #ffffff;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    padding: 2px var(--zc-spacing-sm);
    border-radius: 999px;
    margin-top: 2px;
}

.body {
    flex: 1;
    min-width: 0;
    line-height: 1.5;
}

.body p:first-child {
    margin-top: 0;
}

.body p:last-child {
    margin-bottom: 0;
}

.body a {
    color: var(--zc-color-accent);
}

.body code {
    background: rgba(97, 114, 243, 0.12);
    padding: 0 4px;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
}

.dismiss {
    flex-shrink: 0;
    background: transparent;
    border: none;
    padding: 4px;
    margin: -4px -4px -4px 0;
    color: var(--zc-color-muted);
    cursor: pointer;
    border-radius: 6px;
    transition: background 120ms ease, color 120ms ease;
}

.dismiss:hover,
.dismiss:focus-visible {
    background: rgba(0, 0, 0, 0.06);
    color: var(--zc-color-text);
    outline: none;
}

:host([theme="dark"]) .dismiss:hover,
:host([theme="dark"]) .dismiss:focus-visible {
    background: rgba(255, 255, 255, 0.12);
}

.dismiss svg {
    width: 16px;
    height: 16px;
    display: block;
}

.status {
    color: var(--zc-color-muted);
    font-size: 13px;
    padding: var(--zc-spacing-sm) 0;
}

.error {
    padding: var(--zc-spacing-sm) var(--zc-spacing-md);
    background: #fee2e2;
    color: #991b1b;
    border-radius: 8px;
    font-size: 12px;
}

:host([theme="dark"]) .error {
    background: #7f1d1d;
    color: #fecaca;
}
`;

const DISMISS_STORAGE_PREFIX = "zulip-embed:announcement-dismissed:";

export class ZulipAnnouncementElement extends HTMLElement {
    static readonly observedAttributes = OBSERVED_ATTRIBUTES;

    private readonly shadow: ShadowRoot;
    private bodyEl: HTMLElement | undefined;
    private statusEl: HTMLElement | undefined;
    private errorEl: HTMLElement | undefined;
    private attachedToDom = false;
    private loadToken = 0;

    constructor() {
        super();
        this.shadow = this.attachShadow({mode: "open"});
    }

    connectedCallback(): void {
        this.attachedToDom = true;
        this.buildTemplate();
        if (this.isDismissed()) {
            this.hidden = true;
            return;
        }
        void this.fetchAnnouncement();
    }

    disconnectedCallback(): void {
        this.attachedToDom = false;
        this.loadToken++;
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (!this.attachedToDom) return;
        if (oldValue === newValue) return;
        if (REINIT_ATTRIBUTES.has(name)) {
            // message-id changed, so a prior dismissal doesn't apply. Let
            // the new announcement show unless it too is dismissed.
            this.hidden = false;
            if (this.isDismissed()) {
                this.hidden = true;
                return;
            }
            void this.fetchAnnouncement();
        }
    }

    /** Re-fetch the configured message and re-render. */
    refresh(): Promise<void> {
        return this.fetchAnnouncement();
    }

    private buildTemplate(): void {
        const style = document.createElement("style");
        style.textContent = ANNOUNCEMENT_STYLES;

        const root = document.createElement("div");
        root.className = "root";
        root.setAttribute("role", "region");
        root.setAttribute("aria-label", "Announcement");

        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "Announcement";
        root.append(badge);

        const body = document.createElement("div");
        body.className = "body";
        this.bodyEl = body;

        const status = document.createElement("div");
        status.className = "status";
        status.textContent = "Loading…";
        this.statusEl = status;
        body.append(status);

        const error = document.createElement("div");
        error.className = "error";
        error.setAttribute("role", "alert");
        error.hidden = true;
        this.errorEl = error;
        body.append(error);

        root.append(body);

        if (this.hasAttribute("dismissible")) {
            const dismiss = document.createElement("button");
            dismiss.type = "button";
            dismiss.className = "dismiss";
            dismiss.setAttribute("aria-label", "Dismiss announcement");
            dismiss.innerHTML = CLOSE_SVG;
            dismiss.addEventListener("click", () => this.dismiss());
            root.append(dismiss);
        }

        this.shadow.replaceChildren(style, root);
    }

    /** Dismiss the announcement for this session (and persist across reloads). */
    dismiss(): void {
        const id = this.getAttribute("message-id");
        if (id !== null && id !== "") {
            try {
                globalThis.localStorage?.setItem(DISMISS_STORAGE_PREFIX + id, "1");
            } catch {
                // localStorage can throw in private-browsing or embedded
                // contexts (sandboxed iframes). Dismissal degrades to
                // session-only; the element still hides for the current
                // render.
            }
        }
        this.hidden = true;
        this.dispatchEvent(
            new CustomEvent("announcement-dismissed", {
                detail: {messageId: id === null ? undefined : Number(id)},
                bubbles: true,
                composed: true,
            }),
        );
    }

    private isDismissed(): boolean {
        if (!this.hasAttribute("dismissible")) return false;
        const id = this.getAttribute("message-id");
        if (id === null || id === "") return false;
        try {
            return globalThis.localStorage?.getItem(DISMISS_STORAGE_PREFIX + id) === "1";
        } catch {
            return false;
        }
    }

    private async createTransport(): Promise<Transport> {
        // Announcement reads have no natural scope, so pass a throwaway
        // channel filter. Transports tolerate this because fetchMessage
        // is scope-agnostic (the server returns any message the viewer
        // can see; the snapshot searches the full file).
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
        const email = this.getAttribute("email");
        const apiKey = this.getAttribute("api-key");
        if (!server) {
            throw new Error(
                'Live mode requires a "server" attribute. Add the "demo" attribute to preview without a server.',
            );
        }
        const {ZulipTransport} = await import("./zulip-transport.ts");
        if (authToken && authToken !== "") {
            return new ZulipTransport({serverUrl: server, authToken, scope});
        }
        if (email && apiKey) {
            console.warn(
                "[zulip-announcement] api-key auth ships a long-lived credential to the browser. Prefer auth-token (JWT) for production.",
            );
            return new ZulipTransport({serverUrl: server, email, apiKey, scope});
        }
        throw new Error(
            'Live mode requires an "auth-token" attribute (preferred) or "email" + "api-key". Add the "demo" attribute to preview without a server.',
        );
    }

    private async fetchAnnouncement(): Promise<void> {
        if (!this.attachedToDom) return;
        const token = ++this.loadToken;

        const rawId = this.getAttribute("message-id");
        if (rawId === null || rawId === "") {
            this.setStatus('Set a "message-id" attribute to display an announcement.');
            this.setError(undefined);
            this.renderBody(undefined);
            return;
        }
        const messageId = Number(rawId);
        if (!Number.isFinite(messageId) || Math.trunc(messageId) !== messageId) {
            this.setStatus(undefined);
            this.setError(`Invalid message-id: ${rawId}`);
            this.renderBody(undefined);
            return;
        }

        this.setError(undefined);
        this.setStatus("Loading announcement…");
        this.renderBody(undefined);

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
            try {
                await transport.close();
            } catch {
                // Ignore teardown errors.
            }
            return;
        }

        try {
            if (transport.fetchMessage === undefined) {
                this.setStatus(undefined);
                this.setError("This transport does not support fetching a single message.");
                return;
            }
            const message = await transport.fetchMessage(messageId);
            if (token !== this.loadToken) return;
            if (!message) {
                this.setStatus(undefined);
                this.setError(
                    `Message ${String(messageId)} is not visible to the current viewer.`,
                );
                return;
            }
            this.setStatus(undefined);
            this.renderBody(message);
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

    private renderBody(message: Message | undefined): void {
        if (!this.bodyEl) return;
        this.bodyEl.replaceChildren();
        if (this.statusEl) this.bodyEl.append(this.statusEl);
        if (this.errorEl) this.bodyEl.append(this.errorEl);
        if (!message) return;
        if (message.contentIsHtml) {
            const server = this.getAttribute("server") ?? undefined;
            this.bodyEl.append(sanitizeHtml(message.content, server));
        } else {
            const p = document.createElement("p");
            p.textContent = message.content;
            this.bodyEl.append(p);
        }
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
    }
}

function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

let registered = false;

export function registerZulipAnnouncementElement(): void {
    if (registered) return;
    if (typeof customElements === "undefined") return;
    if (customElements.get("zulip-announcement") === undefined) {
        customElements.define("zulip-announcement", ZulipAnnouncementElement);
    }
    registered = true;
}
