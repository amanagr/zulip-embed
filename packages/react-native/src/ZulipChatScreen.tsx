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
import type {Message, ScopeFilter, Transport, ZulipRNTheme} from "./types.js";
import {ZulipClient, LIGHT_THEME} from "./types.js";

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
}

export function ZulipChatScreen(props: ZulipChatScreenProps): React.ReactElement {
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
    });
    const [draft, setDraft] = useState<string>("");

    useEffect(() => {
        const unsubscribe = client.subscribe(() => {
            const state = client.getState();
            setSnapshot({
                messages: state.messages,
                connecting: state.status === "connecting" || state.status === "idle",
                error: state.status === "error" ? "Connection failed" : undefined,
            });
        });
        client.connect().catch((err: unknown) => {
            setSnapshot((prev) => ({
                ...prev,
                connecting: false,
                error: err instanceof Error ? err.message : String(err),
            }));
        });
        return () => {
            unsubscribe();
            void client.close();
        };
    }, [client]);

    const onSend = useCallback(async () => {
        const content = draft.trim();
        if (content === "") return;
        setDraft("");
        try {
            await client.sendMessage(content);
        } catch (err: unknown) {
            setSnapshot((prev) => ({
                ...prev,
                error: err instanceof Error ? err.message : String(err),
            }));
        }
    }, [client, draft]);

    const headerLabel =
        props.brandName !== undefined && props.brandName !== ""
            ? props.brandName
            : props.scope.topic !== undefined
              ? `#${props.scope.channel} › ${props.scope.topic}`
              : `#${props.scope.channel}`;

    return (
        <KeyboardAvoidingView
            style={styles.root}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
            <View style={styles.header}>
                <Text style={styles.headerText}>{headerLabel}</Text>
                {snapshot.connecting ? (
                    <Text style={styles.headerStatus}>connecting…</Text>
                ) : null}
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

            {props.readOnly !== true ? (
                <View style={styles.composer}>
                    <TextInput
                        style={styles.input}
                        value={draft}
                        onChangeText={setDraft}
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

function MessageRow({
    message,
    theme,
}: {
    message: Message;
    theme: ZulipRNTheme;
}): React.ReactElement {
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
