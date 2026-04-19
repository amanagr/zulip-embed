import {registerZulipChatElement} from "./component.ts";

export {ZulipClient} from "./client.ts";
export type {ZulipClientOptions} from "./client.ts";
export {DemoTransport} from "./demo-transport.ts";
export type {DemoTransportOptions} from "./demo-transport.ts";
export {SnapshotTransport} from "./snapshot-transport.ts";
export type {SnapshotFile, SnapshotTransportOptions} from "./snapshot-transport.ts";
export {ZulipTransport} from "./zulip-transport.ts";
export type {ZulipTransportOptions} from "./zulip-transport.ts";
export {ZulipChatElement, registerZulipChatElement} from "./component.ts";
export type {
    Channel,
    ConnectionStatus,
    Message,
    MessageType,
    Reaction,
    ScopeFilter,
    SendMessageParams,
    User,
    ZulipEvent,
    ZulipEventListener,
} from "./types.ts";
export type {Transport} from "./transport.ts";

registerZulipChatElement();

declare global {
    interface HTMLElementTagNameMap {
        "zulip-chat": import("./component.ts").ZulipChatElement;
    }
}
