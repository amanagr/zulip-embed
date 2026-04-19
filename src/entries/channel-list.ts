// zulip-embed/channel-list — registers only the <zulip-channel-list>
// custom element. Use when you want the channel picker without the
// full chat widget.

import {registerZulipChannelListElement} from "../channel-list.ts";

export {ZulipChannelListElement, registerZulipChannelListElement} from "../channel-list.ts";
export type {Channel, ScopeFilter, User} from "../types.ts";
export type {Transport} from "../transport.ts";

registerZulipChannelListElement();

declare global {
    interface HTMLElementTagNameMap {
        "zulip-channel-list": import("../channel-list.ts").ZulipChannelListElement;
    }
}
