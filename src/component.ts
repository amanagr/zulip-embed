import {ZulipClient} from "./client.ts";
import {DemoTransport} from "./demo-transport.ts";
import {createEmojiPicker, type EmojiPickerHandle} from "./emoji-picker.ts";
import {enhanceKatex} from "./katex.ts";
import {isNearBottom, renderMessages, scrollToBottom, type RenderContext} from "./render.ts";
import {SnapshotTransport} from "./snapshot-transport.ts";
import {enhanceSpoilers} from "./spoilers.ts";
import {COMPONENT_STYLES} from "./styles.ts";
import type {Transport} from "./transport.ts";
import type {ConnectionStatus, Message, Reaction, ScopeFilter} from "./types.ts";
import {ZulipTransport} from "./zulip-transport.ts";

const OBSERVED_ATTRIBUTES = [
    "demo",
    "demo-variant",
    "snapshot-url",
    "server",
    "email",
    "api-key",
    "channel",
    "topic",
    "theme",
    "mode",
    "open",
    "read-only",
    "katex-css",
] as const;

const REINIT_ATTRIBUTES: ReadonlySet<string> = new Set([
    "demo",
    "demo-variant",
    "snapshot-url",
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
    // Pagination state for loading older messages as the user scrolls up.
    hasMore: boolean;
    loadingOlder: boolean;
    // ID of the first message the viewer hasn't seen since they last had
    // the feed pinned to the bottom. Undefined when fully caught up.
    // Drives the "new messages" separator + jump-to-bottom pill.
    unreadAnchorId: number | undefined;
    // Count of messages at or below the unread anchor — shown on the pill.
    unreadCount: number;
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
        hasMore: false,
        loadingOlder: false,
        unreadAnchorId: undefined,
        unreadCount: 0,
    };
    private initToken = 0;
    private feedEl: HTMLElement | undefined;
    private emojiPicker: EmojiPickerHandle | undefined;
    private newMessagesPillEl: HTMLButtonElement | undefined;
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
        root.append(this.buildFeedWrap());
        root.append(this.buildComposer());
        root.append(this.buildFooter());

        root.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && this.getAttribute("mode") === "floating") {
                this.close();
            }
        });

        // The picker lives inside .root (a positioned container) so it
        // can float above messages without escaping the rounded border.
        this.emojiPicker = createEmojiPicker(this.shadow, root);

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

    private buildFeedWrap(): HTMLElement {
        const wrap = document.createElement("div");
        wrap.className = "feed-wrap";

        const feed = document.createElement("div");
        feed.className = "feed";
        feed.setAttribute("role", "log");
        feed.setAttribute("aria-live", "polite");
        feed.addEventListener("scroll", () => {
            this.handleFeedScroll();
        });
        this.feedEl = feed;
        wrap.append(feed);

        // "N new messages" jump-to-bottom pill — hidden by default and
        // only shown while an unread anchor is set (i.e. the user was
        // scrolled away when new messages arrived).
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = "new-messages-pill";
        pill.hidden = true;
        pill.textContent = "New messages";
        pill.addEventListener("click", () => {
            this.markAllRead();
            if (this.feedEl) scrollToBottom(this.feedEl);
        });
        this.newMessagesPillEl = pill;
        wrap.append(pill);

        return wrap;
    }

    private handleFeedScroll(): void {
        const feed = this.feedEl;
        if (!feed) return;
        // Load older messages when the user is within ~80px of the top
        // and we still have backlog to fetch. The loadingOlder latch
        // prevents duplicate concurrent requests while the network is in
        // flight.
        if (
            feed.scrollTop < 80 &&
            this.state.hasMore &&
            !this.state.loadingOlder &&
            !this.state.loading
        ) {
            void this.loadOlderMessages();
        }

        // Viewer scrolled back down to the bottom — treat as "caught up"
        // and clear the unread separator + pill on the next render.
        if (this.state.unreadAnchorId !== undefined && isNearBottom(feed)) {
            this.markAllRead();
        }
    }

    private markAllRead(): void {
        if (this.state.unreadAnchorId === undefined && this.state.unreadCount === 0) {
            return;
        }
        this.setState({unreadAnchorId: undefined, unreadCount: 0});
    }

    private async loadOlderMessages(): Promise<void> {
        const client = this.client;
        const feed = this.feedEl;
        if (!client || !feed) return;
        const oldest = this.state.messages[0];
        if (oldest === undefined) return;

        const token = this.initToken;
        this.setState({loadingOlder: true});

        // Preserve the viewport: capture scrollHeight before prepend so we
        // can restore the offset relative to the bottom and keep the user
        // pinned to the same message they were reading.
        const beforeHeight = feed.scrollHeight;
        const beforeTop = feed.scrollTop;

        try {
            const scope = this.readScope();
            const page = await client.getMessages(scope, {beforeId: oldest.id});
            if (token !== this.initToken) return;
            if (page.messages.length === 0) {
                this.setState({loadingOlder: false, hasMore: page.hasMore});
                return;
            }
            const seen = new Set(this.state.messages.map((m) => m.id));
            const newer = page.messages.filter((m) => !seen.has(m.id));
            const merged = [...newer, ...this.state.messages];
            this.setState({
                messages: merged,
                loadingOlder: false,
                hasMore: page.hasMore,
            });
            requestAnimationFrame(() => {
                if (!this.feedEl) return;
                const delta = this.feedEl.scrollHeight - beforeHeight;
                this.feedEl.scrollTop = beforeTop + delta;
            });
        } catch (error) {
            if (token !== this.initToken) return;
            this.setState({
                loadingOlder: false,
                error: describeError(error),
            });
        }
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
        this.setState({
            messages: [],
            status: "connecting",
            error: undefined,
            loading: true,
            hasMore: false,
            loadingOlder: false,
            unreadAnchorId: undefined,
            unreadCount: 0,
        });

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
                this.updateMessage(
                    event.messageId,
                    event.content,
                    event.contentIsHtml,
                    event.topic,
                );
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
            const page = await client.getMessages(scope);
            if (token !== this.initToken) return;
            this.setState({
                messages: page.messages,
                loading: false,
                hasMore: page.hasMore,
            });
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
        const snapshotUrl = this.getAttribute("snapshot-url");
        if (snapshotUrl !== null && snapshotUrl !== "") {
            // Snapshot mode is implicitly read-only; the transport rejects
            // writes and the composer is hidden via the read-only attribute.
            return new SnapshotTransport({url: snapshotUrl, scope});
        }
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
        const messages = [...this.state.messages, message];
        if (stickToBottom) {
            // Viewer is caught up — no unread state to accumulate.
            this.setState({messages, unreadAnchorId: undefined, unreadCount: 0});
            if (this.feedEl) {
                requestAnimationFrame(() => {
                    if (this.feedEl) scrollToBottom(this.feedEl);
                });
            }
            return;
        }
        // Viewer is scrolled away; mark this message (and subsequent ones)
        // as unread. Don't clobber an existing anchor — it should remain
        // pinned to the first message missed so the separator doesn't
        // crawl downward as more messages arrive.
        const unreadAnchorId = this.state.unreadAnchorId ?? message.id;
        this.setState({
            messages,
            unreadAnchorId,
            unreadCount: this.state.unreadCount + 1,
        });
    }

    private updateMessage(
        id: number,
        content: string | undefined,
        contentIsHtml: boolean | undefined,
        topic: string | undefined,
    ): void {
        const next = this.state.messages.map((m) => {
            if (m.id !== id) return m;
            // Trust the transport's contentIsHtml flag rather than inferring
            // HTML from `content !== undefined`. A future non-HTML transport
            // emitting an edit event would otherwise flow plain text through
            // the HTML sanitizer on the wrong render path.
            return {
                ...m,
                content: content ?? m.content,
                contentIsHtml:
                    content === undefined ? m.contentIsHtml : contentIsHtml ?? false,
                topic: topic ?? m.topic,
            };
        });
        this.setState({messages: next});
    }

    private deleteMessage(id: number): void {
        const next = this.state.messages.filter((m) => m.id !== id);
        if (next.length === this.state.messages.length) return;
        // If the unread anchor just vanished, promote the next unread
        // message to anchor (or clear the state entirely if none remain).
        let unreadAnchorId = this.state.unreadAnchorId;
        let unreadCount = this.state.unreadCount;
        if (unreadAnchorId === id) {
            const anchorIdx = this.state.messages.findIndex((m) => m.id === id);
            const replacement = anchorIdx >= 0 ? next[anchorIdx] : undefined;
            unreadAnchorId = replacement?.id;
            unreadCount = replacement === undefined ? 0 : Math.max(0, unreadCount - 1);
        }
        this.setState({messages: next, unreadAnchorId, unreadCount});
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

    private handleAddReaction(message: Message, anchor: HTMLElement): void {
        // v0.1 picker: curated emoji grid anchored to the "+" button.
        // Re-opening on the same anchor toggles the panel closed.
        if (this.emojiPicker === undefined) return;
        if (this.emojiPicker.isOpen()) {
            this.emojiPicker.close();
            return;
        }
        this.emojiPicker.open(anchor, (emojiName) => {
            this.handleToggleReaction(message, emojiName);
        });
    }

    private renderContext(): RenderContext {
        const context: RenderContext = {
            serverOrigin: this.getAttribute("server") ?? undefined,
            currentUserId: this.client?.getCurrentUserId(),
        };
        if (this.hasAttribute("read-only") || this.hasAttribute("snapshot-url")) {
            // Read-only + snapshot modes don't accumulate unread state or
            // mutate messages, so no separator or action handlers.
            return context;
        }
        context.unreadAnchorId = this.state.unreadAnchorId;
        context.onToggleReaction = (m, e) => {
            this.handleToggleReaction(m, e);
        };
        context.onAddReaction = (m, anchor) => {
            this.handleAddReaction(m, anchor);
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
                enhanceSpoilers(this.feedEl);
                // Lazy-load KaTeX CSS the first time we render math. Safe
                // to call repeatedly — it's a no-op once injected.
                enhanceKatex(
                    this.feedEl,
                    this.shadow,
                    this.getAttribute("katex-css") ?? undefined,
                );
                const banner = document.createElement("div");
                banner.className = "feed-top-banner";
                if (this.state.loadingOlder) {
                    banner.textContent = "Loading older messages…";
                } else if (!this.state.hasMore && this.state.messages.length > 0) {
                    banner.textContent = "Beginning of history";
                    banner.classList.add("feed-top-banner-end");
                } else {
                    banner.hidden = true;
                }
                this.feedEl.prepend(banner);
            }
        }

        if (this.newMessagesPillEl) {
            const show =
                this.state.unreadAnchorId !== undefined &&
                !this.hasAttribute("read-only") &&
                !this.hasAttribute("snapshot-url");
            if (show) {
                const n = this.state.unreadCount;
                this.newMessagesPillEl.textContent =
                    n > 0
                        ? `${String(n)} new ${n === 1 ? "message" : "messages"} ↓`
                        : "New messages ↓";
                this.newMessagesPillEl.hidden = false;
            } else {
                this.newMessagesPillEl.hidden = true;
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
