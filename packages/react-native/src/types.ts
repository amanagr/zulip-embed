// Re-export the headless types so RN consumers don't need to reach
// into zulip-embed directly.
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

// RN-specific theme token. Colors match the Web Component's default
// light theme so the chat feels consistent across platforms.
export interface ZulipRNTheme {
    background: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    accentContrast: string;
    border: string;
    error: string;
}

export const LIGHT_THEME: ZulipRNTheme = {
    background: "#ffffff",
    surface: "#f7f7f9",
    text: "#111827",
    muted: "#6b7280",
    accent: "#6172f3",
    accentContrast: "#ffffff",
    border: "#e5e7eb",
    error: "#dc2626",
};

export const DARK_THEME: ZulipRNTheme = {
    background: "#111827",
    surface: "#1f2937",
    text: "#f9fafb",
    muted: "#9ca3af",
    accent: "#818cf8",
    accentContrast: "#ffffff",
    border: "#374151",
    error: "#f87171",
};
