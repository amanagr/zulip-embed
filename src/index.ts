import {registerZulipChannelListElement} from "./channel-list.ts";
import {registerZulipChatElement} from "./component.ts";
import {registerZulipTopicListElement} from "./topic-list.ts";

export {ZulipClient} from "./client.ts";
export type {ZulipClientOptions} from "./client.ts";
export {DemoTransport} from "./demo-transport.ts";
export type {DemoTransportOptions} from "./demo-transport.ts";
export {SnapshotTransport} from "./snapshot-transport.ts";
export type {SnapshotFile, SnapshotTransportOptions} from "./snapshot-transport.ts";
export {ZulipTransport} from "./zulip-transport.ts";
export type {ZulipTransportOptions} from "./zulip-transport.ts";
export {ZulipChatElement, registerZulipChatElement} from "./component.ts";
export {ZulipChannelListElement, registerZulipChannelListElement} from "./channel-list.ts";
export {ZulipTopicListElement, registerZulipTopicListElement} from "./topic-list.ts";
export type {
    Channel,
    ConnectionStatus,
    Message,
    MessageType,
    Reaction,
    ScopeFilter,
    SendMessageParams,
    Topic,
    User,
    ZulipEvent,
    ZulipEventListener,
} from "./types.ts";
export type {Transport} from "./transport.ts";

registerZulipChatElement();
registerZulipChannelListElement();
registerZulipTopicListElement();

declare global {
    interface HTMLElementTagNameMap {
        "zulip-chat": import("./component.ts").ZulipChatElement;
        "zulip-channel-list": import("./channel-list.ts").ZulipChannelListElement;
        "zulip-topic-list": import("./topic-list.ts").ZulipTopicListElement;
    }
}
