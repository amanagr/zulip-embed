// Per-message action registry + URL builders.
//
// The renderer asks this module for an ordered list of descriptors,
// then builds buttons / dropdown items from them. Adopters customise
// the set by passing a comma-separated list to the `message-actions`
// attribute on <zulip-chat>, or by pushing a custom descriptor into
// the JS `messageActions` property.
//
// Split into "inline" and "overflow":
//   - inline: rendered as icon buttons on the action bar.
//   - overflow: rendered in a kebab-menu dropdown.
// Edit + delete default to inline (because they're destructive and
// users expect them visible); everything else goes to overflow.

import type {Message} from "./types.ts";

export type MessageActionVariant = "normal" | "danger";
export type MessageActionPlacement = "inline" | "overflow";

export interface MessageActionHostContext {
    // Server origin for the current widget, used by built-in actions
    // that need to build "open in Zulip" / permalink URLs. Undefined
    // in demo / snapshot mode.
    serverOrigin: string | undefined;
    // Local viewer id. Descriptors with `onlyOwn: true` are filtered
    // out when the message wasn't sent by this user.
    currentUserId: number | undefined;
    // Callback surface — the renderer and component already know how
    // to edit / delete / react, so we route those through the host
    // rather than trying to reinvent them here.
    onEditMessage?: ((m: Message) => void) | undefined;
    onDeleteMessage?: ((m: Message) => void) | undefined;
    onAddReaction?: ((m: Message, anchor: HTMLElement) => void) | undefined;
    // Side-effects for built-in clipboard / open actions. Passed in
    // so that tests and hosts can observe / override them; the
    // component wires them to real navigator.clipboard + window.open.
    copyText?: ((s: string) => void) | undefined;
    openUrl?: ((url: string) => void) | undefined;
}

export interface MessageActionDescriptor {
    id: string;
    label: string;
    // Inline SVG markup, 16x16 viewBox. Supplied for every built-in
    // so the toolbar reads as a consistent icon row; overflow items
    // that don't set an icon render with just a label.
    icon?: string | undefined;
    variant?: MessageActionVariant | undefined;
    placement?: MessageActionPlacement | undefined;
    // Restrict to the message author (e.g. edit / delete). Viewers
    // shouldn't see these on other people's messages, even if the
    // underlying transport would return an error on click.
    onlyOwn?: boolean | undefined;
    // Runs when the action is picked. Called with the message plus a
    // DOM anchor (the button / item that was clicked) so actions like
    // "add reaction" can position popovers against it.
    run: (message: Message, anchor: HTMLElement) => void;
}

// Build a Zulip permalink for a specific message. Uses the legacy
// `stream/` operator because every Zulip version we care about
// accepts it on `#narrow/…` URLs; the same logic that applies to
// `/api/v1/register` (see CLAUDE.md) applies here.
export function buildZulipMessageUrl(
    serverOrigin: string,
    message: Message,
): string | undefined {
    // Direct messages don't live at a channel/topic URL in Zulip's web UI —
    // the closest equivalent is `#narrow/dm/...`, which we don't generate
    // here. Callers that wire "Open in Zulip" on DMs get back undefined.
    if (message.type !== "channel") return undefined;
    const channel = encodeURIComponent(message.channelName);
    const parts = [`${serverOrigin.replace(/\/$/, "")}/#narrow`, `stream/${channel}`];
    if (message.topic !== "") {
        parts.push(`topic/${encodeURIComponent(message.topic)}`);
    }
    parts.push(`near/${String(message.id)}`);
    return parts.join("/");
}

