import {describe, expect, test} from "vitest";

import {
    isNearBottom,
    renderMessage,
    sanitizeHtml,
    scrollToBottom,
} from "../src/render.ts";
import type {Message} from "../src/types.ts";

// Covers code paths in render.ts that the primary suite doesn't exercise:
// plain-text autolinking (for non-HTML transports like DemoTransport),
// the edit/delete action bar, anchor link safety branches, and the
// scroll-helper invariants used by the feed viewport logic.

function plainTextMessage(content: string, senderId = 11): Message {
    return {
        id: 1,
        senderId,
        senderFullName: "Iago",
        senderEmail: "iago@zulip.com",
        avatarUrl: "",
        timestamp: Date.now(),
        content,
        contentIsHtml: false,
        type: "channel",
        channelName: "announce",
        topic: "t",
        reactions: [],
    };
}

describe("plain-text rendering (contentIsHtml=false)", () => {
    test("autolinks http and https URLs into anchor tags", () => {
        const msg = plainTextMessage("visit http://ex.com and https://foo.bar");
        const node = renderMessage(msg, false, {serverOrigin: "https://chat.example.com"});
        const anchors = node.querySelectorAll<HTMLAnchorElement>(".message-content a");
        expect(anchors).toHaveLength(2);
        expect(anchors[0]?.href).toBe("http://ex.com/");
        expect(anchors[1]?.href).toBe("https://foo.bar/");
        // Target + rel pinned so links open in a new tab without opener.
        expect(anchors[0]?.target).toBe("_blank");
        expect(anchors[0]?.rel).toContain("noopener");
        expect(anchors[0]?.rel).toContain("noreferrer");
    });

    test("text around the URL is preserved as plain text nodes", () => {
        const msg = plainTextMessage("see https://ex.com now");
        const node = renderMessage(msg, false, {});
        const content = node.querySelector(".message-content");
        // Order: text "see ", anchor, text " now"
        expect(content?.textContent).toBe("see https://ex.com now");
        expect(content?.querySelectorAll("a").length).toBe(1);
    });

    test("does not autolink non-http schemes (javascript:, data:)", () => {
        // The regex intentionally anchors on http(s)://. Anything else is
        // rendered as text, never a clickable link. Pin this so the regex
        // can't be loosened without someone looking at the test.
        const msg = plainTextMessage("bad javascript:alert(1) data:text/html,x");
        const node = renderMessage(msg, false, {});
        expect(node.querySelector(".message-content a")).toBeNull();
        expect(node.querySelector(".message-content")?.textContent).toContain("javascript:");
    });

    test("HTML-looking text in a plain-text message is escaped, not parsed", () => {
        // textContent assignment escapes; the sanitizer is never invoked on
        // this branch. A regression that flipped the branch would let XSS
        // slip in from a future non-HTML transport.
        const msg = plainTextMessage("<script>alert(1)</script><img src=x onerror=alert(2)>");
        const node = renderMessage(msg, false, {});
        expect(node.querySelector("script")).toBeNull();
        expect(node.querySelector("img")).toBeNull();
        expect(node.querySelector(".message-content")?.textContent).toContain("<script>");
    });

    test("multiple URLs in one paragraph each become their own anchor", () => {
        const msg = plainTextMessage("a https://one.example b https://two.example c");
        const node = renderMessage(msg, false, {});
        expect(node.querySelectorAll(".message-content a").length).toBe(2);
    });
});

describe("renderMessage action bar (edit/delete buttons)", () => {
    test("shows edit + delete only for the viewer's own messages", () => {
        const mine = plainTextMessage("mine", 11);
        const notMine = plainTextMessage("theirs", 22);
        const ctx = {
            currentUserId: 11,
            onEditMessage: () => {},
            onDeleteMessage: () => {},
        };
        expect(renderMessage(mine, false, ctx).querySelector(".message-actions")).not.toBeNull();
        expect(renderMessage(notMine, false, ctx).querySelector(".message-actions")).toBeNull();
    });

    test("edit button is absent when only onDeleteMessage is provided", () => {
        const mine = plainTextMessage("m", 11);
        const node = renderMessage(mine, false, {
            currentUserId: 11,
            onDeleteMessage: () => {},
        });
        expect(node.querySelector('[aria-label="Edit message"]')).toBeNull();
        expect(node.querySelector('[aria-label="Delete message"]')).not.toBeNull();
    });

    test("delete button is absent when only onEditMessage is provided", () => {
        const mine = plainTextMessage("m", 11);
        const node = renderMessage(mine, false, {
            currentUserId: 11,
            onEditMessage: () => {},
        });
        expect(node.querySelector('[aria-label="Edit message"]')).not.toBeNull();
        expect(node.querySelector('[aria-label="Delete message"]')).toBeNull();
    });

    test("action bar is omitted when neither handler is provided even for own message", () => {
        const mine = plainTextMessage("m", 11);
        const node = renderMessage(mine, false, {currentUserId: 11});
        expect(node.querySelector(".message-actions")).toBeNull();
    });

    test("clicking edit/delete invokes the respective handler with the message", () => {
        const mine = plainTextMessage("m", 11);
        let editArg: Message | undefined;
        let deleteArg: Message | undefined;
        const node = renderMessage(mine, false, {
            currentUserId: 11,
            onEditMessage: (m) => (editArg = m),
            onDeleteMessage: (m) => (deleteArg = m),
        });
        node.querySelector<HTMLButtonElement>('[aria-label="Edit message"]')?.click();
        node.querySelector<HTMLButtonElement>('[aria-label="Delete message"]')?.click();
        expect(editArg?.id).toBe(1);
        expect(deleteArg?.id).toBe(1);
    });

    test("action bar is omitted when currentUserId is undefined (anonymous viewer)", () => {
        const mine = plainTextMessage("m", 11);
        const node = renderMessage(mine, false, {
            onEditMessage: () => {},
            onDeleteMessage: () => {},
        });
        expect(node.querySelector(".message-actions")).toBeNull();
    });
});

