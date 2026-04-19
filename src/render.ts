import DOMPurify from "dompurify";

import {avatarColor, formatTimeOfDay, getInitials} from "./format.ts";
import type {Message, Reaction} from "./types.ts";

export interface RenderContext {
    // Absolute origin (e.g. https://zulip.example.com) used to resolve
    // relative upload URLs in message HTML. Undefined for demo messages.
    serverOrigin?: string | undefined;
    // Current user id — used to mark reactions that "you" have applied so
    // the pill renders in the active state.
    currentUserId?: number | undefined;
    // Emitted when the viewer clicks a reaction pill.
    onToggleReaction?: ((message: Message, emoji: string) => void) | undefined;
    // Emitted when the viewer clicks the "add reaction" affordance.
    // The anchor element is the clicked button, used by the host to
    // position an emoji picker next to it.
    onAddReaction?: ((message: Message, anchor: HTMLElement) => void) | undefined;
    // Emitted when the viewer picks "Edit" from a message's action menu.
    // Only offered for messages the viewer authored (senderId matches
    // currentUserId). Host prefills the composer in edit mode.
    onEditMessage?: ((message: Message) => void) | undefined;
    // Emitted when the viewer picks "Delete". Host is responsible for
    // confirmation UX before actually calling the transport.
    onDeleteMessage?: ((message: Message) => void) | undefined;
    // ID of the first message the viewer hasn't seen yet. When set, the
    // renderer inserts a horizontal "new messages" divider immediately
    // before the matching message.
    unreadAnchorId?: number | undefined;
    // Id of a message currently being edited — the renderer tints the
    // matching row so the viewer sees which message the composer is
    // editing.
    editingMessageId?: number | undefined;
}

// Per-DOM-node snapshot of what we last rendered for a given message, so
// we can skip re-rendering when the message is structurally unchanged.
// Using a WeakMap means we don't leak once the node detaches.
const renderedSnapshot = new WeakMap<HTMLElement, MessageSnapshot>();

interface MessageSnapshot {
    content: string;
    contentIsHtml: boolean;
    reactionsKey: string;
    sameSender: boolean;
    currentUserId: number | undefined;
    isEditing: boolean;
    hasActions: boolean;
}

function snapshotFor(
    message: Message,
    sameSender: boolean,
    context: RenderContext,
): MessageSnapshot {
    // Serialize reactions compactly; order is stable from the transport.
    const reactionsKey = message.reactions
        .map((r) => `${r.emoji}:${r.userIds.slice().sort().join(",")}`)
        .join("|");
    const isMine =
        context.currentUserId !== undefined && message.senderId === context.currentUserId;
    return {
        content: message.content,
        contentIsHtml: message.contentIsHtml,
        reactionsKey,
        sameSender,
        currentUserId: context.currentUserId,
        isEditing: context.editingMessageId === message.id,
        hasActions:
            isMine &&
            (context.onEditMessage !== undefined ||
                context.onDeleteMessage !== undefined),
    };
}

function snapshotsEqual(a: MessageSnapshot, b: MessageSnapshot): boolean {
    return (
        a.content === b.content &&
        a.contentIsHtml === b.contentIsHtml &&
        a.reactionsKey === b.reactionsKey &&
        a.sameSender === b.sameSender &&
        a.currentUserId === b.currentUserId &&
        a.isEditing === b.isEditing &&
        a.hasActions === b.hasActions
    );
}

