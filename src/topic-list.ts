import type {Transport} from "./transport.ts";
import type {ScopeFilter, Topic} from "./types.ts";

const OBSERVED_ATTRIBUTES = [
    "demo",
    "snapshot-url",
    "server",
    "auth-token",
    "channel",
    "theme",
] as const;

const REINIT_ATTRIBUTES: ReadonlySet<string> = new Set([
    "demo",
    "snapshot-url",
    "server",
    "auth-token",
    "channel",
]);

const LIST_STYLES = `
:host {
    --zc-font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --zc-font-size: 14px;
    --zc-radius: 12px;
    --zc-radius-sm: 6px;
    --zc-spacing-sm: 8px;
    --zc-spacing-md: 12px;
    --zc-color-bg: #ffffff;
    --zc-color-surface: #f7f7f9;
    --zc-color-border: #e5e7eb;
    --zc-color-text: #111827;
    --zc-color-muted: #6b7280;
    --zc-color-accent: #6172f3;
    --zc-color-success: #16a34a;

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
    transition: background 120ms ease;
}

.item:hover,
.item:focus-visible {
    background: var(--zc-color-surface);
    outline: none;
}

.resolved-check {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--zc-color-success);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
}

.resolved-placeholder {
    width: 14px;
    flex-shrink: 0;
}

.name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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

export class ZulipTopicListElement extends HTMLElement {
    static readonly observedAttributes = OBSERVED_ATTRIBUTES;

    private readonly shadow: ShadowRoot;
    private listEl: HTMLElement | undefined;
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
        void this.fetchTopics();
    }

    disconnectedCallback(): void {
        this.attachedToDom = false;
        this.loadToken++;
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (!this.attachedToDom || oldValue === newValue) return;
        if (!REINIT_ATTRIBUTES.has(name)) return;
        void this.fetchTopics();
    }

    refresh(): Promise<void> {
        return this.fetchTopics();
    }

    private buildTemplate(): void {
        const style = document.createElement("style");
        style.textContent = LIST_STYLES;

        const root = document.createElement("div");
        root.className = "root";
        root.setAttribute("role", "region");
        root.setAttribute("aria-label", "Zulip topic list");

        const error = document.createElement("div");
        error.className = "error";
        error.setAttribute("role", "alert");
        error.hidden = true;
        this.errorEl = error;
        root.append(error);

        const status = document.createElement("div");
        status.className = "status";
        status.textContent = "Loading topics…";
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

    private async createTransport(channel: string): Promise<Transport> {
        const scope: ScopeFilter = {kind: "channel", channel};
        const snapshotUrl = this.getAttribute("snapshot-url");
        if (snapshotUrl !== null && snapshotUrl !== "") {
            // Dynamic import so live-only topic lists don't pull in the
            // snapshot fetch/parse surface.
            const {SnapshotTransport} = await import("./snapshot-transport.ts");
            return new SnapshotTransport({url: snapshotUrl, scope});
        }
        if (this.hasAttribute("demo")) {
            // Dynamic import keeps demo fixtures out of the default entry.
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
        // Dynamic import keeps the ~18KB Zod schema surface out of the
        // static topic-list entry; pages that render it alongside the
        // chat element share the chunk, and standalone usage pays only
        // when it actually connects.
        const {ZulipTransport} = await import("./zulip-transport.ts");
        if (authToken && authToken !== "") {
            return new ZulipTransport({serverUrl: server, authToken, scope});
        }
        throw new Error(
            'Live mode requires an "auth-token" attribute. Add the "demo" attribute to preview without a server. See docs/jwt.md for the auth-token flow.',
        );
    }

    private async fetchTopics(): Promise<void> {
        if (!this.attachedToDom) return;
        const channel = this.getAttribute("channel");
        const token = ++this.loadToken;

        this.setError(undefined);

        if (channel === null || channel === "") {
            this.clearList();
            this.setStatus('Set a "channel" attribute to list topics.');
            return;
        }

        this.setStatus("Loading topics…");

        let transport: Transport;
        try {
            transport = await this.createTransport(channel);
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
            const topics = await transport.listTopics(channel);
            if (token !== this.loadToken) return;
            this.renderTopics(topics);
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

    private clearList(): void {
        if (!this.listEl) return;
        this.listEl.replaceChildren();
        this.listEl.hidden = true;
    }

    private renderTopics(topics: Topic[]): void {
        if (!this.listEl) return;
        this.listEl.replaceChildren();

        if (topics.length === 0) {
            this.listEl.hidden = true;
            this.setStatus("No topics in this channel");
            return;
        }

        for (const topic of topics) {
            this.listEl.append(this.buildItem(topic));
        }
        this.listEl.hidden = false;
        this.setStatus(undefined);
    }

    private buildItem(topic: Topic): HTMLElement {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "item";

        if (topic.isResolved === true) {
            const check = document.createElement("span");
            check.className = "resolved-check";
            // U+2714 HEAVY CHECK MARK — the same sentinel Zulip's server
            // uses to flag resolved topics. Rendering as plain text keeps
            // the component DOMPurify-free.
            check.textContent = "\u2714";
            check.setAttribute("aria-label", "Resolved");
            button.append(check);
        } else {
            const spacer = document.createElement("span");
            spacer.className = "resolved-placeholder";
            spacer.setAttribute("aria-hidden", "true");
            button.append(spacer);
        }

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = topic.name;
        button.append(name);

        button.addEventListener("click", () => {
            this.dispatchEvent(
                new CustomEvent("topic-selected", {
                    detail: {topic: topic.name},
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

export function registerZulipTopicListElement(): void {
    if (registered) return;
    if (typeof customElements === "undefined") return;
    if (customElements.get("zulip-topic-list") === undefined) {
        customElements.define("zulip-topic-list", ZulipTopicListElement);
    }
    registered = true;
}
