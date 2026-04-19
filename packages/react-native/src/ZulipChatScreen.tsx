// RN-native chat screen. Reuses the headless ZulipClient from the
// core package so every transport (live ZulipTransport, DemoTransport,
// SnapshotTransport) works without modification — this file only
// renders the state.
//
// Intentionally renders Message.content as plain text. The core
// rendering pipeline (DOMPurify + CSS) is browser-only; RN apps that
// need rich rendering should layer their own Markdown view on top of
// the raw content string.

import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import {stripHtml} from "./strip-html.js";
import {formatTypingLabel} from "./typing-label.js";
import type {
    Message,
    ScopeFilter,
    Transport,
    TypingUser,
    ZulipEvent,
    ZulipEventListener,
    ZulipRNTheme,
} from "./types.js";
import {ZulipClient, LIGHT_THEME} from "./types.js";

// Alpha-preview notice: surfaces the 0.8.0-rc.0-alpha status of this
// package to app authors who skipped the README. Fires exactly once
// per bundle, in dev builds only (Metro defines __DEV__ === true in
// development, false in production). Suppressed under tests where
// __DEV__ is undefined.
declare const __DEV__: boolean | undefined;
let alphaNoticeShown = false;
function showAlphaNoticeOnce(): void {
    if (alphaNoticeShown) return;
    alphaNoticeShown = true;
    if (typeof __DEV__ !== "boolean" || !__DEV__) return;
    // eslint-disable-next-line no-console
    console.warn(
        "[zulip-embed-react-native] 0.9.0-alpha preview: plain-text " +
            "rendering only, reactions/message-action UI not yet wired. " +
            "See https://github.com/amanagr/zulip-embed/tree/main/packages/react-native#readme",
    );
}

export interface ZulipChatScreenProps {
    // Bring-your-own transport: caller wires ZulipTransport /
    // DemoTransport / SnapshotTransport and passes it in.
    transport: Transport;
    scope: ScopeFilter;
    // Optional — defaults to LIGHT_THEME. Pass DARK_THEME or a custom
    // palette to re-skin without forking this component.
    theme?: ZulipRNTheme;
    // Hide the composer (useful for snapshot / demo rooms).
    readOnly?: boolean;
    // Optional brand header — shown above the feed when set. Replaces
    // the default `#channel › topic` label with a product string.
    brandName?: string;
}

interface Snapshot {
    messages: Message[];
    connecting: boolean;
    error: string | undefined;
    typingUsers: TypingUser[];
}

// Match the web `<zulip-chat>` element's typing-send cadence so the
// server sees the same keep-alive pattern across platforms.
// - `start` is re-sent every TYPING_REFRESH_MS while the viewer is
//   actively typing so the server keeps the indicator alive (Zulip
//   expires pings after ~10s).
// - After TYPING_IDLE_MS of no keystrokes, we emit `stop` on the
//   viewer's behalf.
const TYPING_REFRESH_MS = 8000;
const TYPING_IDLE_MS = 5000;