// Render messages by reconciling against the DOM already inside `container`
// instead of rebuilding from scratch. This keeps scroll position stable
// when a single message is appended, edited, or reacted to — the DOM only
// changes for the specific node that changed.
export function renderMessages(
    container: HTMLElement,
    messages: Message[],
    context: RenderContext = {},
): void {
    if (messages.length === 0) {
        const empty = document.createElement("div");
        empty.className = "feed-empty";
        empty.textContent = "No messages yet — say hello.";
        container.replaceChildren(empty);
        return;
    }

    // Remove any non-message children (empty-state placeholder, loader,
    // prior unread separator). Banners + separator are re-added below /
    // by the component after this call returns.
    for (const child of [...container.children]) {
        const el = child as HTMLElement;
        if (el.dataset["messageId"] === undefined) el.remove();
    }

    const existing = new Map<string, HTMLElement>();
    for (const child of [...container.children]) {
        const el = child as HTMLElement;
        const id = el.dataset["messageId"];
        if (id !== undefined) existing.set(id, el);
    }

    // Determine where (if anywhere) to place the unread separator. Only
    // show it if the anchor id actually matches a message we're rendering
    // and isn't the very first message (no point in a separator with
    // nothing above it).
    let unreadAnchorIndex = -1;
    if (context.unreadAnchorId !== undefined) {
        unreadAnchorIndex = messages.findIndex((m) => m.id === context.unreadAnchorId);
        if (unreadAnchorIndex <= 0) unreadAnchorIndex = -1;
    }

    let prevSenderId: number | undefined;
    let prevNode: ChildNode | null = null;
    for (const [index, message] of messages.entries()) {
        // The separator counts as "a different sender above" for spacing
        // purposes — force a full avatar/meta on the message right after.
        const sameSender =
            index === unreadAnchorIndex ? false : prevSenderId === message.senderId;

        if (index === unreadAnchorIndex) {
            const separator = buildUnreadSeparator();
            const expectedAfter: ChildNode | null =
                prevNode === null ? container.firstChild : prevNode.nextSibling;
            if (expectedAfter !== separator) {
                container.insertBefore(separator, expectedAfter);
            }
            prevNode = separator;
        }

        const key = String(message.id);
        let node = existing.get(key);
        if (node === undefined) {
            node = renderMessage(message, sameSender, context);
            renderedSnapshot.set(node, snapshotFor(message, sameSender, context));
        } else {
            const prev = renderedSnapshot.get(node);
            const next = snapshotFor(message, sameSender, context);
            if (prev === undefined || !snapshotsEqual(prev, next)) {
                const fresh = renderMessage(message, sameSender, context);
                renderedSnapshot.set(fresh, next);
                node.replaceWith(fresh);
                node = fresh;
            }
            existing.delete(key);
        }
        // Move into position without detaching if already correct.
        const expectedAfter: ChildNode | null =
            prevNode === null ? container.firstChild : prevNode.nextSibling;
        if (expectedAfter !== (node as ChildNode)) {
            container.insertBefore(node, expectedAfter);
        }
        prevNode = node;
        prevSenderId = message.senderId;
    }

    // Anything left over is a message that was deleted or moved out of
    // view — drop it.
    for (const leftover of existing.values()) leftover.remove();
}

function buildUnreadSeparator(): HTMLElement {
    const el = document.createElement("div");
    el.className = "unread-separator";
    el.dataset["unreadSeparator"] = "";
    el.setAttribute("role", "separator");
    el.setAttribute("aria-label", "New messages");
    const label = document.createElement("span");
    label.className = "unread-separator-label";
    label.textContent = "New messages";
    el.append(label);
    return el;
}

export function renderMessage(
    message: Message,
    sameSender: boolean,
    context: RenderContext = {},
): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = sameSender ? "message same-sender" : "message";
    wrapper.dataset["messageId"] = String(message.id);
    if (context.editingMessageId === message.id) {
        wrapper.classList.add("message-editing");
    }

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    const safeAvatar = safeImageUrl(message.avatarUrl, context.serverOrigin);
    if (safeAvatar !== undefined) {
        const img = document.createElement("img");
        img.src = safeAvatar;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        avatar.append(img);
    } else {
        avatar.style.background = avatarColor(message.senderId);
        avatar.textContent = getInitials(message.senderFullName);
    }
    wrapper.append(avatar);

    const body = document.createElement("div");
    body.className = "message-body";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const sender = document.createElement("span");
    sender.className = "message-sender";
    sender.textContent = message.senderFullName;
    meta.append(sender);

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTimeOfDay(message.timestamp);
    time.title = new Date(message.timestamp).toLocaleString();
    meta.append(time);

    body.append(meta);

    const content = document.createElement("div");
    content.className = "message-content";
    renderContent(content, message, context);
    body.append(content);

    if (message.reactions.length > 0 || context.onAddReaction !== undefined) {
        body.append(renderReactions(message, context));
    }

    wrapper.append(body);

    const actions = renderMessageActions(message, context);
    if (actions !== undefined) wrapper.append(actions);

    return wrapper;
}

