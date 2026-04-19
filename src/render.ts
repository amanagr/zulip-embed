import DOMPurify from "dompurify";

import {avatarColor, formatTimeOfDay, getInitials} from "./format.ts";
import {
    ACTION_ICONS,
    DEFAULT_MESSAGE_ACTIONS,
    resolveMessageActions,
    type MessageActionDescriptor,
    type MessageActionHostContext,
} from "./message-actions.ts";
import type {
    ConfirmationMessagePart,
    Message,
    MessagePart,
    Reaction,
    ZulipConfirmationResponseEventDetail,
} from "./types.ts";

export interface RenderContext {
    // Absolute origin (e.g. https://zulip.example.com) used to resolve
    // relative upload URLs in message HTML. Undefined for demo messages.
    serverOrigin?: string | undefined;
    // Current user id — used to mark reactions that "you" have applied so
    // the pill renders in the active state.
    currentUserId?: number | undefined;
    // Emitted when the viewer clicks a reaction pill.
    onToggleReaction?: ((message: Message, emoji: string) => void) | undefined;
    // Emitted when the viewer clicks the "add reaction" affordance on a
    // reaction row (the small "+" next to existing pills). The per-message
    // action bar's "add-reaction" entry routes through
    // `messageActionHostContext.onAddReaction` instead.
    onAddReaction?: ((message: Message, anchor: HTMLElement) => void) | undefined;
    // ID of the first message the viewer hasn't seen yet. When set, the
    // renderer inserts a horizontal "new messages" divider immediately
    // before the matching message.
    unreadAnchorId?: number | undefined;
    // Id of a message currently being edited — the renderer tints the
    // matching row so the viewer sees which message the composer is
    // editing.
    editingMessageId?: number | undefined;
    // Ordered list of built-in + custom action ids to render for each
    // message. Undefined falls back to DEFAULT_MESSAGE_ACTIONS.
    messageActionIds?: readonly string[] | undefined;
    // Host-supplied context used to resolve built-in actions into concrete
    // descriptors (edit / delete / copy / open-in-zulip). Undefined means
    // "don't render an action bar at all" — useful in read-only snapshot
    // mode where none of the side-effects would work anyway.
    messageActionHostContext?: MessageActionHostContext | undefined;
    // Adopter-supplied custom descriptors appended to the resolved list.
    // These bypass the id allow-list on the attribute — hosts inject them
    // via the `messageActions` JS property.
    messageActionsExtra?: readonly MessageActionDescriptor[] | undefined;
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
    actionsKey: string;
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
    return {
        content: message.content,
        contentIsHtml: message.contentIsHtml,
        reactionsKey,
        sameSender,
        currentUserId: context.currentUserId,
        isEditing: context.editingMessageId === message.id,
        actionsKey: computeActionsKey(message, context),
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
        a.actionsKey === b.actionsKey
    );
}

function computeActionsKey(message: Message, context: RenderContext): string {
    const host = context.messageActionHostContext;
    if (host === undefined) return "";
    const ids = context.messageActionIds ?? DEFAULT_MESSAGE_ACTIONS;
    const isOwn = host.currentUserId !== undefined && message.senderId === host.currentUserId;
    const extraIds = (context.messageActionsExtra ?? []).map((d) => d.id);
    return `${ids.join(",")}|${extraIds.join(",")}|${isOwn ? "1" : "0"}`;
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
        const sameSender = index === unreadAnchorIndex ? false : prevSenderId === message.senderId;

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

// Per-message action affordance. The renderer asks `message-actions.ts`
// to split the configured ids into "inline" (icon buttons) and "overflow"
// (kebab-menu items); anything that's inapplicable for this viewer / this
// message (e.g. `onlyOwn` on a message they didn't send) is filtered out
// upstream. Returns undefined when nothing would render — that way a
// rogue CSS rule can't light up an empty bar.
function renderMessageActions(message: Message, context: RenderContext): HTMLElement | undefined {
    const host = context.messageActionHostContext;
    if (host === undefined) return undefined;
    const ids = context.messageActionIds ?? DEFAULT_MESSAGE_ACTIONS;
    const extra = context.messageActionsExtra ?? [];
    const {inline, overflow} = resolveMessageActions(ids, host, message, extra);
    if (inline.length === 0 && overflow.length === 0) return undefined;

    const bar = document.createElement("div");
    bar.className = "message-actions";

    for (const descriptor of inline) {
        bar.append(makeActionButton(descriptor, message));
    }

    if (overflow.length > 0) {
        bar.append(makeOverflowMenu(overflow, message));
    }

    return bar;
}

function makeActionButton(
    descriptor: MessageActionDescriptor,
    message: Message,
): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
        descriptor.variant === "danger" ? "message-action message-action-danger" : "message-action";
    button.dataset["actionId"] = descriptor.id;
    button.setAttribute("aria-label", descriptor.label);
    button.title = descriptor.label;
    if (descriptor.icon !== undefined) {
        button.innerHTML = descriptor.icon;
    } else {
        button.textContent = descriptor.label;
    }
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        descriptor.run(message, button);
    });
    return button;
}

