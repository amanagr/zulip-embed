import {ZulipClient} from "./client.ts";
import {DemoTransport} from "./demo-transport.ts";
import {isNearBottom, renderMessages, scrollToBottom, type RenderContext} from "./render.ts";
import {COMPONENT_STYLES} from "./styles.ts";
import type {Transport} from "./transport.ts";
import type {ConnectionStatus, Message, Reaction, ScopeFilter} from "./types.ts";
import {ZulipTransport} from "./zulip-transport.ts";

const OBSERVED_ATTRIBUTES = [
    "demo",
    "demo-variant",
    "server",
    "email",
    "api-key",
    "channel",
    "topic",
    "theme",
    "mode",
    "open",
    "read-only",
] as const;

const REINIT_ATTRIBUTES: ReadonlySet<string> = new Set([
    "demo",
    "demo-variant",
    "server",
    "email",
    "api-key",
    "channel",
    "topic",
]);

const CHAT_BUBBLE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

interface ComponentState {
    messages: Message[];
    status: ConnectionStatus;
    error: string | undefined;
    loading: boolean;
}

export class ZulipChatElement extends HTMLElement {
    static readonly observedAttributes = OBSERVED_ATTRIBUTES;

    private readonly shadow: ShadowRoot;
    private client: ZulipClient | undefined;
    private unsubscribe: (() => void) | undefined;
    private state: ComponentState = {
        messages: [],
        status: "idle",
        error: undefined,
        loading: true,
    };
    private initToken = 0;
    private feedEl: HTMLElement | undefined;
    private composerInputEl: HTMLTextAreaElement | undefined;
    private composerSendEl: HTMLButtonElement | undefined;
    private headerChannelEl: HTMLElement | undefined;
    private headerTopicEl: HTMLElement | undefined;
    private statusDotEl: HTMLElement | undefined;
    private errorBannerEl: HTMLElement | undefined;
    private attachedToDom = false;

    constructor() {
        super();
        this.shadow = this.attachShadow({mode: "open"});
    }

    connectedCallback(): void {
        this.attachedToDom = true;
        this.buildTemplate();
        this.applyStateToDom();
        void this.bootstrapClient();
    }

    disconnectedCallback(): void {
        this.attachedToDom = false;
        void this.teardownClient();
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (!this.attachedToDom || oldValue === newValue) return;
        if (!REINIT_ATTRIBUTES.has(name)) return;
        void this.bootstrapClient();
    }

    open(): void {
        if (this.getAttribute("mode") !== "floating") return;
        this.setAttribute("open", "");
        requestAnimationFrame(() => this.composerInputEl?.focus());
    }

    close(): void {
        if (this.getAttribute("mode") !== "floating") return;
        this.removeAttribute("open");
    }