export function ZulipChatScreen(props: ZulipChatScreenProps): React.ReactElement {
    showAlphaNoticeOnce();
    const theme = props.theme ?? LIGHT_THEME;
    const styles = useMemo(() => makeStyles(theme), [theme]);

    const clientRef = useRef<ZulipClient | null>(null);
    if (clientRef.current === null) {
        clientRef.current = new ZulipClient({
            transport: props.transport,
            scope: props.scope,
        });
    }
    const client = clientRef.current;

    const [snapshot, setSnapshot] = useState<Snapshot>({
        messages: [],
        connecting: true,
        error: undefined,
        typingUsers: [],
    });
    const [draft, setDraft] = useState<string>("");

    // Outbound typing-ping bookkeeping. Mirrors the timers the web
    // `<zulip-chat>` element keeps: one interval re-sends `start` while
    // the viewer is actively keystroking, and a single-shot timer fires
    // `stop` after TYPING_IDLE_MS of silence. Stored in refs so they
    // survive re-renders and we don't retrigger effect cleanup on every
    // draft change.
    const typingActiveRef = useRef<boolean>(false);
    const typingRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const scopeRef = useRef<ScopeFilter>(props.scope);
    scopeRef.current = props.scope;

    // Best-effort fire-and-forget ping. Typing notifications are non-
    // critical UX — a dropped send must never surface as a user-visible
    // error the way a failed `sendMessage` does.
    const sendTypingPing = useCallback(
        (op: "start" | "stop") => {
            client.sendTyping(op, scopeRef.current).catch(() => undefined);
        },
        [client],
    );

    const stopTypingPings = useCallback(
        (opts: {silent?: boolean} = {}) => {
            if (typingIdleRef.current !== null) {
                clearTimeout(typingIdleRef.current);
                typingIdleRef.current = null;
            }
            if (typingRefreshRef.current !== null) {
                clearInterval(typingRefreshRef.current);
                typingRefreshRef.current = null;
            }
            if (typingActiveRef.current) {
                typingActiveRef.current = false;
                if (opts.silent !== true) sendTypingPing("stop");
            }
        },
        [sendTypingPing],
    );

    useEffect(() => {
        const onEvent: ZulipEventListener = (event: ZulipEvent) => {
            const state = client.getState();
            if (event.type === "typing") {
                // Never show the local viewer in their own indicator.
                const selfId = client.getCurrentUserId();
                const others =
                    selfId === undefined
                        ? event.users
                        : event.users.filter((u) => u.userId !== selfId);
                setSnapshot((prev) => ({
                    ...prev,
                    typingUsers: others,
                }));
                return;
            }
            setSnapshot((prev) => ({
                ...prev,
                messages: state.messages,
                connecting: state.status === "connecting" || state.status === "idle",
                error: state.status === "error" ? "Connection failed" : undefined,
            }));
        };
        const unsubscribe = client.subscribe(onEvent);
        client.connect().catch((err: unknown) => {
            setSnapshot((prev) => ({
                ...prev,
                connecting: false,
                error: err instanceof Error ? err.message : String(err),
            }));
        });
        return () => {
            // Clear typing timers silently on unmount — the connection is
            // going away, so sending `stop` here would race the teardown.
            stopTypingPings({silent: true});
            unsubscribe();
            void client.close();
        };
    }, [client, stopTypingPings]);

    // Called on every composer keystroke. Sends a `start` ping the
    // first time (and refreshes every TYPING_REFRESH_MS while the user
    // keeps typing) and schedules a `stop` after TYPING_IDLE_MS of
    // silence. No-op in read-only mode since there is no composer.
    const onDraftChange = useCallback(
        (next: string) => {
            setDraft(next);
            if (props.readOnly === true) return;
            if (next.trim().length === 0) {
                // Empty composer after a keystroke (e.g. backspace-to-
                // empty) behaves like an explicit stop.
                stopTypingPings();
                return;
            }
            if (!typingActiveRef.current) {
                typingActiveRef.current = true;
                sendTypingPing("start");
                typingRefreshRef.current = setInterval(() => {
                    if (typingActiveRef.current) sendTypingPing("start");
                }, TYPING_REFRESH_MS);
            }
            if (typingIdleRef.current !== null) {
                clearTimeout(typingIdleRef.current);
            }
            typingIdleRef.current = setTimeout(() => {
                stopTypingPings();
            }, TYPING_IDLE_MS);
        },
        [props.readOnly, sendTypingPing, stopTypingPings],
    );

    const onSend = useCallback(async () => {
        const content = draft.trim();
        if (content === "") return;
        setDraft("");
        // Stop typing before the network call so teammates don't see a
        // stale "Alice is typing" linger after the message lands.
        stopTypingPings();
        try {
            await client.sendMessage(content);
        } catch (err: unknown) {
            setSnapshot((prev) => ({
                ...prev,
                error: err instanceof Error ? err.message : String(err),
            }));
        }
    }, [client, draft, stopTypingPings]);

    const typingLabel = formatTypingLabel(snapshot.typingUsers);

    const headerLabel = buildHeaderLabel(props.scope, props.brandName);

    return (
        <KeyboardAvoidingView
            style={styles.root}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
            <View style={styles.header}>
                <Text style={styles.headerText}>{headerLabel}</Text>
                {snapshot.connecting ? <Text style={styles.headerStatus}>connecting…</Text> : null}
            </View>

            {snapshot.error !== undefined ? (
                <View style={styles.errorBanner}>
                    <Text style={styles.errorText}>{snapshot.error}</Text>
                </View>
            ) : null}

            <FlatList
                style={styles.feed}
                contentContainerStyle={styles.feedContent}
                data={snapshot.messages}
                keyExtractor={(m) => String(m.id)}
                renderItem={({item}) => <MessageRow message={item} theme={theme} />}
            />

            {typingLabel !== undefined ? (
                <View
                    style={styles.typingRow}
                    accessibilityLiveRegion="polite"
                    accessibilityRole="text"
                >
                    <Text style={styles.typingText}>{typingLabel}</Text>
                </View>
            ) : null}

            {props.readOnly !== true ? (
                <View style={styles.composer}>
                    <TextInput
                        style={styles.input}
                        value={draft}
                        onChangeText={onDraftChange}
                        placeholder="Write a message…"
                        placeholderTextColor={theme.muted}
                        multiline
                    />
                    <TouchableOpacity
                        style={styles.sendButton}
                        onPress={onSend}
                        accessibilityRole="button"
                        accessibilityLabel="Send message"
                    >
                        <Text style={styles.sendText}>Send</Text>
                    </TouchableOpacity>
                </View>
            ) : null}
        </KeyboardAvoidingView>
    );
}