function makeOverflowMenu(
    items: readonly MessageActionDescriptor[],
    message: Message,
): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "message-action-overflow";

    const kebab = document.createElement("button");
    kebab.type = "button";
    kebab.className = "message-action message-action-kebab";
    kebab.setAttribute("aria-label", "More actions");
    kebab.setAttribute("aria-haspopup", "menu");
    kebab.setAttribute("aria-expanded", "false");
    kebab.title = "More actions";
    kebab.innerHTML = ACTION_ICONS.kebab;
    wrap.append(kebab);

    const menu = document.createElement("div");
    menu.className = "message-actions-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    for (const descriptor of items) {
        const item = document.createElement("button");
        item.type = "button";
        item.className =
            descriptor.variant === "danger"
                ? "message-actions-item message-actions-item-danger"
                : "message-actions-item";
        item.setAttribute("role", "menuitem");
        item.dataset["actionId"] = descriptor.id;
        if (descriptor.icon !== undefined) {
            const iconSpan = document.createElement("span");
            iconSpan.className = "message-actions-item-icon";
            iconSpan.innerHTML = descriptor.icon;
            item.append(iconSpan);
        }
        const label = document.createElement("span");
        label.className = "message-actions-item-label";
        label.textContent = descriptor.label;
        item.append(label);
        item.addEventListener("click", (event) => {
            event.stopPropagation();
            setOpen(false);
            descriptor.run(message, item);
        });
        menu.append(item);
    }
    wrap.append(menu);

    // The dropdown dismiss listener needs to live on the shadow root (or
    // document, if we're not inside a shadow) so it catches clicks from
    // the entire widget. Attach lazily on first open so we can read the
    // right root once the node is mounted.
    let listenersAttached = false;
    const setOpen = (open: boolean): void => {
        menu.hidden = !open;
        kebab.setAttribute("aria-expanded", open ? "true" : "false");
    };
    const onRootClick = (event: Event): void => {
        if (menu.hidden) return;
        const target = event.target;
        if (!(target instanceof Node)) {
            setOpen(false);
            return;
        }
        if (!wrap.contains(target)) setOpen(false);
    };
    const onRootKey = (event: Event): void => {
        if (menu.hidden) return;
        if (!(event instanceof KeyboardEvent)) return;
        if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            kebab.focus();
        }
    };
    const attachRootListeners = (): void => {
        if (listenersAttached) return;
        listenersAttached = true;
        const root = wrap.getRootNode();
        root.addEventListener("click", onRootClick, {capture: true});
        (root as unknown as EventTarget).addEventListener("keydown", onRootKey, {
            capture: true,
        });
    };

    kebab.addEventListener("click", (event) => {
        event.stopPropagation();
        const willOpen = menu.hidden;
        setOpen(willOpen);
        if (willOpen) attachRootListeners();
    });

    return wrap;
}

function renderContent(target: HTMLElement, message: Message, context: RenderContext): void {
    // If the message carries structured parts, prefer them over the
    // flat content string. Hosts set `parts` when they want agent
    // output (tool calls / results / code blocks) rendered as first
    // class UI rather than as escaped HTML. `content` remains the
    // human-readable fallback for accessibility and copy/paste; we
    // just don't render it when parts is present.
    if (message.parts !== undefined && message.parts.length > 0) {
        for (const part of message.parts) {
            target.append(renderPart(part));
        }
        return;
    }
    if (message.contentIsHtml) {
        target.append(sanitizeHtml(message.content, context.serverOrigin));
        return;
    }
    renderPlainText(target, message.content);
}

