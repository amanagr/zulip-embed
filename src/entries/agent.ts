// zulip-embed/agent — streaming-reply primitives for agent-native
// hosts. No custom-element registration: agent flows build on
// ZulipClient directly, typically on top of a UI wired via /chat or
// /all. startAgentReply lives on ZulipClient; this entry re-exports
// the handle shape and option types so hosts can type their callsites
// without pulling the full SDK.

export {ZulipClient} from "../client.ts";
export type {ClientState, ZulipClientOptions} from "../client.ts";
export type {
    AgentAuthor,
    AgentReplyHandle,
    StartAgentReplyOptions,
} from "../agent-reply.ts";
export type {
    CodeMessagePart,
    ConfirmationMessagePart,
    Message,
    MessagePart,
    MessagePartAuthor,
    ScopeFilter,
    SendMessageParams,
    TextMessagePart,
    ToolCallMessagePart,
    ToolResultMessagePart,
    User,
    ZulipConfirmationResponseEventDetail,
    ZulipEvent,
    ZulipEventListener,
} from "../types.ts";
export type {Transport} from "../transport.ts";
