// zulip-embed/dm-list — registers only the <zulip-dm-list> custom
// element. Use when you want the DM picker without the full chat widget
// (or alongside <zulip-channel-list> as an alternate left nav).

import {registerZulipDmListElement} from "../dm-list.ts";

export {ZulipDmListElement, registerZulipDmListElement} from "../dm-list.ts";
export type {DirectMessageConversation, Transport} from "../transport.ts";
export type {ScopeFilter, User} from "../types.ts";

registerZulipDmListElement();

declare global {
    interface HTMLElementTagNameMap {
        "zulip-dm-list": import("../dm-list.ts").ZulipDmListElement;
    }
}
