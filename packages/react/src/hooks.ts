"use client";

// Headless React hook that pairs with the framework-agnostic
// `ZulipClient`. Consumers who want to build their own UI (custom
// composer, chat log, message surface) use this to get the current
// message list + status + a bound sendMessage without touching the
// Web Component.
//
// Shape chosen to look and feel like React's built-in useSyncExternalStore
// consumers, but we don't depend on that hook directly so we can keep
// React 17 compatibility for the peer-dep range.

import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import type {ClientState, Transport, ScopeFilter, SendMessageParams} from "zulip-embed";
import {ZulipClient} from "zulip-embed";

export interface UseZulipChatResult {
    // Active message list for the scope. Stable reference until state
    // changes, so consumers can `useMemo` off it safely.
    messages: ClientState["messages"];
    // Connection status: idle | connecting | connected | reconnecting
    // | disconnected | error. The hook surfaces it directly so
    // consumers can render banners / spinners without owning their
    // own reducer.
    status: ClientState["status"];
    // Stable send helper bound to the active scope. Accepts either a
    // string (routes to the scope) or the full `SendMessageParams`
    // payload (for cross-scope DMs).
    sendMessage: (input: string | SendMessageParams) => Promise<void>;
    // Pulls a page of older messages, prepended to `messages`. No-op
    // once the transport reports it has nothing older.
    loadOlder: () => Promise<void>;
    // Underlying client — exposed so advanced consumers can subscribe
    // to raw events or call transport-only methods (reactions, typing).
    client: ZulipClient;
}

// Pairs a transport + scope into a live `ZulipClient` and re-renders
// on every state change. The client is rebuilt whenever the transport
// or scope identity changes, so memoize transport at the caller
// boundary (useMemo / module scope) to avoid unnecessary reconnects.
export function useZulipChat(
    transport: Transport,
    scope: ScopeFilter,
): UseZulipChatResult {
    // Client identity is keyed on `transport` + `scope` object identity.
    // Stringifying scope would be more tolerant of inline object literals
    // but less predictable for consumers juggling multiple scopes; we
    // document the memoization requirement in the types instead.
    const client = useMemo(
        () => new ZulipClient({transport, scope}),
        [transport, scope],
    );

    const [state, setState] = useState<ClientState>(() => client.getState());

    // We keep a ref to the current state setter so subscribeState's
    // callback doesn't retain a stale client after reconnects.
    const setStateRef = useRef(setState);
    setStateRef.current = setState;

    useEffect(() => {
        const unsub = client.subscribeState(() => {
            setStateRef.current(client.getState());
        });
        // Fire-and-forget connect; errors surface through the
        // subscribeState `status === "error"` path rather than this
        // promise so consumers don't need try/catch here.
        void client.connect();
        return () => {
            unsub();
            void client.disconnect();
        };
    }, [client]);

    const sendMessage = useCallback(
        async (input: string | SendMessageParams): Promise<void> => {
            if (typeof input === "string") {
                await client.sendMessage(input);
            } else {
                await client.sendMessage(input);
            }
        },
        [client],
    );

    const loadOlder = useCallback(async (): Promise<void> => {
        await client.loadOlder();
    }, [client]);

    return {
        messages: state.messages,
        status: state.status,
        sendMessage,
        loadOlder,
        client,
    };
}
