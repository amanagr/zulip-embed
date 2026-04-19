import {avatarColor, formatTimeOfDay, getInitials} from "./format.ts";
import type {Message} from "./types.ts";

export function renderMessages(container: HTMLElement, messages: Message[]): void {
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
        const node = renderMessage(message, previousSenderId === message.senderId);
        container.append(node);
        previousSenderId = message.senderId;
    }
}

export function renderMessage(message: Message, sameSender: boolean): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = sameSender ? "message same-sender" : "message";
    wrapper.dataset["messageId"] = String(message.id);

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.background = avatarColor(message.senderId);
    avatar.textContent = getInitials(message.senderFullName);
    avatar.setAttribute("aria-hidden", "true");
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
    renderContent(content, message);
    body.append(content);

    wrapper.append(body);
    return wrapper;
}

function renderContent(target: HTMLElement, message: Message): void {
    if (message.contentIsHtml) {
        // Zulip's server returns sanitized HTML, but embed hosts should treat
        // it as untrusted. v0.1 falls back to textContent until a sanitizer
        // (e.g., DOMPurify) is wired up in a later iteration.
        target.textContent = stripHtmlTags(message.content);
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
        link.href = url;
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

function stripHtmlTags(html: string): string {
    return html.replaceAll(/<[^>]*>/g, "").replaceAll(/\s+/g, " ").trim();
}

export function scrollToBottom(feed: HTMLElement): void {
    feed.scrollTop = feed.scrollHeight;
}

export function isNearBottom(feed: HTMLElement, threshold = 80): boolean {
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight < threshold;
}