// Per-message action affordance shown on hover/focus for the viewer's
// own messages. Returns undefined when the context has no handlers or
// the viewer didn't author the message — we don't even attach the
// element so a rogue CSS rule can't make it clickable.
function renderMessageActions(
    message: Message,
    context: RenderContext,
): HTMLElement | undefined {
    const mine =
        context.currentUserId !== undefined && message.senderId === context.currentUserId;
    if (!mine) return undefined;
    const canEdit = context.onEditMessage !== undefined;
    const canDelete = context.onDeleteMessage !== undefined;
    if (!canEdit && !canDelete) return undefined;

    const bar = document.createElement("div");
    bar.className = "message-actions";

    if (canEdit) {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "message-action";
        edit.setAttribute("aria-label", "Edit message");
        edit.title = "Edit";
        edit.innerHTML =
            '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l3.5-.7L17.2 5.6a1.5 1.5 0 0 0 0-2.1l-.7-.7a1.5 1.5 0 0 0-2.1 0L3.7 13.5 3 17z"/></svg>';
        edit.addEventListener("click", () => {
            context.onEditMessage?.(message);
        });
        bar.append(edit);
    }

    if (canDelete) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "message-action message-action-danger";
        del.setAttribute("aria-label", "Delete message");
        del.title = "Delete";
        del.innerHTML =
            '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h12M8 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2m1 0v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6h8z"/></svg>';
        del.addEventListener("click", () => {
            context.onDeleteMessage?.(message);
        });
        bar.append(del);
    }

    return bar;
}

function renderContent(target: HTMLElement, message: Message, context: RenderContext): void {
    if (message.contentIsHtml) {
        target.append(sanitizeHtml(message.content, context.serverOrigin));
        return;
    }
    renderPlainText(target, message.content);
}

function renderPlainText(target: HTMLElement, text: string): void {
    const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
    let lastIndex = 0;
    for (const match of text.matchAll(urlRegex)) {
        const start = match.index ?? 0;
        if (start > lastIndex) {
            target.append(document.createTextNode(text.slice(lastIndex, start)));
        }
        const url = match[0];
        const link = document.createElement("a");
        if (isSafeHttpUrl(url)) {
            link.href = url;
        }
        link.textContent = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        target.append(link);
        lastIndex = start + url.length;
    }
    if (lastIndex < text.length) {
        target.append(document.createTextNode(text.slice(lastIndex)));
    }
}

// Allow-list of HTML elements emitted by Zulip's markdown renderer that we
// explicitly want to support. DOMPurify's default list is broader; we want
// to be stricter so that novel tags (scripts, forms, media, etc.) never
// slip through even if the server changes.
const ALLOWED_TAGS = [
    "a",
    "abbr",
    "b",
    "blockquote",
    "br",
    "code",
    "del",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "ins",
    "kbd",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "samp",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "time",
    "tr",
    "u",
    "ul",
];

const ALLOWED_ATTR = [
    "class",
    "href",
    "src",
    "alt",
    "title",
    "data-user-id",
    "data-user-email",
    "data-stream-id",
    "data-topic",
    "data-emoji-code",
    "data-emoji-name",
    "aria-hidden",
    "colspan",
    "rowspan",
    "start",
    "align",
    "datetime",
    // Required for KaTeX-rendered math: the server-side Pygments-style
    // HTML tree positions individual glyphs with inline style declarations
    // (width/margin/transform on stacked .katex-html > span tiers). The
    // `uponSanitizeAttribute` hook below scrubs each style value and drops
    // anything that isn't plain static CSS — no url(), @import, or
    // expression().
    "style",
];

// Origin used by the sanitizer hook to resolve relative upload URLs. Set
// via a closure on sanitizeHtml so each call can override safely.
let activeServerOrigin: string | undefined;
let hooksInstalled = false;

