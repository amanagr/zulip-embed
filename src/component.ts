import {ZulipClient} from "./client.ts";
import {
    insertAtCursor,
    prefixLines,
    wrapCodeBlock,
    wrapLink,
    wrapSelection,
} from "./compose-format.ts";
import {DemoTransport} from "./demo-transport.ts";
import {createEmojiPicker, type EmojiPickerHandle} from "./emoji-picker.ts";
import {enhanceKatex} from "./katex.ts";
import {
    EMOJI_GLYPHS,
    isNearBottom,
    renderMessages,
    scrollToBottom,
    type RenderContext,
} from "./render.ts";
import {SnapshotTransport} from "./snapshot-transport.ts";
import {enhanceSpoilers} from "./spoilers.ts";
import {COMPONENT_STYLES} from "./styles.ts";
import type {Transport} from "./transport.ts";
import type {
    ConnectionStatus,
    Message,
    Reaction,
    ScopeFilter,
    TypingUser,
} from "./types.ts";
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
    "brand-logo",
    "brand-name",
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
// Compact 16x16 icons shared by the formatting toolbar. `currentColor`
// so they pick up --zc-color-text / the disabled state for free.
const ICON_ATTRS = `viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
const SEND_ICON_SVG = `<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M1.724 10.528 17.88 3.31a.6.6 0 0 1 .81.701L15.06 17.68a.6.6 0 0 1-1.135.113l-3.145-6.29a.6.6 0 0 0-.266-.267L4.224 8.09a.6.6 0 0 1-.008-1.077"/></svg>`;
const LINK_ICON_SVG = `<svg ${ICON_ATTRS}><path d="M6.5 9.5a3 3 0 0 0 4.24 0l2.12-2.12a3 3 0 1 0-4.24-4.24l-1.06 1.06"/><path d="M9.5 6.5a3 3 0 0 0-4.24 0L3.14 8.62a3 3 0 1 0 4.24 4.24l1.06-1.06"/></svg>`;
const QUOTE_ICON_SVG = `<svg ${ICON_ATTRS}><path d="M3 6h1.5a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H3zM9 6h1.5a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H9z"/></svg>`;
const BULLET_ICON_SVG = `<svg ${ICON_ATTRS}><circle cx="3" cy="4" r="1" fill="currentColor"/><circle cx="3" cy="8" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><path d="M6 4h8M6 8h8M6 12h8"/></svg>`;
const NUMBERED_ICON_SVG = `<svg ${ICON_ATTRS}><path d="M6 4h8M6 8h8M6 12h8"/><path d="M2 3v2M2 3h.5M1.5 5h1M1 7.5c0-.5.5-1 1-1s1 .5 1 1c0 1-2 1.5-2 2.5h2M1.5 10.5h1v1H1.5zM1.5 11.5h1v1H1.5z" stroke-width="1"/></svg>`;
const SPOILER_ICON_SVG = `<svg ${ICON_ATTRS}><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.75"/></svg>`;
const MENTION_ICON_SVG = `<svg ${ICON_ATTRS}><circle cx="8" cy="8" r="2.5"/><path d="M10.5 8v1.25a1.75 1.75 0 0 0 3.5 0V8a6 6 0 1 0-2.4 4.8"/></svg>`;
const EMOJI_ICON_SVG = `<svg ${ICON_ATTRS}><circle cx="8" cy="8" r="6"/><circle cx="6" cy="7" r=".75" fill="currentColor"/><circle cx="10" cy="7" r=".75" fill="currentColor"/><path d="M5.5 10a3.5 3.5 0 0 0 5 0"/></svg>`;

function addSeparator(bar: HTMLElement): void {
    const sep = document.createElement("span");
    sep.className = "composer-tool-sep";
    sep.setAttribute("aria-hidden", "true");
    bar.append(sep);
}

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
    // Users currently typing in this scope. Transport-reported; empty
    // when no one is typing.
    typingUsers: TypingUser[];
    // Id of the message the composer is currently editing. When set,
    // the Send button morphs into "Save" and emits an editMessage call
    // instead of sendMessage. Cleared on save / cancel / navigation.
    editingMessageId: number | undefined;
}