    private buildTemplate(): void {
        const style = document.createElement("style");
        style.textContent = COMPONENT_STYLES;

        const launcher = this.buildLauncher();

        const root = document.createElement("div");
        root.className = "root";
        root.setAttribute("role", "region");
        root.setAttribute("aria-label", "Zulip chat");

        root.append(this.buildHeader());
        this.errorBannerEl = this.buildErrorBanner();
        root.append(this.errorBannerEl);
        root.append(this.buildFeed());
        root.append(this.buildComposer());
        root.append(this.buildFooter());

        root.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && this.getAttribute("mode") === "floating") {
                this.close();
            }
        });

        this.shadow.replaceChildren(style, launcher, root);
    }

    private buildLauncher(): HTMLButtonElement {
        const button = document.createElement("button");
        button.className = "launcher";
        button.type = "button";
        button.setAttribute("aria-label", "Open chat");
        button.innerHTML = CHAT_BUBBLE_SVG;
        button.addEventListener("click", () => {
            this.open();
        });
        return button;
    }

    private buildHeader(): HTMLElement {
        const header = document.createElement("header");
        header.className = "header";

        const dot = document.createElement("span");
        dot.className = "status-dot";
        dot.dataset["status"] = "idle";
        dot.setAttribute("aria-label", "Connection status");
        dot.setAttribute("role", "status");
        this.statusDotEl = dot;
        header.append(dot);

        const textWrap = document.createElement("div");
        textWrap.className = "header-text";

        const channelEl = document.createElement("div");
        channelEl.className = "header-channel";
        this.headerChannelEl = channelEl;

        const topicEl = document.createElement("div");
        topicEl.className = "header-topic";
        this.headerTopicEl = topicEl;

        textWrap.append(channelEl, topicEl);
        header.append(textWrap);

        const closeBtn = document.createElement("button");
        closeBtn.className = "header-close";
        closeBtn.type = "button";
        closeBtn.setAttribute("aria-label", "Close chat");
        closeBtn.innerHTML = CLOSE_SVG;
        closeBtn.addEventListener("click", () => {
            this.close();
        });
        header.append(closeBtn);

        return header;
    }

    private buildErrorBanner(): HTMLElement {
        const banner = document.createElement("div");
        banner.className = "error-banner";
        banner.setAttribute("role", "alert");
        banner.hidden = true;
        return banner;
    }

    private buildFeed(): HTMLElement {
        const feed = document.createElement("div");
        feed.className = "feed";
        feed.setAttribute("role", "log");
        feed.setAttribute("aria-live", "polite");
        this.feedEl = feed;
        return feed;
    }

    private buildComposer(): HTMLElement {
        const composer = document.createElement("div");
        composer.className = "composer";

        const row = document.createElement("div");
        row.className = "composer-row";

        const input = document.createElement("textarea");
        input.className = "composer-input";
        input.placeholder = "Write a message…";
        input.rows = 1;
        input.setAttribute("aria-label", "Message");
        input.addEventListener("input", () => {
            this.autosize(input);
            this.refreshSendButton();
        });
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void this.handleSend();
            }
        });
        this.composerInputEl = input;
        row.append(input);

        const send = document.createElement("button");
        send.className = "composer-send";
        send.type = "button";
        send.textContent = "Send";
        send.disabled = true;
        send.addEventListener("click", () => {
            void this.handleSend();
        });
        this.composerSendEl = send;
        row.append(send);

        composer.append(row);

        const hint = document.createElement("div");
        hint.className = "composer-hint";
        hint.textContent = "Enter to send · Shift+Enter for newline";
        composer.append(hint);

        return composer;
    }

    private buildFooter(): HTMLElement {
        const footer = document.createElement("footer");
        footer.className = "footer";
        const link = document.createElement("a");
        link.href = "https://zulip.com";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Powered by Zulip";
        footer.append(link);
        return footer;
    }

    private autosize(input: HTMLTextAreaElement): void {
        input.style.height = "auto";
        input.style.height = `${String(Math.min(input.scrollHeight, 120))}px`;
    }

    private refreshSendButton(): void {
        if (!this.composerSendEl || !this.composerInputEl) return;
        const hasText = this.composerInputEl.value.trim().length > 0;
        const canSend = hasText && this.state.status === "connected";
        this.composerSendEl.disabled = !canSend;
    }

    private async bootstrapClient(): Promise<void> {
        await this.teardownClient();
        if (!this.attachedToDom) return;

        const token = ++this.initToken;
        const scope = this.readScope();
        this.setState({messages: [], status: "connecting", error: undefined, loading: true});

        let transport: Transport;
        try {
            transport = this.createTransport(scope);
        } catch (error) {
            this.setState({status: "error", error: describeError(error), loading: false});
            return;
        }

        const client = new ZulipClient({transport});
        this.client = client;
        this.unsubscribe = client.subscribe((event) => {
            if (token !== this.initToken) return;
            if (event.type === "message") {
                this.appendMessage(event.message);
            } else if (event.type === "message-update") {
                this.updateMessage(event.messageId, event.content, event.topic);
            } else if (event.type === "message-delete") {
                this.deleteMessage(event.messageId);
            } else if (event.type === "reaction") {
                this.updateReactions(event.messageId, event.reactions);
            } else if (event.type === "connection") {
                this.setState({status: event.status});
            } else if (event.type === "error") {
                this.setState({error: event.error});
            }
        });

        try {
            await client.connect();
            if (token !== this.initToken) return;
            const messages = await client.getMessages(scope);
            if (token !== this.initToken) return;
            this.setState({messages, loading: false});
            requestAnimationFrame(() => {
                if (this.feedEl) scrollToBottom(this.feedEl);
            });
        } catch (error) {
            if (token !== this.initToken) return;
            this.setState({
                status: "error",
                error: describeError(error),
                loading: false,
            });
        }
    }

    private async teardownClient(): Promise<void> {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        const client = this.client;
        this.client = undefined;
        if (client) {
            try {
                await client.disconnect();
            } catch {
                // Ignore teardown errors; the component is going away.
            }
        }
    }

    private createTransport(scope: ScopeFilter): Transport {
        if (this.hasAttribute("demo")) {
            return new DemoTransport({
                scope,
                readOnly: this.hasAttribute("read-only"),
            });
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

    private readScope(): ScopeFilter {
        const channel = this.getAttribute("channel") ?? "general";
        const topic = this.getAttribute("topic") ?? undefined;
        return {channel, topic};
    }

    private appendMessage(message: Message): void {
        const stickToBottom = this.feedEl ? isNearBottom(this.feedEl) : true;
        this.setState({messages: [...this.state.messages, message]});
        if (stickToBottom && this.feedEl) {
            requestAnimationFrame(() => {
                if (this.feedEl) scrollToBottom(this.feedEl);
            });
        }
    }

    private updateMessage(
        id: number,
        content: string | undefined,
        topic: string | undefined,
    ): void {
        const next = this.state.messages.map((m) => {
            if (m.id !== id) return m;
            return {
                ...m,
                content: content ?? m.content,
                contentIsHtml: content !== undefined ? true : m.contentIsHtml,
                topic: topic ?? m.topic,
            };
        });
        this.setState({messages: next});
    }

    private deleteMessage(id: number): void {
        const next = this.state.messages.filter((m) => m.id !== id);
        if (next.length === this.state.messages.length) return;
        this.setState({messages: next});
    }

    private updateReactions(id: number, reactions: Reaction[]): void {
        const next = this.state.messages.map((m) =>
            m.id === id ? {...m, reactions} : m,
        );
        this.setState({messages: next});
    }

    private handleToggleReaction(message: Message, emoji: string): void {
        if (!this.client) return;
        const userId = this.client.getCurrentUserId();
        const mine =
            userId !== undefined &&
            message.reactions.some(
                (r) => r.emoji === emoji && r.userIds.includes(userId),
            );
        const call = mine
            ? this.client.removeReaction({messageId: message.id, emoji})
            : this.client.addReaction({messageId: message.id, emoji});
        call.catch((error: unknown) => {
            this.setState({error: describeError(error)});
        });
    }

    private handleAddReaction(message: Message): void {
        // v0.1: simple prompt-based picker. A real emoji picker is roadmap.
        const emoji = window.prompt("Reaction emoji name (e.g. tada, +1, heart):");
        if (emoji === null) return;
        const trimmed = emoji.trim();
        if (trimmed === "") return;
        this.handleToggleReaction(message, trimmed);
    }

    private renderContext(): RenderContext {
        const context: RenderContext = {
            serverOrigin: this.getAttribute("server") ?? undefined,
            currentUserId: this.client?.getCurrentUserId(),
        };
        if (this.hasAttribute("read-only")) {
            return context;
        }
        context.onToggleReaction = (m, e) => {
            this.handleToggleReaction(m, e);
        };
        context.onAddReaction = (m) => {
            this.handleAddReaction(m);
        };
        return context;
    }

    private async handleSend(): Promise<void> {
        if (!this.client || !this.composerInputEl) return;
        const content = this.composerInputEl.value.trim();
        if (content.length === 0) return;
        if (this.state.status !== "connected") return;

        const scope = this.readScope();
        this.composerInputEl.value = "";
        this.autosize(this.composerInputEl);
        this.refreshSendButton();

        try {
            await this.client.sendMessage({
                type: "channel",
                channel: scope.channel,
                topic: scope.topic,
                content,
            });
        } catch (error) {
            this.setState({error: describeError(error)});
        }
    }

    private setState(patch: Partial<ComponentState>): void {
        this.state = {...this.state, ...patch};
        this.applyStateToDom();
    }

    private applyStateToDom(): void {
        if (!this.attachedToDom) return;
        const scope = this.readScope();

        if (this.headerChannelEl) {
            this.headerChannelEl.textContent = scope.channel;
        }
        if (this.headerTopicEl) {
            this.headerTopicEl.textContent = scope.topic ?? "";
            this.headerTopicEl.hidden = scope.topic === undefined;
        }
        if (this.statusDotEl) {
            this.statusDotEl.dataset["status"] = this.state.status;
            this.statusDotEl.title = `Status: ${this.state.status}`;
        }

        if (this.errorBannerEl) {
            if (this.state.error !== undefined) {
                this.errorBannerEl.textContent = this.state.error;
                this.errorBannerEl.hidden = false;
            } else {
                this.errorBannerEl.hidden = true;
                this.errorBannerEl.textContent = "";
            }
        }

        if (this.feedEl) {
            if (this.state.loading) {
                const loading = document.createElement("div");
                loading.className = "feed-loading";
                loading.textContent = "Loading messages…";
                this.feedEl.replaceChildren(loading);
            } else {
                renderMessages(this.feedEl, this.state.messages, this.renderContext());
            }
        }

        this.refreshSendButton();
    }
}

function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

let registered = false;

export function registerZulipChatElement(): void {
    if (registered) return;
    if (typeof customElements === "undefined") return;
    if (customElements.get("zulip-chat") === undefined) {
        customElements.define("zulip-chat", ZulipChatElement);
    }
    registered = true;
}
