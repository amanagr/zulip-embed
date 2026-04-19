// zulip-embed/announcement — registers only the <zulip-announcement>
// custom element. Use when you want to surface a pinned message as a
// dismissible banner without shipping the full chat widget.

import {registerZulipAnnouncementElement} from "../announcement.ts";

export {ZulipAnnouncementElement, registerZulipAnnouncementElement} from "../announcement.ts";
export type {Message, ScopeFilter} from "../types.ts";
export type {Transport} from "../transport.ts";

registerZulipAnnouncementElement();

declare global {
    interface HTMLElementTagNameMap {
        "zulip-announcement": import("../announcement.ts").ZulipAnnouncementElement;
    }
}