// Reject any CSS declaration that could fetch a network resource, run
// script-like sinks, or import more CSS. Zulip's KaTeX output only uses
// static geometry/typography declarations, so this intersection covers
// the visual math while keeping the CSS attack surface closed.
function isSafeStyleValue(value: string): boolean {
    const lower = value.toLowerCase();
    if (lower.includes("url(")) return false;
    if (lower.includes("@import")) return false;
    if (lower.includes("expression(")) return false;
    if (lower.includes("javascript:")) return false;
    if (lower.includes("/*")) return false; // strip comments that could hide
    if (lower.includes("\\")) return false; // hex escapes can smuggle tokens
    if (lower.includes("behavior:")) return false; // legacy IE
    return true;
}

function installHooks(): void {
    if (hooksInstalled) return;
    hooksInstalled = true;

    DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
        // Scrub inline styles before they land on the node. Anything with
        // url()/@import/expression()/javascript: gets dropped wholesale.
        if (data.attrName === "style" && !isSafeStyleValue(data.attrValue)) {
            data.keepAttr = false;
        }
    });

    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
        if (!(node instanceof Element)) return;

        if (node.tagName === "A") {
            const href = node.getAttribute("href") ?? "";
            const resolved = resolveUrl(href, activeServerOrigin);
            if (resolved !== undefined && isSafeAnchorUrl(resolved)) {
                node.setAttribute("href", resolved);
            } else {
                node.removeAttribute("href");
            }
            node.setAttribute("target", "_blank");
            node.setAttribute("rel", "noopener noreferrer nofollow ugc");
        }

        if (node.tagName === "IMG") {
            const src = node.getAttribute("src") ?? "";
            const resolved = resolveUrl(src, activeServerOrigin);
            if (resolved !== undefined && isSafeHttpUrl(resolved)) {
                node.setAttribute("src", resolved);
            } else {
                // Drop the element entirely rather than leave a broken img
                // whose src was stripped — a broken image icon is noise.
                node.remove();
                return;
            }
            node.setAttribute("loading", "lazy");
            node.setAttribute("decoding", "async");
            node.setAttribute("referrerpolicy", "no-referrer");
        }

        // Zulip sets target="_blank" on links via markdown sometimes; we
        // already handle that above. No other elements need attribute
        // rewriting.
    });
}