function renderPart(part: MessagePart): HTMLElement {
    if (part.type === "text") {
        const wrap = document.createElement("span");
        wrap.classList.add("part-text");
        renderPlainText(wrap, part.text);
        return wrap;
    }
    if (part.type === "code") {
        const pre = document.createElement("pre");
        pre.classList.add("part-code");
        const code = document.createElement("code");
        if (part.language !== undefined) {
            // Use the hljs-compatible convention so a future syntax
            // highlighter plugin can hook in without a schema change.
            code.className = `language-${part.language}`;
        }
        code.textContent = part.code;
        pre.append(code);
        return pre;
    }
    if (part.type === "tool_call") {
        const box = document.createElement("div");
        box.classList.add("part-tool-call");
        box.dataset["toolCallId"] = part.id;
        if (part.status !== undefined) box.dataset["status"] = part.status;
        const header = document.createElement("div");
        header.classList.add("part-tool-call-header");
        header.textContent = `🔧 ${part.name}`;
        box.append(header);
        const input = document.createElement("pre");
        input.classList.add("part-tool-call-input");
        input.textContent = safeStringify(part.input);
        box.append(input);
        return box;
    }
    if (part.type === "tool_result") {
        const box = document.createElement("div");
        box.classList.add("part-tool-result");
        box.dataset["toolCallId"] = part.toolCallId;
        if (part.isError === true) box.dataset["error"] = "true";
        const output = document.createElement("pre");
        output.classList.add("part-tool-result-output");
        output.textContent = safeStringify(part.output);
        box.append(output);
        return box;
    }
    // confirmation
    return renderConfirmationPart(part);
}

function renderConfirmationPart(part: ConfirmationMessagePart): HTMLElement {
    const card = document.createElement("div");
    card.classList.add("confirmation-card");
    card.dataset["confirmationId"] = part.id;
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", "Confirm tool call");

    const prompt = document.createElement("div");
    prompt.classList.add("confirmation-prompt");
    prompt.textContent = part.prompt;
    card.append(prompt);

    const actions = document.createElement("div");
    actions.classList.add("confirmation-actions");

    const approveLabel = part.approveLabel ?? "Approve";
    const denyLabel = part.denyLabel ?? "Deny";
    const approve = makeConfirmationButton(part, "approve", approveLabel);
    const deny = makeConfirmationButton(part, "deny", denyLabel);
    actions.append(approve, deny);
    card.append(actions);

    // Single shared click handler: on the first click, both buttons
    // disable immediately (idempotency) and a bubbling CustomEvent is
    // dispatched so the component and any outer listener can react.
    // A second click on either button is a no-op because the `disabled`
    // flag is checked before the event fires.
    const onClick = (event: Event): void => {
        const target = event.currentTarget;
        if (!(target instanceof HTMLButtonElement)) return;
        if (approve.disabled || deny.disabled) return;
        approve.disabled = true;
        deny.disabled = true;
        const action = target.dataset["confirmationAction"] === "approve" ? "approve" : "deny";
        card.dataset["confirmationResolved"] = action;
        // `composed: false` keeps the event inside the shadow root so
        // only the component's shadow-root listener sees it. The
        // component then re-emits a composed event on the host
        // element for embedders to pick up — that way there's exactly
        // one "your confirmation was clicked" event on the host per
        // click, regardless of how deep the widget sits.
        card.dispatchEvent(
            new CustomEvent<ZulipConfirmationResponseEventDetail>("zulip-confirmation-response", {
                detail: {id: part.id, action, payloadSig: part.payloadSig},
                bubbles: true,
                composed: false,
            }),
        );
    };
    approve.addEventListener("click", onClick);
    deny.addEventListener("click", onClick);

    return card;
}

function makeConfirmationButton(
    part: ConfirmationMessagePart,
    action: "approve" | "deny",
    label: string,
): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("confirmation-button", action);
    button.dataset["confirmationId"] = part.id;
    button.dataset["confirmationAction"] = action;
    button.dataset["confirmationSig"] = part.payloadSig;
    button.textContent = label;
    return button;
}

function safeStringify(value: unknown): string {
    // Tool calls / results carry arbitrary JSON from the agent. We
    // serialize for display but guard against circular refs (a BFS
    // agent loop could easily produce them) and against throwing on
    // unsupported values like BigInt.
    try {
        return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
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
// image-set / -webkit-image-set / cross-fade / src / paint / element can
// each carry URL references without a literal `url(` token, so they go
// in the deny list too. Without this, a crafted KaTeX span could smuggle
// `background: image-set("https://attacker/..." 1x)` past the url()
// check and exfiltrate reading data on hover/scroll.
function isSafeStyleValue(value: string): boolean {
    const lower = value.toLowerCase();
    if (lower.includes("url(")) return false;
    if (lower.includes("image-set(")) return false;
    if (lower.includes("cross-fade(")) return false;
    if (lower.includes("src(")) return false;
    if (lower.includes("paint(")) return false;
    if (lower.includes("element(")) return false;
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
            ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\?|\/(?!\/)|\.\.?\/|[^:/?#]+(?:$|[/?#]))/i,
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
