// zulip-embed-react-native — RN-native chat widgets + the headless SDK.
//
// The headless SDK (ZulipClient, ZulipTransport, DemoTransport) works
// in React Native out of the box because it's DOM-free. The UI
// primitives in this package render it via FlatList / TextInput so
// apps don't need to bring their own rendering plumbing.

export {ZulipChatScreen} from "./ZulipChatScreen.js";
export type {ZulipChatScreenProps} from "./ZulipChatScreen.js";
export {LIGHT_THEME, DARK_THEME} from "./types.js";
export type {ZulipRNTheme} from "./types.js";

// Pass-through re-exports of the headless SDK so RN apps only need
// to depend on one package.
export type {
    Channel,
    ConnectionStatus,
    EditMessageParams,
    GetMessagesOptions,
    GetMessagesResult,
    Message,
    MessageType,
    ReactionParams,
    Reaction,
    ScopeFilter,
    SendMessageParams,
    Topic,
    Transport,
    TypingOp,
    TypingUser,
    User,
    ZulipEvent,
    ZulipEventListener,
} from "zulip-embed";

export {ZulipClient, DemoTransport, ZulipTransport} from "zulip-embed";