export function sanitizeHtml(html: string, serverOrigin: string | undefined): DocumentFragment {
    installHooks();
    activeServerOrigin = serverOrigin;
    try {
        const fragment = DOMPurify.sanitize(html, {
            ALLOWED_TAGS,
            ALLOWED_ATTR,
            ALLOW_DATA_ATTR: false,
            // aria-* passes through on any allowed element. KaTeX relies
            // on aria-hidden to hide the visual subtree from AT; Zulip's
            // output also marks alt-text fallbacks with aria-hidden. These
            // are accessibility annotations with no XSS surface.
            ALLOW_ARIA_ATTR: true,
            ALLOW_UNKNOWN_PROTOCOLS: false,
            // Belt-and-braces: reject any URI that isn't http(s), mailto,
            // a fragment, a query, or a relative path before our
            // afterSanitizeAttributes hook runs. The hook further
            // resolves + re-validates — this backstop just ensures
            // obvious javascript:/data:/vbscript:/blob:/file: hrefs and
            // protocol-relative URLs (//evil.tld) never reach it, even
            // if a future refactor forgets to install the hook.
            //
            // Matched: `https?:`, `mailto:`, `#anchor`, `?q=1`, `/abs`
            // (not `//`), `./rel`, `../rel`, `bare`, `sub/path`.
            // Rejected: `javascript:`, `data:`, `vbscript:`, `blob:`,
            // `file:`, `//evil.tld`, anything with a non-allowed scheme.
            ALLOWED_URI_REGEXP:
                /^(?:https?:|mailto:|#|\?|\/(?!\/)|\.\.?\/|[^:/?#]+(?:$|[/?#]))/i,
            FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input"],
            // Note: `style` is intentionally *not* forbidden at the attr
            // level — we need it for KaTeX layout and scrub the value
            // via the uponSanitizeAttribute hook above.
            FORBID_ATTR: ["onerror", "onload", "onclick"],
            USE_PROFILES: {html: true},
            RETURN_DOM_FRAGMENT: true,
        });
        return fragment;
    } finally {
        activeServerOrigin = undefined;
    }
}

function renderReactions(message: Message, context: RenderContext): HTMLElement {
    const row = document.createElement("div");
    row.className = "reactions";

    for (const reaction of message.reactions) {
        row.append(renderReactionPill(message, reaction, context));
    }

    if (context.onAddReaction !== undefined) {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "reaction-add";
        add.setAttribute("aria-label", "Add reaction");
        add.innerHTML =
            '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M7 8.5v.01M13 8.5v.01M7 12c.8.9 1.8 1.5 3 1.5s2.2-.6 3-1.5"/></svg>';
        add.addEventListener("click", () => {
            context.onAddReaction?.(message, add);
        });
        row.append(add);
    }

    return row;
}

function renderReactionPill(
    message: Message,
    reaction: Reaction,
    context: RenderContext,
): HTMLButtonElement {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "reaction";
    const mine =
        context.currentUserId !== undefined && reaction.userIds.includes(context.currentUserId);
    if (mine) pill.classList.add("reaction-mine");
    pill.setAttribute(
        "aria-label",
        `${reaction.emoji}, ${String(reaction.count)} ${reaction.count === 1 ? "person" : "people"}${mine ? " (including you)" : ""}`,
    );

    const emoji = document.createElement("span");
    emoji.className = "reaction-emoji";
    emoji.textContent = emojiToGlyph(reaction.emoji);
    pill.append(emoji);

    const count = document.createElement("span");
    count.className = "reaction-count";
    count.textContent = String(reaction.count);
    pill.append(count);

    pill.addEventListener("click", () => {
        context.onToggleReaction?.(message, reaction.emoji);
    });
    return pill;
}

// Fallback mapping from Zulip emoji names (snake_case) to Unicode glyphs
// for the handful that appear in demo content. Real Zulip servers return
// the emoji via the message HTML (as <span class="emoji emoji-…">), so
// this path only fires for plain-text demo reactions. We render the name
// verbatim if unknown.
export const EMOJI_GLYPHS: Record<string, string> = {
    "+1": "👍",
    thumbs_up: "👍",
    "-1": "👎",
    thumbs_down: "👎",
    tada: "🎉",
    heart: "❤️",
    eyes: "👀",
    rocket: "🚀",
    fire: "🔥",
    check: "✅",
    octopus: "🐙",
    smile: "😄",
    laughing: "😂",
    thinking: "🤔",
    party: "🥳",
    wave: "👋",
    pray: "🙏",
    clap: "👏",
    bug: "🐛",
    sparkles: "✨",
};

function emojiToGlyph(name: string): string {
    return EMOJI_GLYPHS[name] ?? `:${name}:`;
}

function isSafeHttpUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

function isSafeAnchorUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return (
            parsed.protocol === "http:" ||
            parsed.protocol === "https:" ||
            parsed.protocol === "mailto:"
        );
    } catch {
        return false;
    }
}

function safeImageUrl(url: string, serverOrigin: string | undefined): string | undefined {
    if (url === "") return undefined;
    const resolved = resolveUrl(url, serverOrigin);
    if (resolved === undefined) return undefined;
    return isSafeHttpUrl(resolved) ? resolved : undefined;
}

// Resolve a possibly-relative URL from Zulip markup against the configured
// server origin. Absolute URLs pass through unchanged; data:/javascript:
// URLs return undefined so the sanitizer strips them.
function resolveUrl(url: string, serverOrigin: string | undefined): string | undefined {
    const trimmed = url.trim();
    if (trimmed === "") return undefined;
    // Block every non-HTTP scheme up front, including javascript: / data: /
    // vbscript: / file: — these must not reach the DOM even if the
    // sanitizer would otherwise allow them (e.g. on <a>).
    const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
    if (schemeMatch !== null) {
        const scheme = schemeMatch[1]?.toLowerCase();
        if (scheme !== "http" && scheme !== "https" && scheme !== "mailto") {
            return undefined;
        }
        return trimmed;
    }
    if (serverOrigin === undefined) return undefined;
    try {
        return new URL(trimmed, serverOrigin).toString();
    } catch {
        return undefined;
    }
}

export function scrollToBottom(feed: HTMLElement): void {
    feed.scrollTop = feed.scrollHeight;
}

export function isNearBottom(feed: HTMLElement, threshold = 80): boolean {
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight < threshold;
}
