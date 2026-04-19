import {registerZulipAnnouncementElement} from "./announcement.ts";
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
export {ZulipAnnouncementElement, registerZulipAnnouncementElement} from "./announcement.ts";
export type {
    Channel,
    ChannelMessage,
    CodeMessagePart,
    ConfirmationMessagePart,
    ConnectionEvent,
    ConnectionStatus,
    DirectMessage,
    ErrorCode,
    ErrorEvent,
    Message,
    MessagePart,
    MessagePartAuthor,
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
    ZulipConfirmationResponseEventDetail,
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
registerZulipAnnouncementElement();

declare global {
    interface HTMLElementTagNameMap {
        "zulip-chat": import("./component.ts").ZulipChatElement;
        "zulip-channel-list": import("./channel-list.ts").ZulipChannelListElement;
        "zulip-topic-list": import("./topic-list.ts").ZulipTopicListElement;
        "zulip-announcement": import("./announcement.ts").ZulipAnnouncementElement;
    }
}
