// Coverage for the customizable per-message action registry. Split
// into pure resolver tests (no DOM) and DOM integration tests that go
// through renderMessage to exercise the inline-button + kebab-dropdown
// wiring.

import {describe, expect, test, vi} from "vitest";

import {
    buildZulipMessageUrl,
    DEFAULT_MESSAGE_ACTIONS,
    builtInAction,
    parseMessageActionIds,
    resolveMessageActions,
    type MessageActionDescriptor,
    type MessageActionHostContext,
} from "../src/message-actions.ts";
import {renderMessage} from "../src/render.ts";
import type {ChannelMessage, Message} from "../src/types.ts";

function msg(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
    return {
        id: 42,
        senderId: 11,
        senderFullName: "Iago",
        senderEmail: "iago@zulip.com",
        avatarUrl: "",
        timestamp: Date.now(),
        content: "hi",
        contentIsHtml: false,
        type: "channel",
        channelName: "announce",
        topic: "welcome",
        reactions: [],
        ...overrides,
    };
}

function directMsg(): Message {
    return {
        id: 42,
        senderId: 11,
        senderFullName: "Iago",
        senderEmail: "iago@zulip.com",
        avatarUrl: "",
        timestamp: Date.now(),
        content: "hi",
        contentIsHtml: false,
        type: "direct",
        recipients: [],
        reactions: [],
    };
}

function host(overrides: Partial<MessageActionHostContext> = {}): MessageActionHostContext {
    return {
        serverOrigin: "https://chat.example.com",
        currentUserId: 11,
        onEditMessage: () => {},
        onDeleteMessage: () => {},
        onAddReaction: () => {},
        copyText: () => {},
        openUrl: () => {},
        ...overrides,
    };
}

describe("parseMessageActionIds", () => {
    test("undefined and null fall back to the default ordered list", () => {
        expect(parseMessageActionIds(undefined)).toBe(DEFAULT_MESSAGE_ACTIONS);
        expect(parseMessageActionIds(null)).toBe(DEFAULT_MESSAGE_ACTIONS);
    });

    test("empty string returns an empty list (explicit opt-out)", () => {
        expect(parseMessageActionIds("")).toEqual([]);
        expect(parseMessageActionIds("   ")).toEqual([]);
    });

    test("csv parses into trimmed ordered ids", () => {
        expect(parseMessageActionIds("edit, delete , add-reaction"))
            .toEqual(["edit", "delete", "add-reaction"]);
    });

    test("empty entries between commas are skipped", () => {
        expect(parseMessageActionIds("edit,,delete,")).toEqual(["edit", "delete"]);
    });
});

describe("buildZulipMessageUrl", () => {
    test("channel + topic URL uses the legacy stream/ operator and near/id", () => {
        const url = buildZulipMessageUrl("https://chat.example.com", msg());
        expect(url).toBe(
            "https://chat.example.com/#narrow/stream/announce/topic/welcome/near/42",
        );
    });

    test("channel without topic omits the topic segment", () => {
        const url = buildZulipMessageUrl("https://chat.example.com", msg({topic: ""}));
        expect(url).toBe("https://chat.example.com/#narrow/stream/announce/near/42");
    });

    test("trailing slash on server origin is normalized away", () => {
        const url = buildZulipMessageUrl("https://chat.example.com/", msg());
        expect(url?.startsWith("https://chat.example.com/#narrow")).toBe(true);
    });

    test("returns undefined when the message has no channel (e.g. DM)", () => {
        const url = buildZulipMessageUrl("https://chat.example.com", directMsg());
        expect(url).toBeUndefined();
    });

    test("channel names with spaces / slashes are URL-encoded", () => {
        const url = buildZulipMessageUrl(
            "https://chat.example.com",
            msg({channelName: "design / ux", topic: "icon set"}),
        );
        expect(url).toBe(
            "https://chat.example.com/#narrow/stream/design%20%2F%20ux/topic/icon%20set/near/42",
        );
    });
});

