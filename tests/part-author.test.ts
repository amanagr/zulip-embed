import {describe, expect, test} from "vitest";

import {renderMessage} from "../src/render.ts";
import type {
    ConfirmationMessagePart,
    Message,
    MessagePart,
    MessagePartAuthor,
    TextMessagePart,
    ToolCallMessagePart,
    ToolResultMessagePart,
} from "../src/types.ts";

// Stand up a minimal Message carrying a single part. The transport-level
// content / senderFullName / etc. are not exercised by these tests —
// they only poke at the per-part author rendering.
function partMessage(part: MessagePart): Message {
    return {
        id: 1,
        senderId: 99,
        senderFullName: "Orchestrator",
        senderEmail: "orchestrator@example.com",
        avatarUrl: "",
        timestamp: Date.now(),
        content: "",
        contentIsHtml: false,
        parts: [part],
        reactions: [],
        type: "channel",
        channelName: "general",
        topic: "t",
    };
}

describe("MessagePart author attribution", () => {
    test("text part with author renders a .part-author badge containing the name", () => {
        const author: MessagePartAuthor = {id: "planner", name: "Planner"};
        const part: TextMessagePart = {
            type: "text",
            text: "I'll break this down into three steps.",
            author,
        };
        const node = renderMessage(partMessage(part), false);
        const badge = node.querySelector<HTMLElement>(".part-author");
        expect(badge).not.toBeNull();
        expect(badge?.querySelector(".part-author-name")?.textContent).toBe("Planner");
        // No avatar URL → initials fallback.
        expect(badge?.querySelector(".part-author-avatar")).toBeNull();
        expect(badge?.querySelector(".part-author-initials")?.textContent).toBe("P");
    });

    test("tool_call part with author: badge + data-author-id + --part-author-color on card root", () => {
        const author: MessagePartAuthor = {
            id: "researcher-7",
            name: "Research agent",
            color: "#22d3ee",
        };
        const part: ToolCallMessagePart = {
            type: "tool_call",
            id: "tc-1",
            name: "search_docs",
            input: {query: "zulip"},
            author,
        };
        const node = renderMessage(partMessage(part), false);
        const card = node.querySelector<HTMLElement>(".part-tool-call");
        expect(card).not.toBeNull();
        expect(card?.dataset["authorId"]).toBe("researcher-7");
        // The CSS custom property is stamped inline so the left-accent
        // bar selector can hang off it.
        expect(card?.style.getPropertyValue("--part-author-color")).toBe("#22d3ee");
        const badge = card?.querySelector<HTMLElement>(".part-author");
        expect(badge).not.toBeNull();
        expect(badge?.querySelector(".part-author-name")?.textContent).toBe("Research agent");
        // Initials from a multi-word name: first letter of first + last word.
        expect(badge?.querySelector(".part-author-initials")?.textContent).toBe("RA");
    });

    test("invalid (non-hex) color does not leak into inline style", () => {
        const author: MessagePartAuthor = {
            id: "bad",
            name: "B",
            // A crafted string that would, if piped through to `style`
            // naively, trigger a remote fetch via the background
            // shorthand. The validator must reject it.
            color: "red url(https://attacker.example/leak)",
        };
        const part: ToolCallMessagePart = {
            type: "tool_call",
            id: "tc-bad-color",
            name: "noop",
            input: {},
            author,
        };
        const node = renderMessage(partMessage(part), false);
        const card = node.querySelector<HTMLElement>(".part-tool-call");
        expect(card).not.toBeNull();
        // data-author-id still lands — the id is stamped regardless
        // of whether color made the cut.
        expect(card?.dataset["authorId"]).toBe("bad");
        // But the property was NOT set. Empty string is the jsdom
        // reading for a missing custom property.
        expect(card?.style.getPropertyValue("--part-author-color")).toBe("");
        const badge = card?.querySelector<HTMLElement>(".part-author");
        expect(badge?.style.getPropertyValue("--part-author-color")).toBe("");
    });

    test("javascript: avatar URL falls back to initials (no <img> rendered)", () => {
        const author: MessagePartAuthor = {
            id: "xss",
            name: "Evil Agent",
            // eslint-disable-next-line no-script-url
            avatarUrl: "javascript:alert(1)",
        };
        const part: TextMessagePart = {type: "text", text: "hi", author};
        const node = renderMessage(partMessage(part), false);
        const badge = node.querySelector<HTMLElement>(".part-author");
        expect(badge).not.toBeNull();
        expect(badge?.querySelector("img")).toBeNull();
        expect(badge?.querySelector(".part-author-initials")?.textContent).toBe("EA");
    });

    test("http(s) avatar URL renders an <img> with the URL in src", () => {
        const author: MessagePartAuthor = {
            id: "friendly",
            name: "Friendly Bot",
            avatarUrl: "https://cdn.example.com/avatars/friendly.png",
        };
        const part: TextMessagePart = {type: "text", text: "hello", author};
        const node = renderMessage(partMessage(part), false);
        const img = node.querySelector<HTMLImageElement>(".part-author .part-author-avatar");
        expect(img).not.toBeNull();
        expect(img?.src).toBe("https://cdn.example.com/avatars/friendly.png");
        // Mirror the Message avatar hardening — lazy, async, no referrer.
        expect(img?.loading).toBe("lazy");
        expect(img?.referrerPolicy).toBe("no-referrer");
        // Initials must NOT appear alongside the image.
        expect(node.querySelector(".part-author-initials")).toBeNull();
    });

    test("parts without author render unchanged (no badge, no data-author-id)", () => {
        const toolCall: ToolCallMessagePart = {
            type: "tool_call",
            id: "tc-noauth",
            name: "ping",
            input: null,
        };
        const toolResult: ToolResultMessagePart = {
            type: "tool_result",
            toolCallId: "tc-noauth",
            output: "pong",
        };
        const text: TextMessagePart = {type: "text", text: "Done."};
        const confirmation: ConfirmationMessagePart = {
            type: "confirmation",
            id: "conf-noauth",
            prompt: "Proceed?",
            payloadSig: "sig-noauth",
        };
        const message: Message = {
            id: 2,
            senderId: 99,
            senderFullName: "Orchestrator",
            senderEmail: "orchestrator@example.com",
            avatarUrl: "",
            timestamp: Date.now(),
            content: "",
            contentIsHtml: false,
            parts: [toolCall, toolResult, text, confirmation],
            reactions: [],
            type: "channel",
            channelName: "general",
            topic: "t",
        };
        const node = renderMessage(message, false);
        // No author badge anywhere in the rendered subtree.
        expect(node.querySelector(".part-author")).toBeNull();
        // And none of the part roots carry data-author-id.
        for (const selector of [
            ".part-tool-call",
            ".part-tool-result",
            ".message-text-part",
            ".confirmation-card",
        ]) {
            const el = node.querySelector<HTMLElement>(selector);
            expect(el).not.toBeNull();
            expect(el?.dataset["authorId"]).toBeUndefined();
            // No inline --part-author-color either.
            expect(el?.style.getPropertyValue("--part-author-color")).toBe("");
        }
    });

    test("confirmation part with author: badge + accent color on the card root", () => {
        const author: MessagePartAuthor = {
            id: "critic",
            name: "Critic",
            color: "#f59e0b",
        };
        const part: ConfirmationMessagePart = {
            type: "confirmation",
            id: "conf-author",
            prompt: "Ship it?",
            payloadSig: "sig-author",
            author,
        };
        const node = renderMessage(partMessage(part), false);
        const card = node.querySelector<HTMLElement>(".confirmation-card");
        expect(card).not.toBeNull();
        expect(card?.dataset["authorId"]).toBe("critic");
        expect(card?.style.getPropertyValue("--part-author-color")).toBe("#f59e0b");
        const badge = card?.querySelector<HTMLElement>(".part-author");
        expect(badge).not.toBeNull();
        expect(badge?.querySelector(".part-author-name")?.textContent).toBe("Critic");
        // Badge must come before the prompt so the author reads above
        // the content they produced.
        const prompt = card?.querySelector<HTMLElement>(".confirmation-prompt");
        expect(badge).not.toBeNull();
        expect(prompt).not.toBeNull();
        if (
            badge === null ||
            badge === undefined ||
            prompt === null ||
            prompt === undefined
        ) {
            return;
        }
        const relation = badge.compareDocumentPosition(prompt);
        expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
    });
});