// Built-in icon set. Small 16x16 glyphs so they line up with the rest
// of the action bar without extra tweaks.
const ICON_ATTRS = `viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
export const ACTION_ICONS = {
    edit: `<svg ${ICON_ATTRS}><path d="M2.5 13.5 3 11l7.5-7.5a1.2 1.2 0 0 1 1.7 0l.8.8a1.2 1.2 0 0 1 0 1.7L5 13.5l-2.5 0z"/></svg>`,
    delete: `<svg ${ICON_ATTRS}><path d="M3 4.5h10M6 4.5V3.2A1.2 1.2 0 0 1 7.2 2h1.6a1.2 1.2 0 0 1 1.2 1.2v1.3m-6 0v8a1 1 0 0 0 1 1h5.4a1 1 0 0 0 1-1v-8z"/></svg>`,
    openExternal: `<svg ${ICON_ATTRS}><path d="M9 3h4v4M13 3 7 9M6 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"/></svg>`,
    copyLink: `<svg ${ICON_ATTRS}><path d="M6.5 9.5a3 3 0 0 0 4.24 0l2.12-2.12a3 3 0 1 0-4.24-4.24l-1.06 1.06"/><path d="M9.5 6.5a3 3 0 0 0-4.24 0L3.14 8.62a3 3 0 1 0 4.24 4.24l1.06-1.06"/></svg>`,
    copyText: `<svg ${ICON_ATTRS}><rect x="4" y="2" width="9" height="11" rx="1"/><path d="M10 5H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7"/></svg>`,
    smileyPlus: `<svg ${ICON_ATTRS}><circle cx="7" cy="8" r="5"/><circle cx="5.5" cy="7" r=".7" fill="currentColor"/><circle cx="8.5" cy="7" r=".7" fill="currentColor"/><path d="M5 9.5a2.5 2.5 0 0 0 4 0"/><path d="M12 3v4M10 5h4"/></svg>`,
    kebab: `<svg ${ICON_ATTRS}><circle cx="8" cy="3.5" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="12.5" r=".9" fill="currentColor"/></svg>`,
} as const;

// Built-in actions keyed by id. Hosts list the ids they want (via the
// `message-actions` attribute) and we return the matching descriptors
// in that order. Unknown ids are ignored; missing host callbacks are
// also skipped so a demo-mode embed doesn't render a broken button.
export function builtInAction(
    id: string,
    host: MessageActionHostContext,
): MessageActionDescriptor | undefined {
    switch (id) {
        case "add-reaction":
            if (host.onAddReaction === undefined) return undefined;
            return {
                id,
                label: "Add reaction",
                icon: ACTION_ICONS.smileyPlus,
                placement: "inline",
                run: (message, anchor) => host.onAddReaction?.(message, anchor),
            };
        case "edit":
            if (host.onEditMessage === undefined) return undefined;
            return {
                id,
                label: "Edit",
                icon: ACTION_ICONS.edit,
                placement: "inline",
                onlyOwn: true,
                run: (message) => host.onEditMessage?.(message),
            };
        case "delete":
            if (host.onDeleteMessage === undefined) return undefined;
            return {
                id,
                label: "Delete",
                icon: ACTION_ICONS.delete,
                placement: "inline",
                onlyOwn: true,
                variant: "danger",
                run: (message) => host.onDeleteMessage?.(message),
            };
        case "open-in-zulip":
            if (host.serverOrigin === undefined || host.openUrl === undefined) return undefined;
            return {
                id,
                label: "Open in Zulip",
                icon: ACTION_ICONS.openExternal,
                placement: "overflow",
                run: (message) => {
                    const url = buildZulipMessageUrl(host.serverOrigin!, message);
                    if (url === undefined) return;
                    host.openUrl?.(url);
                },
            };
        case "copy-link":
            if (host.serverOrigin === undefined || host.copyText === undefined) return undefined;
            return {
                id,
                label: "Copy link to message",
                icon: ACTION_ICONS.copyLink,
                placement: "overflow",
                run: (message) => {
                    const url = buildZulipMessageUrl(host.serverOrigin!, message);
                    if (url === undefined) return;
                    host.copyText?.(url);
                },
            };
        case "copy-text":
            if (host.copyText === undefined) return undefined;
            return {
                id,
                label: "Copy message text",
                icon: ACTION_ICONS.copyText,
                placement: "overflow",
                run: (message) => {
                    // Fall back to the raw content; server HTML goes
                    // through as-is so users see the formatting tokens
                    // they'd need to re-paste into another app.
                    host.copyText?.(message.content);
                },
            };
        default:
            return undefined;
    }
}

// The default ordered list — used when no `message-actions` attribute
// is set. Keeps inline affordances minimal and ships the permalink /
// copy actions in the overflow menu.
export const DEFAULT_MESSAGE_ACTIONS: readonly string[] = [
    "add-reaction",
    "edit",
    "delete",
    "open-in-zulip",
    "copy-link",
    "copy-text",
];

// Parse a comma-separated attribute value into an ordered list of
// action ids. Whitespace and empty entries are ignored. Falsy inputs
// return the default list so `<zulip-chat>` works with zero config.
export function parseMessageActionIds(raw: string | null | undefined): readonly string[] {
    if (raw === null || raw === undefined) return DEFAULT_MESSAGE_ACTIONS;
    const trimmed = raw.trim();
    if (trimmed === "") return [];
    const ids = trimmed
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
    return ids.length === 0 ? [] : ids;
}

export function resolveMessageActions(
    ids: readonly string[],
    host: MessageActionHostContext,
    message: Message,
    extra: readonly MessageActionDescriptor[] = [],
): {inline: MessageActionDescriptor[]; overflow: MessageActionDescriptor[]} {
    const all: MessageActionDescriptor[] = [];
    for (const id of ids) {
        const d = builtInAction(id, host);
        if (d !== undefined) all.push(d);
    }
    for (const d of extra) all.push(d);

    const isOwn =
        host.currentUserId !== undefined && message.senderId === host.currentUserId;

    const inline: MessageActionDescriptor[] = [];
    const overflow: MessageActionDescriptor[] = [];
    for (const d of all) {
        if (d.onlyOwn === true && !isOwn) continue;
        const placement = d.placement ?? "overflow";
        if (placement === "inline") inline.push(d);
        else overflow.push(d);
    }
    return {inline, overflow};
}