describe("builtInAction", () => {
    test("add-reaction is skipped when host has no onAddReaction", () => {
        expect(builtInAction("add-reaction", host({onAddReaction: undefined}))).toBeUndefined();
    });

    test("edit + delete carry onlyOwn: true", () => {
        expect(builtInAction("edit", host())?.onlyOwn).toBe(true);
        expect(builtInAction("delete", host())?.onlyOwn).toBe(true);
    });

    test("delete uses the danger variant", () => {
        expect(builtInAction("delete", host())?.variant).toBe("danger");
    });

    test("open-in-zulip / copy-link require serverOrigin + their side-effect", () => {
        expect(builtInAction("open-in-zulip", host({serverOrigin: undefined}))).toBeUndefined();
        expect(builtInAction("open-in-zulip", host({openUrl: undefined}))).toBeUndefined();
        expect(builtInAction("copy-link", host({serverOrigin: undefined}))).toBeUndefined();
        expect(builtInAction("copy-link", host({copyText: undefined}))).toBeUndefined();
    });

    test("copy-text works without serverOrigin", () => {
        expect(builtInAction("copy-text", host({serverOrigin: undefined}))).toBeDefined();
        expect(builtInAction("copy-text", host({copyText: undefined}))).toBeUndefined();
    });

    test("unknown action ids return undefined rather than throwing", () => {
        expect(builtInAction("nope", host())).toBeUndefined();
    });

    test("running edit / delete routes to the host callbacks", () => {
        const onEdit = vi.fn();
        const onDelete = vi.fn();
        const m = msg();
        const anchor = document.createElement("button");
        const editDescriptor = builtInAction("edit", host({onEditMessage: onEdit}));
        const deleteDescriptor = builtInAction("delete", host({onDeleteMessage: onDelete}));
        editDescriptor?.run(m, anchor);
        deleteDescriptor?.run(m, anchor);
        expect(onEdit).toHaveBeenCalledWith(m);
        expect(onDelete).toHaveBeenCalledWith(m);
    });

    test("running open-in-zulip calls openUrl with the permalink", () => {
        const openUrl = vi.fn();
        const m = msg();
        const anchor = document.createElement("button");
        builtInAction("open-in-zulip", host({openUrl}))?.run(m, anchor);
        expect(openUrl).toHaveBeenCalledWith(
            "https://chat.example.com/#narrow/stream/announce/topic/welcome/near/42",
        );
    });

    test("running copy-link puts the permalink on the clipboard helper", () => {
        const copyText = vi.fn();
        builtInAction("copy-link", host({copyText}))?.run(
            msg(),
            document.createElement("button"),
        );
        expect(copyText).toHaveBeenCalledWith(
            "https://chat.example.com/#narrow/stream/announce/topic/welcome/near/42",
        );
    });

    test("running copy-text copies the raw message content", () => {
        const copyText = vi.fn();
        builtInAction("copy-text", host({copyText}))?.run(
            msg({content: "hello world"}),
            document.createElement("button"),
        );
        expect(copyText).toHaveBeenCalledWith("hello world");
    });
});

describe("resolveMessageActions", () => {
    test("filters onlyOwn descriptors out for other people's messages", () => {
        const theirs = msg({senderId: 99});
        const {inline, overflow} = resolveMessageActions(
            ["edit", "delete", "copy-link"],
            host(),
            theirs,
        );
        const ids = [...inline, ...overflow].map((d) => d.id);
        expect(ids).not.toContain("edit");
        expect(ids).not.toContain("delete");
        expect(ids).toContain("copy-link");
    });

    test("splits descriptors into inline vs overflow by placement", () => {
        const {inline, overflow} = resolveMessageActions(
            ["edit", "delete", "open-in-zulip", "copy-link", "copy-text"],
            host(),
            msg(),
        );
        expect(inline.map((d) => d.id)).toEqual(["edit", "delete"]);
        expect(overflow.map((d) => d.id)).toEqual([
            "open-in-zulip",
            "copy-link",
            "copy-text",
        ]);
    });

    test("preserves adopter-specified id order", () => {
        const {inline} = resolveMessageActions(["delete", "edit"], host(), msg());
        expect(inline.map((d) => d.id)).toEqual(["delete", "edit"]);
    });

    test("unknown ids are silently skipped, not errored", () => {
        const {inline, overflow} = resolveMessageActions(
            ["edit", "nope", "delete"],
            host(),
            msg(),
        );
        expect(inline.map((d) => d.id)).toEqual(["edit", "delete"]);
        expect(overflow).toEqual([]);
    });

    test("extra descriptors append after built-ins and respect placement", () => {
        const extra: MessageActionDescriptor = {
            id: "flag",
            label: "Flag",
            placement: "overflow",
            run: () => {},
        };
        const {inline, overflow} = resolveMessageActions(
            ["edit"],
            host(),
            msg(),
            [extra],
        );
        expect(inline.map((d) => d.id)).toEqual(["edit"]);
        expect(overflow.map((d) => d.id)).toEqual(["flag"]);
    });
});

