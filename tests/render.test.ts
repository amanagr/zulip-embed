import {describe, expect, test} from "vitest";

import {renderMessage, renderMessages, sanitizeHtml} from "../src/render.ts";
import type {Message} from "../src/types.ts";

function htmlMessage(content: string): Message {
    return {
        id: 1,
        senderId: 11,
        senderFullName: "Iago",
        senderEmail: "iago@zulip.com",
        avatarUrl: "",
        timestamp: Date.now(),
        content,
        contentIsHtml: true,
        type: "channel",
        channelName: "announce",
        topic: "server releases",
        reactions: [],
    };
}

describe("sanitizeHtml", () => {
    test("preserves Zulip markdown output", () => {
        const fragment = sanitizeHtml(
            "<p><strong>hi</strong> <em>there</em> <code>ok</code></p>",
            "https://chat.example.com",
        );
        const host = document.createElement("div");
        host.append(fragment);
        expect(host.querySelector("strong")?.textContent).toBe("hi");
        expect(host.querySelector("em")?.textContent).toBe("there");
        expect(host.querySelector("code")?.textContent).toBe("ok");
    });

    test("strips script tags and event handlers", () => {
        const fragment = sanitizeHtml(
            `<p>hi<script>alert(1)</script><img src=x onerror="alert(1)"></p>`,
            "https://chat.example.com",
        );
        const host = document.createElement("div");
        host.append(fragment);
        expect(host.querySelector("script")).toBeNull();
        expect(host.innerHTML).not.toContain("onerror");
    });

    test("drops javascript: hrefs and javascript: image src", () => {
        const fragment = sanitizeHtml(
            `<a href="javascript:alert(1)">click</a><img src="javascript:alert(1)">`,
            "https://chat.example.com",
        );
        const host = document.createElement("div");
        host.append(fragment);
        const anchor = host.querySelector("a");
        expect(anchor?.getAttribute("href")).toBeNull();
        expect(host.querySelector("img")).toBeNull();
    });

    test("resolves relative upload URLs against server origin", () => {
        const fragment = sanitizeHtml(
            `<p><img src="/user_uploads/123.png" alt="shot"></p>`,
            "https://chat.example.com",
        );
        const host = document.createElement("div");
        host.append(fragment);
        const img = host.querySelector("img");
        expect(img?.getAttribute("src")).toBe("https://chat.example.com/user_uploads/123.png");
        expect(img?.getAttribute("loading")).toBe("lazy");
    });

    test("preserves Pygments token classes on nested spans", () => {
        // Zulip runs fenced code blocks through Pygments, which emits
        // <span class="k"> / <span class="s"> / etc. under a
        // .codehilite wrapper. The bundled syntax theme targets these
        // classes, so they have to survive the sanitizer intact.
        const fragment = sanitizeHtml(
            `<div class="codehilite"><pre><code class="language-python"><span class="k">def</span> <span class="nf">f</span><span class="p">():</span> <span class="k">pass</span></code></pre></div>`,
            "https://chat.example.com",
        );
        const host = document.createElement("div");
        host.append(fragment);
        expect(host.querySelector(".codehilite")).not.toBeNull();
        expect(host.querySelector("span.k")?.textContent).toBe("def");
        expect(host.querySelector("span.nf")?.textContent).toBe("f");
        expect(host.querySelector("code.language-python")).not.toBeNull();
    });

    test("anchor links get noopener + _blank", () => {
        const fragment = sanitizeHtml(
            `<a href="https://example.com">x</a>`,
            "https://chat.example.com",
        );
        const host = document.createElement("div");
        host.append(fragment);
        const anchor = host.querySelector("a");
        expect(anchor?.getAttribute("target")).toBe("_blank");
        expect(anchor?.getAttribute("rel")).toContain("noopener");
        expect(anchor?.getAttribute("rel")).toContain("noreferrer");
    });
});

describe("renderMessage", () => {
    test("renders the sanitized HTML body", () => {
        const message = htmlMessage("<p>Hello <strong>world</strong></p>");
        const node = renderMessage(message, false, {serverOrigin: "https://chat.example.com"});
        expect(node.querySelector(".message-content strong")?.textContent).toBe("world");
    });

    test("inserts an unread separator above the anchor message", () => {
        const container = document.createElement("div");
        const messages: Message[] = [
            {...htmlMessage("<p>a</p>"), id: 1},
            {...htmlMessage("<p>b</p>"), id: 2},
            {...htmlMessage("<p>c</p>"), id: 3},
        ];
        renderMessages(container, messages, {unreadAnchorId: 2});
        const children = [...container.children];
        // Expect: msg1, separator, msg2, msg3
        expect(children.length).toBe(4);
        expect((children[0] as HTMLElement).dataset["messageId"]).toBe("1");
        expect((children[1] as HTMLElement).classList.contains("unread-separator")).toBe(true);
        expect((children[2] as HTMLElement).dataset["messageId"]).toBe("2");
        expect((children[3] as HTMLElement).dataset["messageId"]).toBe("3");
    });

    test("does not insert a separator when the anchor is the first message", () => {
        const container = document.createElement("div");
        const messages: Message[] = [
            {...htmlMessage("<p>a</p>"), id: 1},
            {...htmlMessage("<p>b</p>"), id: 2},
        ];
        renderMessages(container, messages, {unreadAnchorId: 1});
        expect(container.querySelector(".unread-separator")).toBeNull();
    });

    test("omits the separator when the anchor does not match any message", () => {
        const container = document.createElement("div");
        const messages: Message[] = [
            {...htmlMessage("<p>a</p>"), id: 1},
            {...htmlMessage("<p>b</p>"), id: 2},
        ];
        renderMessages(container, messages, {unreadAnchorId: 999});
        expect(container.querySelector(".unread-separator")).toBeNull();
    });

    test("repositions the separator across re-renders", () => {
        const container = document.createElement("div");
        const messages: Message[] = [
            {...htmlMessage("<p>a</p>"), id: 1},
            {...htmlMessage("<p>b</p>"), id: 2},
            {...htmlMessage("<p>c</p>"), id: 3},
        ];
        renderMessages(container, messages, {unreadAnchorId: 2});
        expect(container.querySelectorAll(".unread-separator").length).toBe(1);
        // Clear the anchor — separator should be gone on the next call.
        renderMessages(container, messages, {});
        expect(container.querySelector(".unread-separator")).toBeNull();
    });

    test("shows reaction pills and calls onToggleReaction", () => {
        let called: {emoji: string; id: number} | undefined;
        const message: Message = {
            ...htmlMessage("<p>hi</p>"),
            reactions: [{emoji: "tada", count: 2, userIds: [11, 12]}],
        };
        const node = renderMessage(message, false, {
            serverOrigin: "https://chat.example.com",
            currentUserId: 11,
            onToggleReaction: (m, emoji) => {
                called = {emoji, id: m.id};
            },
        });
        const pill = node.querySelector<HTMLButtonElement>(".reaction");
        expect(pill).not.toBeNull();
        expect(pill?.classList.contains("reaction-mine")).toBe(true);
        pill?.click();
        expect(called).toEqual({emoji: "tada", id: 1});
    });
});
