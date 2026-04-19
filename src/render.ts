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
    onAddReaction?: ((message: Message) => void) | undefined;
}

export function renderMessages(
    container: HTMLElement,
    messages: Message[],
    context: RenderContext = {},
): void {
    container.replaceChildren();
    if (messages.length === 0) {
        const empty = document.createElement("div");
        empty.className = "feed-empty";
        empty.textContent = "No messages yet — say hello.";
        container.append(empty);
        return;
    }

    let previousSenderId: number | undefined;
    for (const message of messages) {
        const node = renderMessage(message, previousSenderId === message.senderId, context);
        container.append(node);
        previousSenderId = message.senderId;
    }
}

export function renderMessage(
    message: Message,
    sameSender: boolean,
    context: RenderContext = {},
): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = sameSender ? "message same-sender" : "message";
    wrapper.dataset["messageId"] = String(message.id);

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
    return wrapper;
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
];

// Origin used by the sanitizer hook to resolve relative upload URLs. Set
// via a closure on sanitizeHtml so each call can override safely.
let activeServerOrigin: string | undefined;
let hooksInstalled = false;

function installHooks(): void {
    if (hooksInstalled) return;
    hooksInstalled = true;

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
            ALLOW_ARIA_ATTR: false,
            ALLOW_UNKNOWN_PROTOCOLS: false,
            // Belt-and-braces: reject any URI that isn't http(s) or mailto
            // before our afterSanitizeAttributes hook even runs. The hook
            // further resolves + re-validates, but this ensures obvious
            // javascript: / data: / vbscript: hrefs are already gone.
            ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
            FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input"],
            FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
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
            context.onAddReaction?.(message);
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
const EMOJI_GLYPHS: Record<string, string> = {
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
