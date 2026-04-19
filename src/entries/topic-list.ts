// zulip-embed/topic-list — registers only the <zulip-topic-list>
// custom element.

import {registerZulipTopicListElement} from "../topic-list.ts";

export {ZulipTopicListElement, registerZulipTopicListElement} from "../topic-list.ts";
export type {ScopeFilter, Topic, User} from "../types.ts";
export type {Transport} from "../transport.ts";

registerZulipTopicListElement();

declare global {
    interface HTMLElementTagNameMap {
        "zulip-topic-list": import("../topic-list.ts").ZulipTopicListElement;
    }
}