// Interval (ms) between "start" pings while the user is actively
// keystroking. Zulip expects a refresh every ~10s; 8s gives headroom.
const TYPING_REFRESH_MS = 8000;
// After the user stops keystroking for this long, emit op=stop.
const TYPING_IDLE_MS = 5000;

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
        typingUsers: [],
        editingMessageId: undefined,
    };
    private initToken = 0;
    private feedEl: HTMLElement | undefined;
    private emojiPicker: EmojiPickerHandle | undefined;
    private newMessagesPillEl: HTMLButtonElement | undefined;
    private composerInputEl: HTMLTextAreaElement | undefined;
    private composerSendEl: HTMLButtonElement | undefined;
    private headerChannelEl: HTMLElement | undefined;
    private headerTopicEl: HTMLElement | undefined;
    private headerBrandLogoEl: HTMLImageElement | undefined;
    private statusDotEl: HTMLElement | undefined;
    private errorBannerEl: HTMLElement | undefined;
    private typingIndicatorEl: HTMLElement | undefined;
    private editBannerEl: HTMLElement | undefined;
    private editBannerLabelEl: HTMLElement | undefined;
    private attachedToDom = false;
    // Typing-send bookkeeping. `typingActive` tracks whether the most
    // recent ping we sent was a "start" (so we know to send "stop" on
    // idle or on send). The refresh timer re-sends "start" every
    // TYPING_REFRESH_MS; the idle timer fires "stop" after
    // TYPING_IDLE_MS of no keystrokes.
    private typingActive = false;
    private typingIdleTimer: ReturnType<typeof setTimeout> | undefined;
    private typingRefreshTimer: ReturnType<typeof setTimeout> | undefined;

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
        if (REINIT_ATTRIBUTES.has(name)) {
            void this.bootstrapClient();
            return;
        }
        // Presentation-only attributes (brand-logo, brand-name, theme,
        // read-only, etc.) shouldn't tear down the connection, but they
        // do need a DOM refresh so the header picks up the new value.
        this.applyStateToDom();
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

        const logo = document.createElement("img");
        logo.className = "header-brand-logo";
        logo.alt = "";
        logo.hidden = true;
        logo.decoding = "async";
        logo.loading = "lazy";
        this.headerBrandLogoEl = logo;
        header.append(logo);

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

        // "Editing: original message preview" banner with a Cancel link.
        // Only visible while state.editingMessageId is set.
        const editBanner = document.createElement("div");
        editBanner.className = "composer-edit-banner";
        editBanner.hidden = true;
        const editLabel = document.createElement("span");
        editLabel.textContent = "Editing message";
        editBanner.append(editLabel);
        this.editBannerLabelEl = editLabel;
        const cancel = document.createElement("button");
        cancel.className = "composer-edit-cancel";
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => {
            this.cancelEdit();
        });
        editBanner.append(cancel);
        this.editBannerEl = editBanner;
        composer.append(editBanner);

        // Typing indicator sits above the input row so it doesn't shift
        // the composer layout as users come and go.
        const typing = document.createElement("div");
        typing.className = "typing-indicator";
        typing.setAttribute("aria-live", "polite");
        typing.hidden = true;
        this.typingIndicatorEl = typing;
        composer.append(typing);

        const input = document.createElement("textarea");
        input.className = "composer-input";
        input.placeholder = this.composerPlaceholder();
        input.rows = 1;
        input.setAttribute("aria-label", "Message");
        input.addEventListener("input", () => {
            this.autosize(input);
            this.refreshSendButton();
            this.onComposerKeystroke();
        });
        input.addEventListener("keydown", (event) => this.onComposerKeydown(event, input));
        this.composerInputEl = input;

        // Formatting toolbar. Sits above the textarea so it reads left-
        // to-right as users scan from most-common (bold) to least-common
        // (emoji) actions, matching Zulip's web composer.
        composer.append(this.buildComposerToolbar(input));

        const row = document.createElement("div");
        row.className = "composer-row";
        row.append(input);

        const send = document.createElement("button");
        send.className = "composer-send";
        send.type = "button";
        send.setAttribute("aria-label", "Send message");
        send.title = "Send (Enter)";
        send.disabled = true;
        send.innerHTML = SEND_ICON_SVG;
        send.addEventListener("click", () => {
            void this.handleSend();
        });
        this.composerSendEl = send;
        row.append(send);

        composer.append(row);

        const hint = document.createElement("div");
        hint.className = "composer-hint";
        hint.textContent = "Enter to send · Shift+Enter for newline · Markdown supported";
        composer.append(hint);

        return composer;
    }

    // Formatting-toolbar row: bold / italic / strike / code / link /
    // quote / bullet list / numbered list / emoji. Each button acts on
    // the composer textarea via compose-format helpers so a browser
    // sees one atomic edit (and undo stays intact). Labels are plain
    // text so a missing webfont doesn't break the UI.
    private buildComposerToolbar(input: HTMLTextAreaElement): HTMLElement {
        const bar = document.createElement("div");
        bar.className = "composer-toolbar";
        bar.setAttribute("role", "toolbar");
        bar.setAttribute("aria-label", "Formatting");

        const add = (
            label: string,
            title: string,
            action: () => void,
            className = "",
        ): HTMLButtonElement => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = `composer-tool ${className}`.trim();
            b.title = title;
            b.setAttribute("aria-label", title);
            b.innerHTML = label;
            b.addEventListener("mousedown", (event) => {
                // Keep focus in the textarea so the selection survives.
                event.preventDefault();
            });
            b.addEventListener("click", (event) => {
                event.preventDefault();
                action();
            });
            bar.append(b);
            return b;
        };

        add("<strong>B</strong>", "Bold (Ctrl+B)", () => wrapSelection(input, "**", "**", "bold"));
        add("<em>I</em>", "Italic (Ctrl+I)", () => wrapSelection(input, "*", "*", "italic"));
        add("<s>S</s>", "Strikethrough", () => wrapSelection(input, "~~", "~~", "strike"));
        add("<code>&lt;/&gt;</code>", "Code (Ctrl+E)", () => wrapCodeBlock(input), "mono");
        add(LINK_ICON_SVG, "Link (Ctrl+K)", () => wrapLink(input));
        addSeparator(bar);
        add(QUOTE_ICON_SVG, "Quote", () => prefixLines(input, "> "));
        add(BULLET_ICON_SVG, "Bulleted list", () => prefixLines(input, "- "));
        add(NUMBERED_ICON_SVG, "Numbered list", () => prefixLines(input, "1. "));
        add(SPOILER_ICON_SVG, "Spoiler", () =>
            wrapSelection(input, "```spoiler\n", "\n```", "hidden text"),
        );
        add(MENTION_ICON_SVG, "Mention (@)", () => insertAtCursor(input, "@"));
        addSeparator(bar);
        add(EMOJI_ICON_SVG, "Emoji", () => {
            if (this.emojiPicker === undefined) return;
            if (this.emojiPicker.isOpen()) {
                this.emojiPicker.close();
                return;
            }
            const anchor = bar.lastElementChild as HTMLElement;
            this.emojiPicker.open(anchor, (emojiName) => {
                const glyph = EMOJI_GLYPHS[emojiName] ?? `:${emojiName}:`;
                insertAtCursor(input, glyph);
            });
        });

        return bar;
    }

    // Composer placeholder reflects the current scope so users always
    // know where their message will land. Mirrors Zulip's own composer:
    //     Message #general > welcome
    private composerPlaceholder(): string {
        const channel = this.getAttribute("channel") ?? "general";
        const topic = this.getAttribute("topic");
        if (topic !== null && topic !== "") {
            return `Message #${channel} > ${topic}`;
        }
        return `Message #${channel}`;
    }

    // Keydown handler shared between the main composer and (later) the
    // in-place edit textarea. Returns true if the event was handled so
    // callers can skip default textarea behaviour.
    private onComposerKeydown(event: KeyboardEvent, input: HTMLTextAreaElement): void {
        // Markdown formatting shortcuts. Zulip web binds Ctrl/Cmd+B for
        // bold, Ctrl/Cmd+I for italic, Ctrl/Cmd+K for link, Ctrl/Cmd+E
        // for code — we match so muscle memory carries over.
        const mod = event.ctrlKey || event.metaKey;
        if (mod && !event.shiftKey && !event.altKey) {
            switch (event.key.toLowerCase()) {
                case "b":
                    event.preventDefault();
                    wrapSelection(input, "**", "**", "bold");
                    return;
                case "i":
                    event.preventDefault();
                    wrapSelection(input, "*", "*", "italic");
                    return;
                case "k":
                    event.preventDefault();
                    wrapLink(input);
                    return;
                case "e":
                    event.preventDefault();
                    wrapCodeBlock(input);
                    return;
            }
        }
        // Ctrl/Cmd+Enter: save (when editing) or send (always).
        if (mod && event.key === "Enter") {
            event.preventDefault();
            void this.handleSend();
            return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void this.handleSend();
            return;
        }
        if (event.key === "Escape" && this.state.editingMessageId !== undefined) {
            // Stop the event before the root-level handler treats it
            // as a "close floating panel" request — when editing, the
            // user almost certainly means "abandon this edit".
            event.stopPropagation();
            this.cancelEdit();
        }
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
        this.composerSendEl.textContent =
            this.state.editingMessageId !== undefined ? "Save" : "Send";
    }

    private async bootstrapClient(): Promise<void> {
        await this.teardownClient();
        if (!this.attachedToDom) return;

        const token = ++this.initToken;
        const scope = this.readScope();
        this.stopTyping({silent: true});
        this.setState({
            messages: [],
            status: "connecting",
            error: undefined,
            loading: true,
            hasMore: false,
            loadingOlder: false,
            unreadAnchorId: undefined,
            unreadCount: 0,
            typingUsers: [],
            editingMessageId: undefined,
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
            } else if (event.type === "typing") {
                // Never show the local viewer in their own indicator.
                const selfId = this.client?.getCurrentUserId();
                const others =
                    selfId === undefined
                        ? event.users
                        : event.users.filter((u) => u.userId !== selfId);
                this.setState({typingUsers: others});
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
        // Fire a best-effort "stop" before disconnecting so the server
        // doesn't keep showing this viewer as typing to teammates.
        this.stopTyping();
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
        const patch: Partial<ComponentState> = {
            messages: next,
            unreadAnchorId,
            unreadCount,
        };
        // If the message being edited was just deleted (locally or by
        // another client), abandon the pending edit so the composer
        // isn't pointed at a phantom id.
        if (this.state.editingMessageId === id) {
            patch.editingMessageId = undefined;
            if (this.composerInputEl) {
                this.composerInputEl.value = "";
                this.autosize(this.composerInputEl);
            }
        }
        this.setState(patch);
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
        context.editingMessageId = this.state.editingMessageId;
        context.onToggleReaction = (m, e) => {
            this.handleToggleReaction(m, e);
        };
        context.onAddReaction = (m, anchor) => {
            this.handleAddReaction(m, anchor);
        };
        context.onEditMessage = (m) => {
            this.startEdit(m);
        };
        context.onDeleteMessage = (m) => {
            void this.handleDelete(m);
        };
        return context;
    }

    private startEdit(message: Message): void {
        // Only the message author can edit. Even though the renderer
        // already gates the action menu on `senderId === currentUserId`,
        // re-check here in case a caller invokes startEdit directly.
        const uid = this.client?.getCurrentUserId();
        if (uid === undefined || message.senderId !== uid) return;
        // Editing server-rendered HTML would require de-rendering back to
        // markdown, which we can't do reliably. For v0.1 we only support
        // editing messages whose content we still have as plain text —
        // messages the local viewer just sent (before the server echo
        // replaces them with HTML). We optimistically prefill the HTML
        // string; users can rewrite from scratch if they prefer.
        if (!this.composerInputEl) return;
        this.composerInputEl.value = message.contentIsHtml
            ? stripHtmlToText(message.content)
            : message.content;
        this.autosize(this.composerInputEl);
        this.setState({editingMessageId: message.id});
        this.composerInputEl.focus();
    }

    private cancelEdit(): void {
        if (this.state.editingMessageId === undefined) return;
        if (this.composerInputEl) {
            this.composerInputEl.value = "";
            this.autosize(this.composerInputEl);
        }
        this.setState({editingMessageId: undefined});
    }

    private async handleDelete(message: Message): Promise<void> {
        if (!this.client) return;
        // Native confirm() is crude but adequate for v0.1 — a custom
        // in-shadow dialog can replace it later without changing the
        // transport plumbing. JSDOM stubs confirm to always return true,
        // so component tests can still exercise the delete path.
        const ok = window.confirm("Delete this message? This can't be undone.");
        if (!ok) return;
        // If the message being deleted is the one currently being
        // edited, cancel the edit first so we don't leave the composer
        // pointed at a nonexistent id.
        if (this.state.editingMessageId === message.id) this.cancelEdit();
        try {
            await this.client.deleteMessage(message.id);
        } catch (error) {
            this.setState({error: describeError(error)});
        }
    }

    private async handleSend(): Promise<void> {
        if (!this.client || !this.composerInputEl) return;
        const content = this.composerInputEl.value.trim();
        if (content.length === 0) return;
        if (this.state.status !== "connected") return;

        const scope = this.readScope();
        const editingId = this.state.editingMessageId;
        this.composerInputEl.value = "";
        this.autosize(this.composerInputEl);
        // Stop typing before the network call so teammates don't see a
        // lingering indicator after the new message lands.
        this.stopTyping();
        if (editingId !== undefined) {
            this.setState({editingMessageId: undefined});
        } else {
            this.refreshSendButton();
        }

        try {
            if (editingId !== undefined) {
                await this.client.editMessage({messageId: editingId, content});
            } else {
                await this.client.sendMessage({
                    type: "channel",
                    channel: scope.channel,
                    topic: scope.topic,
                    content,
                });
            }
        } catch (error) {
            this.setState({error: describeError(error)});
        }
    }

    // Called on every composer keystroke. Sends a "start" typing ping
    // the first time (and refreshes every TYPING_REFRESH_MS while the
    // user keeps typing), and schedules a "stop" after TYPING_IDLE_MS
    // of silence. No-op in read-only / snapshot mode since there is no
    // server to notify.
    private onComposerKeystroke(): void {
        if (!this.client) return;
        if (this.hasAttribute("read-only") || this.hasAttribute("snapshot-url")) {
            return;
        }
        if (this.composerInputEl?.value.trim().length === 0) {
            // Empty composer after a keystroke (e.g. backspace-to-empty)
            // should behave like an explicit stop.
            this.stopTyping();
            return;
        }
        if (!this.typingActive) {
            this.typingActive = true;
            this.sendTypingPing("start");
            this.typingRefreshTimer = setInterval(() => {
                if (this.typingActive) this.sendTypingPing("start");
            }, TYPING_REFRESH_MS);
        }
        if (this.typingIdleTimer !== undefined) {
            clearTimeout(this.typingIdleTimer);
        }
        this.typingIdleTimer = setTimeout(() => {
            this.stopTyping();
        }, TYPING_IDLE_MS);
    }

    // Tear down all typing state. When `silent` is true we skip the
    // network ping (used at bootstrap where there is no live session
    // to end) but still clear timers.
    private stopTyping(options: {silent?: boolean} = {}): void {
        if (this.typingIdleTimer !== undefined) {
            clearTimeout(this.typingIdleTimer);
            this.typingIdleTimer = undefined;
        }
        if (this.typingRefreshTimer !== undefined) {
            clearInterval(this.typingRefreshTimer);
            this.typingRefreshTimer = undefined;
        }
        if (this.typingActive) {
            this.typingActive = false;
            if (options.silent !== true) this.sendTypingPing("stop");
        }
    }

    private sendTypingPing(op: "start" | "stop"): void {
        const client = this.client;
        if (!client) return;
        const scope = this.readScope();
        // Swallow errors — typing is best-effort; a failed ping must
        // never surface as a user-visible error banner.
        client.sendTyping(op, scope).catch(() => undefined);
    }

    private setState(patch: Partial<ComponentState>): void {
        this.state = {...this.state, ...patch};
        this.applyStateToDom();
    }

    private applyStateToDom(): void {
        if (!this.attachedToDom) return;
        const scope = this.readScope();
        const brandName = this.getAttribute("brand-name");
        const brandLogo = this.getAttribute("brand-logo");

        if (this.headerChannelEl) {
            // brand-name overrides the channel label so adopters can bill
            // the widget as "Acme Support" instead of "#general". The
            // leading "#" glyph comes from the ::before pseudo, which we
            // suppress via data-brand-name when a brand name is set.
            if (brandName !== null && brandName !== "") {
                this.headerChannelEl.textContent = brandName;
                this.headerChannelEl.dataset["brandName"] = "1";
            } else {
                this.headerChannelEl.textContent = scope.channel;
                delete this.headerChannelEl.dataset["brandName"];
            }
        }
        if (this.headerTopicEl) {
            this.headerTopicEl.textContent = scope.topic ?? "";
            this.headerTopicEl.hidden = scope.topic === undefined;
        }
        if (this.headerBrandLogoEl) {
            // Only set src when we've validated the URL; an invalid value
            // hides the <img> rather than letting the browser try to load
            // an attacker-controlled data:/javascript: URI.
            const safeLogo = brandLogo === null ? "" : sanitizeBrandLogoUrl(brandLogo);
            if (safeLogo === "") {
                this.headerBrandLogoEl.removeAttribute("src");
                this.headerBrandLogoEl.hidden = true;
            } else {
                if (this.headerBrandLogoEl.getAttribute("src") !== safeLogo) {
                    this.headerBrandLogoEl.src = safeLogo;
                }
                this.headerBrandLogoEl.hidden = false;
            }
        }
        if (this.statusDotEl) {
            this.statusDotEl.dataset["status"] = this.state.status;
            this.statusDotEl.title = `Status: ${this.state.status}`;
        }

        if (this.composerInputEl !== undefined) {
            const next = this.composerPlaceholder();
            if (this.composerInputEl.placeholder !== next) {
                this.composerInputEl.placeholder = next;
            }
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

        if (this.editBannerEl && this.editBannerLabelEl) {
            const editingId = this.state.editingMessageId;
            if (editingId === undefined) {
                this.editBannerEl.hidden = true;
                this.editBannerLabelEl.textContent = "Editing message";
            } else {
                this.editBannerEl.hidden = false;
                this.editBannerLabelEl.textContent = `Editing message #${String(editingId)}`;
            }
        }

        if (this.typingIndicatorEl) {
            const label = formatTypingLabel(this.state.typingUsers);
            if (label === undefined) {
                this.typingIndicatorEl.hidden = true;
                this.typingIndicatorEl.textContent = "";
            } else {
                this.typingIndicatorEl.hidden = false;
                this.typingIndicatorEl.textContent = label;
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

// Crude HTML→text coercion used to prefill the composer when the viewer
// edits a message whose content we only have as server-rendered HTML.
// We accept lossy round-tripping for v0.1; markdown-round-tripping would
// require a markdown generator we don't yet ship. A throwaway template
// parses the HTML safely (no script execution) and returns textContent.
function stripHtmlToText(html: string): string {
    const template = document.createElement("template");
    template.innerHTML = html;
    return (template.content.textContent ?? "").trim();
}

// Build the "Alice is typing" / "Alice and Bob are typing" / "Several
// Accept brand-logo only when it's a safe absolute http(s) URL or a
// relative path the browser will resolve against the page. Same threat
// model as validateSnapshotUrl: data:/javascript:/file: URIs would
// otherwise become an injection vector the embed host rarely scrutinizes.
function sanitizeBrandLogoUrl(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed === "") return "";
    if (trimmed.startsWith("//")) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
            return parsed.toString();
        }
    } catch {
        return "";
    }
    return "";
}

// people are typing" label shown above the composer. Returns undefined
// when no one else is typing so the caller can hide the row entirely.
function formatTypingLabel(users: TypingUser[]): string | undefined {
    if (users.length === 0) return undefined;
    const names = users.map((u) => u.fullName.trim()).filter((n) => n.length > 0);
    if (names.length === 0) return "Someone is typing";
    if (names.length === 1) return `${names[0]!} is typing`;
    if (names.length === 2) return `${names[0]!} and ${names[1]!} are typing`;
    return "Several people are typing";
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