describe("sanitizeHtml — anchor url branches", () => {
    test("mailto: anchors survive", () => {
        const fragment = sanitizeHtml(
            `<a href="mailto:alice@ex.com">mail</a>`,
            undefined,
        );
        const host = document.createElement("div");
        host.append(fragment);
        expect(host.querySelector("a")?.getAttribute("href")).toBe("mailto:alice@ex.com");
    });

    test("tel: / ftp: / file: anchors are stripped of href", () => {
        // isSafeAnchorUrl only allows http(s) and mailto. Anything else
        // has its href removed so the anchor degrades to inert text.
        for (const href of ["tel:+15551234", "ftp://ex.com/f", "file:///etc/passwd"]) {
            const fragment = sanitizeHtml(`<a href="${href}">x</a>`, undefined);
            const host = document.createElement("div");
            host.append(fragment);
            expect(host.querySelector("a")?.getAttribute("href")).toBeNull();
        }
    });

    test("relative anchor hrefs resolve against serverOrigin when provided", () => {
        const fragment = sanitizeHtml(
            `<a href="/#narrow/stream/1-general">link</a>`,
            "https://chat.example.com",
        );
        const host = document.createElement("div");
        host.append(fragment);
        const href = host.querySelector("a")?.getAttribute("href");
        expect(href).toBe("https://chat.example.com/#narrow/stream/1-general");
    });

    test("relative image src without serverOrigin is dropped rather than left dangling", () => {
        const fragment = sanitizeHtml(
            `<img src="/user_uploads/x.png" alt="a">`,
            undefined,
        );
        const host = document.createElement("div");
        host.append(fragment);
        // No origin to resolve against — image is removed by the hook to
        // avoid a broken or dangling relative path.
        expect(host.querySelector("img")).toBeNull();
    });
});

describe("scroll helpers", () => {
    test("scrollToBottom sets scrollTop to scrollHeight", () => {
        const feed = document.createElement("div");
        Object.defineProperty(feed, "scrollHeight", {value: 1234, configurable: true});
        Object.defineProperty(feed, "scrollTop", {value: 0, writable: true, configurable: true});
        scrollToBottom(feed);
        expect(feed.scrollTop).toBe(1234);
    });

    test("isNearBottom is true when within threshold of the bottom", () => {
        const feed = document.createElement("div");
        Object.defineProperty(feed, "scrollHeight", {value: 1000, configurable: true});
        Object.defineProperty(feed, "clientHeight", {value: 400, configurable: true});
        // 1000 - 570 - 400 = 30, within default 80 threshold.
        Object.defineProperty(feed, "scrollTop", {value: 570, configurable: true});
        expect(isNearBottom(feed)).toBe(true);
    });

    test("isNearBottom is false when scrolled well above the bottom", () => {
        const feed = document.createElement("div");
        Object.defineProperty(feed, "scrollHeight", {value: 1000, configurable: true});
        Object.defineProperty(feed, "clientHeight", {value: 400, configurable: true});
        Object.defineProperty(feed, "scrollTop", {value: 0, configurable: true});
        // 1000 - 0 - 400 = 600, nowhere near 80.
        expect(isNearBottom(feed)).toBe(false);
    });

    test("isNearBottom honors a custom threshold", () => {
        const feed = document.createElement("div");
        Object.defineProperty(feed, "scrollHeight", {value: 1000, configurable: true});
        Object.defineProperty(feed, "clientHeight", {value: 400, configurable: true});
        Object.defineProperty(feed, "scrollTop", {value: 400, configurable: true});
        // 1000 - 400 - 400 = 200. Fails default threshold (80), passes 300.
        expect(isNearBottom(feed)).toBe(false);
        expect(isNearBottom(feed, 300)).toBe(true);
    });
});