describe("renderMessage action bar DOM — inline + kebab overflow", () => {
    test("renders only inline icon buttons when overflow is empty", () => {
        const node = renderMessage(msg(), false, {
            currentUserId: 11,
            messageActionIds: ["edit", "delete"],
            messageActionHostContext: host(),
        });
        const bar = node.querySelector(".message-actions");
        expect(bar).not.toBeNull();
        expect(bar?.querySelectorAll(".message-action").length).toBe(2);
        expect(bar?.querySelector(".message-action-kebab")).toBeNull();
        expect(bar?.querySelector(".message-actions-menu")).toBeNull();
    });

    test("renders a kebab button + hidden menu when overflow has items", () => {
        const node = renderMessage(msg(), false, {
            currentUserId: 11,
            messageActionIds: ["edit", "copy-link", "copy-text"],
            messageActionHostContext: host(),
        });
        expect(node.querySelector(".message-action-kebab")).not.toBeNull();
        const menu = node.querySelector<HTMLElement>(".message-actions-menu");
        expect(menu).not.toBeNull();
        expect(menu?.hidden).toBe(true);
        expect(menu?.querySelectorAll(".message-actions-item").length).toBe(2);
    });

    test("clicking the kebab toggles aria-expanded + menu visibility", () => {
        const node = renderMessage(msg(), false, {
            currentUserId: 11,
            messageActionIds: ["edit", "copy-link"],
            messageActionHostContext: host(),
        });
        const kebab = node.querySelector<HTMLButtonElement>(".message-action-kebab");
        const menu = node.querySelector<HTMLElement>(".message-actions-menu");
        expect(kebab?.getAttribute("aria-expanded")).toBe("false");
        kebab?.click();
        expect(menu?.hidden).toBe(false);
        expect(kebab?.getAttribute("aria-expanded")).toBe("true");
        kebab?.click();
        expect(menu?.hidden).toBe(true);
    });

    test("clicking a menu item runs the descriptor and closes the menu", () => {
        const openUrl = vi.fn();
        const node = renderMessage(msg(), false, {
            currentUserId: 11,
            messageActionIds: ["open-in-zulip"],
            messageActionHostContext: host({openUrl}),
        });
        document.body.innerHTML = "";
        document.body.append(node);
        const kebab = node.querySelector<HTMLButtonElement>(".message-action-kebab")!;
        kebab.click();
        const item = node.querySelector<HTMLButtonElement>(
            '.message-actions-item[data-action-id="open-in-zulip"]',
        );
        item?.click();
        expect(openUrl).toHaveBeenCalledWith(
            "https://chat.example.com/#narrow/stream/announce/topic/welcome/near/42",
        );
        expect(node.querySelector<HTMLElement>(".message-actions-menu")?.hidden).toBe(true);
    });

    test("clicking outside the menu closes it", () => {
        const node = renderMessage(msg(), false, {
            currentUserId: 11,
            messageActionIds: ["copy-link", "copy-text"],
            messageActionHostContext: host(),
        });
        document.body.innerHTML = "";
        document.body.append(node);
        const kebab = node.querySelector<HTMLButtonElement>(".message-action-kebab")!;
        kebab.click();
        const menu = node.querySelector<HTMLElement>(".message-actions-menu")!;
        expect(menu.hidden).toBe(false);
        document.body.click();
        expect(menu.hidden).toBe(true);
    });

    test("Escape key closes an open menu", () => {
        const node = renderMessage(msg(), false, {
            currentUserId: 11,
            messageActionIds: ["copy-link", "copy-text"],
            messageActionHostContext: host(),
        });
        document.body.innerHTML = "";
        document.body.append(node);
        const kebab = node.querySelector<HTMLButtonElement>(".message-action-kebab")!;
        kebab.click();
        const menu = node.querySelector<HTMLElement>(".message-actions-menu")!;
        expect(menu.hidden).toBe(false);
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        expect(menu.hidden).toBe(true);
    });

    test("no bar is rendered when host context is missing (e.g. snapshot mode)", () => {
        const node = renderMessage(msg(), false, {currentUserId: 11});
        expect(node.querySelector(".message-actions")).toBeNull();
    });
});
