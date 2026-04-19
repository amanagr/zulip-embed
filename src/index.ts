import {registerZulipChannelListElement} from "./channel-list.ts";
import {registerZulipChatElement} from "./component.ts";
import {registerZulipTopicListElement} from "./topic-list.ts";

export {ZulipClient} from "./client.ts";
export type {ClientState, ZulipClientOptions} from "./client.ts";
export type {AgentAuthor, AgentReplyHandle, StartAgentReplyOptions} from "./agent-reply.ts";
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
    ChannelMessage,
    CodeMessagePart,
    ConnectionEvent,
    ConnectionStatus,
    DirectMessage,
    ErrorCode,
    ErrorEvent,
    Message,
    MessagePart,
    MessageType,
    Reaction,
    ReactionEvent,
    ScopeFilter,
    SendMessageParams,
    TextMessagePart,
    ToolCallMessagePart,
    ToolResultMessagePart,
    Topic,
    TypingEvent,
    TypingUser,
    User,
    ZulipConnectionChangeEventDetail,
    ZulipErrorEventDetail,
    ZulipEvent,
    ZulipEventListener,
    ZulipMessageEventDetail,
} from "./types.ts";
export type {
    EditMessageParams,
    GetMessagesOptions,
    GetMessagesResult,
    ReactionParams,
    Transport,
    TypingOp,
} from "./transport.ts";

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
