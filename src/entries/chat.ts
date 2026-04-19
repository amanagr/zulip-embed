// zulip-embed/chat — registers the <zulip-chat> custom element and
// nothing else. Use this subpath when you only need the main chat
// widget; channel-list and topic-list stay tree-shaken.

import {registerZulipChatElement} from "../component.ts";

export {ZulipChatElement, registerZulipChatElement} from "../component.ts";
export {ZulipClient} from "../client.ts";
export type {ClientState, ZulipClientOptions} from "../client.ts";
export {ZulipTransport} from "../zulip-transport.ts";
export type {ZulipTransportOptions} from "../zulip-transport.ts";
export type {
    ChannelMessage,
    ConnectionEvent,
    ConnectionStatus,
    DirectMessage,
    ErrorCode,
    ErrorEvent,
    Message,
    MessageType,
    Reaction,
    ReactionEvent,
    ScopeFilter,
    SendMessageParams,
    TypingEvent,
    TypingUser,
    User,
    ZulipConnectionChangeEventDetail,
    ZulipErrorEventDetail,
    ZulipEvent,
    ZulipEventListener,
    ZulipMessageEventDetail,
} from "../types.ts";
export type {
    EditMessageParams,
    GetMessagesOptions,
    GetMessagesResult,
    ReactionParams,
    Transport,
    TypingOp,
} from "../transport.ts";

registerZulipChatElement();

declare global {
    interface HTMLElementTagNameMap {
        "zulip-chat": import("../component.ts").ZulipChatElement;
    }
}
