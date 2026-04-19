import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import "../src/index.ts";
import {DemoTransport} from "../src/demo-transport.ts";
import type {
    Message,
    MessageDeleteEvent,
    MessageUpdateEvent,
    ZulipEvent,
} from "../src/types.ts";

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("demo transport edit/delete", () => {
    test("edits the viewer's own message and emits update", async () => {
        const transport = new DemoTransport({scope: {channel: "general"}, autoReply: false});
        const events: ZulipEvent[] = [];
        await transport.connect((e) => events.push(e));
        await transport.sendMessage({
            type: "channel",
            channel: "general",
            topic: "",
            content: "original",
        });
        const sent = events.find((e): e is {type: "message"; message: Message} => e.type === "message");
        const id = sent!.message.id;
        await transport.editMessage({messageId: id, kind: "content", content: "edited"});
        const update = events.find(
            (e): e is MessageUpdateEvent => e.type === "message-update",
        );
        expect(update?.messageId).toBe(id);
        expect(update?.content).toBe("edited");
        expect(update?.contentIsHtml).toBe(false);
        await transport.close();
    });

    test("deletes the viewer's own message and emits delete", async () => {
        const transport = new DemoTransport({scope: {channel: "general"}, autoReply: false});
        const events: ZulipEvent[] = [];
        await transport.connect((e) => events.push(e));
        await transport.sendMessage({
            type: "channel",
            channel: "general",
            topic: "",
            content: "bye",
        });
        const sent = events.find((e): e is {type: "message"; message: Message} => e.type === "message");
        const id = sent!.message.id;
        await transport.deleteMessage(id);
        const del = events.find(
            (e): e is MessageDeleteEvent => e.type === "message-delete",
        );
        expect(del?.messageId).toBe(id);
        await transport.close();
    });

    test("refuses to edit another user's message", async () => {
        const transport = new DemoTransport({scope: {channel: "general"}, autoReply: false});
        await transport.connect(() => undefined);
        // Seeded messages belong to bots, not the guest viewer. Their
        // ids are small positive integers — pick the first one.
        const {messages} = await transport.getMessages({channel: "general"});
        const other = messages.find((m) => m.senderId !== transport.getCurrentUserId());
        expect(other).toBeDefined();
        await expect(
            transport.editMessage({messageId: other!.id, kind: "content", content: "hijack"}),
        ).rejects.toThrow(/your own messages/);
        await transport.close();
    });

    test("read-only demo rejects edits and deletes", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general"},
            readOnly: true,
        });
        await transport.connect(() => undefined);
        await expect(
            transport.editMessage({messageId: 1, kind: "content", content: "x"}),
        ).rejects.toThrow(/read-only/);
        await expect(transport.deleteMessage(1)).rejects.toThrow(/read-only/);
        await transport.close();
    });
});

describe("<zulip-chat> edit flow", () => {
    beforeEach(() => {
        vi.useFakeTimers({shouldAdvanceTime: true});
    });

    afterEach(() => {
        document.body.replaceChildren();
        vi.useRealTimers();
    });

    test("clicking edit prefills the composer and shows a banner", async () => {
        vi.useRealTimers();
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 5; i++) await flush();

        const shadow = el.shadowRoot!;
        const textarea = shadow.querySelector<HTMLTextAreaElement>(".composer-input")!;
        const sendBtn = shadow.querySelector<HTMLButtonElement>(".composer-send")!;

        // Send a message as the guest so we have one we can edit.
        textarea.value = "Hello world";
        textarea.dispatchEvent(new Event("input"));
        sendBtn.click();

        for (let i = 0; i < 3; i++) await flush();

        // Wait for the guest message to render with its action menu.
        const mine = shadow.querySelector<HTMLElement>(
            '.message:last-of-type .message-actions [data-action-id="edit"]',
        );
        expect(mine).not.toBeNull();
        mine!.click();
        await flush();

        expect(textarea.value).toBe("Hello world");
        const banner = shadow.querySelector<HTMLElement>(".composer-edit-banner");
        expect(banner?.hidden).toBe(false);
        expect(sendBtn.textContent).toBe("Save");

        // Hitting Cancel clears the edit mode.
        const cancel = shadow.querySelector<HTMLButtonElement>(".composer-edit-cancel");
        cancel?.click();
        await flush();
        expect(banner?.hidden).toBe(true);
        expect(sendBtn.textContent).toBe("Send");
    });

    test("saving an edit dispatches editMessage and updates the feed", async () => {
        vi.useRealTimers();
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 5; i++) await flush();

        const shadow = el.shadowRoot!;
        const textarea = shadow.querySelector<HTMLTextAreaElement>(".composer-input")!;
        const sendBtn = shadow.querySelector<HTMLButtonElement>(".composer-send")!;

        textarea.value = "first draft";
        textarea.dispatchEvent(new Event("input"));
        sendBtn.click();
        for (let i = 0; i < 3; i++) await flush();

        // Find the guest's message and click edit.
        const editBtn = shadow.querySelector<HTMLButtonElement>(
            '.message:last-of-type .message-actions [data-action-id="edit"]',
        );
        editBtn?.click();
        await flush();

        // Tweak the content and save.
        textarea.value = "second draft";
        textarea.dispatchEvent(new Event("input"));
        sendBtn.click();
        for (let i = 0; i < 3; i++) await flush();

        // The message in the DOM should now read "second draft".
        const contents = shadow.querySelectorAll(".message .message-content");
        const texts = [...contents].map((n) => n.textContent ?? "");
        expect(texts.some((t) => t.includes("second draft"))).toBe(true);
        expect(texts.some((t) => t === "first draft")).toBe(false);
    });

    test("delete action removes the message after confirm", async () => {
        vi.useRealTimers();
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 5; i++) await flush();

        const shadow = el.shadowRoot!;
        const textarea = shadow.querySelector<HTMLTextAreaElement>(".composer-input")!;
        const sendBtn = shadow.querySelector<HTMLButtonElement>(".composer-send")!;

        textarea.value = "ephemeral";
        textarea.dispatchEvent(new Event("input"));
        sendBtn.click();
        for (let i = 0; i < 3; i++) await flush();

        const before = shadow.querySelectorAll(".message").length;

        const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
        const delBtn = shadow.querySelector<HTMLButtonElement>(
            ".message:last-of-type .message-actions .message-action-danger",
        );
        delBtn?.click();
        for (let i = 0; i < 3; i++) await flush();

        const after = shadow.querySelectorAll(".message").length;
        expect(after).toBe(before - 1);
        confirmSpy.mockRestore();
    });

    test("delete is a no-op when the viewer cancels the confirm", async () => {
        vi.useRealTimers();
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 5; i++) await flush();

        const shadow = el.shadowRoot!;
        const textarea = shadow.querySelector<HTMLTextAreaElement>(".composer-input")!;
        const sendBtn = shadow.querySelector<HTMLButtonElement>(".composer-send")!;

        textarea.value = "keepme";
        textarea.dispatchEvent(new Event("input"));
        sendBtn.click();
        for (let i = 0; i < 3; i++) await flush();

        const before = shadow.querySelectorAll(".message").length;

        const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
        const delBtn = shadow.querySelector<HTMLButtonElement>(
            ".message:last-of-type .message-actions .message-action-danger",
        );
        delBtn?.click();
        for (let i = 0; i < 3; i++) await flush();

        const after = shadow.querySelectorAll(".message").length;
        expect(after).toBe(before);
        confirmSpy.mockRestore();
    });
});
