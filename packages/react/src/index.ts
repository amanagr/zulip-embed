// @zulip/react — thin React wrappers around the framework-agnostic
// <zulip-chat>, <zulip-channel-list>, and <zulip-topic-list> Web
// Components. The components themselves own all rendering + state;
// these wrappers only convert React props to attributes, wire
// React-style `on*` callback props to the underlying CustomEvents,
// and trigger the customElements.define side effect on import so
// downstream apps don't have to remember to `import "@zulip/embed"`.

export {ZulipChat} from "./zulip-chat.js";
export type {ZulipChatProps} from "./zulip-chat.js";
export {ZulipChannelList} from "./zulip-channel-list.js";
export type {ZulipChannelListProps, ChannelSelectedDetail} from "./zulip-channel-list.js";
export {ZulipTopicList} from "./zulip-topic-list.js";
export type {ZulipTopicListProps, TopicSelectedDetail} from "./zulip-topic-list.js";

// Re-export the domain types so consumers don't need to pull from
// two packages when they type their handlers.
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
} from "@zulip/embed";
export type {Transport} from "@zulip/embed";