function MessageRow({message, theme}: {message: Message; theme: ZulipRNTheme}): React.ReactElement {
    const styles = useMemo(() => makeStyles(theme), [theme]);
    return (
        <View style={styles.messageRow}>
            <View style={styles.messageHeader}>
                <Text style={styles.senderName}>{message.senderFullName}</Text>
                <Text style={styles.timestamp}>{formatTimestamp(message.timestamp)}</Text>
            </View>
            <Text style={styles.messageContent}>{stripHtml(message.content)}</Text>
        </View>
    );
}

function formatTimestamp(unix: number): string {
    const d = new Date(unix);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

// Header label handles both scope shapes — the discriminated form
// introduced in 0.8 and the legacy flat form. DM scopes read the
// participant count rather than a channel name; the caller can pass
// `brandName` to override the default label entirely.
function buildHeaderLabel(scope: ScopeFilter, brandName: string | undefined): string {
    if (brandName !== undefined && brandName !== "") return brandName;
    const normalized = "kind" in scope ? scope : {kind: "channel" as const, ...scope};
    if (normalized.kind === "dm") {
        if (normalized.userIds.length === 0) return "Direct";
        return `Direct (${String(normalized.userIds.length)})`;
    }
    if (normalized.topic !== undefined && normalized.topic !== "") {
        return `#${normalized.channel} \u203a ${normalized.topic}`;
    }
    return `#${normalized.channel}`;
}

function makeStyles(theme: ZulipRNTheme) {
    return StyleSheet.create({
        root: {
            flex: 1,
            backgroundColor: theme.background,
        },
        header: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.border,
            backgroundColor: theme.surface,
        },
        headerText: {
            color: theme.text,
            fontWeight: "600",
            fontSize: 15,
        },
        headerStatus: {
            color: theme.muted,
            fontSize: 12,
        },
        errorBanner: {
            backgroundColor: theme.error,
            paddingVertical: 6,
            paddingHorizontal: 16,
        },
        errorText: {
            color: "#ffffff",
            fontSize: 13,
        },
        feed: {
            flex: 1,
        },
        feedContent: {
            padding: 12,
            gap: 10,
        },
        messageRow: {
            paddingVertical: 6,
            paddingHorizontal: 12,
            backgroundColor: theme.surface,
            borderRadius: 8,
        },
        messageHeader: {
            flexDirection: "row",
            justifyContent: "space-between",
            marginBottom: 4,
        },
        senderName: {
            color: theme.text,
            fontWeight: "600",
            fontSize: 13,
        },
        timestamp: {
            color: theme.muted,
            fontSize: 11,
        },
        messageContent: {
            color: theme.text,
            fontSize: 14,
            lineHeight: 20,
        },
        typingRow: {
            paddingHorizontal: 16,
            paddingVertical: 4,
            backgroundColor: theme.surface,
        },
        typingText: {
            color: theme.muted,
            fontSize: 12,
            fontStyle: "italic",
        },
        composer: {
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 8,
            padding: 12,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.border,
            backgroundColor: theme.surface,
        },
        input: {
            flex: 1,
            minHeight: 36,
            maxHeight: 120,
            paddingHorizontal: 10,
            paddingVertical: 8,
            backgroundColor: theme.background,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 8,
            color: theme.text,
            fontSize: 14,
        },
        sendButton: {
            paddingHorizontal: 14,
            paddingVertical: 10,
            backgroundColor: theme.accent,
            borderRadius: 8,
        },
        sendText: {
            color: theme.accentContrast,
            fontWeight: "600",
            fontSize: 14,
        },
    });
}
